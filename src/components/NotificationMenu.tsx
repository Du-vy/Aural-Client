/**
 * The "Notifications" submenu, as it appears on a server and on a channel.
 *
 * One builder for both because the two menus are the same decision at two
 * altitudes: how long to be quiet, which messages are worth a toast, and
 * whether being one of many still counts. Only the wording and where the
 * answer is stored differ, and both of those are arguments.
 *
 * A channel offers one entry a server does not — inheriting — because that is
 * what a channel does by default and what somebody has to be able to go back
 * to after disagreeing once.
 */

import { t, type TranslationKey } from "@/lib/i18n";
import {
  MUTED_FOREVER,
  channelOverride,
  muted,
  serverOverride,
  setChannelOverride,
  setServerOverride,
  type NotificationOverride,
} from "@/lib/muting";
import type { NotificationScope } from "@/lib/storage";
import type { MenuEntry } from "./ContextMenu";
import { BellIcon, BellOffIcon } from "./Icons";

/** The lengths a mute is offered in, in minutes. Zero is "until turned off". */
const DURATIONS = [15, 60, 180, 480, 1440, 0] as const;

const DURATION_LABELS: Record<(typeof DURATIONS)[number], TranslationKey> = {
  15: "contextMenu.mute15m",
  60: "contextMenu.mute1h",
  180: "contextMenu.mute3h",
  480: "contextMenu.mute8h",
  1440: "contextMenu.mute24h",
  0: "contextMenu.muteForever",
};

/** The scope choices, in the order they narrow. */
const SCOPES: Array<{ value: NotificationScope | null; label: TranslationKey }> = [
  { value: null, label: "contextMenu.scopeInherit" },
  { value: "all", label: "contextMenu.scopeAll" },
  { value: "mentions", label: "contextMenu.scopeMentions" },
  { value: "none", label: "contextMenu.scopeNone" },
];

interface Target {
  serverId: string;
  /** Absent for the server itself. */
  channelId?: number;
}

function read({ serverId, channelId }: Target): NotificationOverride {
  return channelId === undefined
    ? serverOverride(serverId)
    : channelOverride(serverId, channelId);
}

function apply({ serverId, channelId }: Target, changes: Partial<NotificationOverride>): void {
  if (channelId === undefined) setServerOverride(serverId, changes);
  else setChannelOverride(serverId, channelId, changes);
}

/**
 * The submenu for one target.
 *
 * The entries carry their own ticks, so whatever builds this has to be
 * subscribed to `onMutingChanged` and rebuild on a write — which is what keeps
 * a menu left open from going on showing the state before the click.
 */
export function notificationMenuEntries(target: Target): MenuEntry[] {
  const override = read(target);
  const isChannel = target.channelId !== undefined;
  const silenced = muted(override);

  const change = (changes: Partial<NotificationOverride>) => apply(target, changes);

  const entries: MenuEntry[] = [];

  if (silenced) {
    entries.push({
      id: "unmute",
      label: isChannel ? t("contextMenu.unmuteChannel") : t("contextMenu.unmuteServer"),
      icon: <BellIcon size={16} />,
      onClick: () => change({ mutedUntil: 0 }),
    });
  } else {
    entries.push({
      id: "mute",
      label: isChannel ? t("contextMenu.muteChannel") : t("contextMenu.muteServer"),
      icon: <BellOffIcon size={16} />,
      items: DURATIONS.map((minutes) => ({
        id: `mute-${minutes}`,
        label: t(DURATION_LABELS[minutes]),
        onClick: () =>
          change({ mutedUntil: minutes === 0 ? MUTED_FOREVER : Date.now() + minutes * 60_000 }),
      })),
    });
  }

  entries.push({ type: "separator" });
  for (const scope of SCOPES) {
    // A server has nothing above it to inherit from but the client settings,
    // which is what "use my default" already means there.
    if (scope.value === null && !isChannel) continue;
    entries.push({
      id: `scope-${scope.value ?? "inherit"}`,
      label: t(scope.label),
      checked: override.scope === scope.value,
      keepOpen: true,
      onClick: () => change({ scope: scope.value }),
    });
  }

  entries.push({ type: "separator" });
  entries.push(
    {
      id: "suppress-everyone",
      label: t("contextMenu.suppressEveryone"),
      checked: override.suppressEveryone,
      keepOpen: true,
      onClick: () => change({ suppressEveryone: !override.suppressEveryone }),
    },
    {
      id: "suppress-roles",
      label: t("contextMenu.suppressRoles"),
      checked: override.suppressRoles,
      keepOpen: true,
      onClick: () => change({ suppressRoles: !override.suppressRoles }),
    },
  );

  return entries;
}
