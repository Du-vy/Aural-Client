import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import {
  defaultAutoMod,
  describeError,
  isPostChannel,
  type AutoModAction,
  type AutoModConfig,
  type AutoModRule,
  type Role,
} from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { FilterIcon } from "../../Icons";

/** The rules, in the order the screen lists them. */
type RuleKey = "words" | "links" | "mentions" | "caps" | "flood" | "repetition";

/** Which rules can mask part of a message rather than only refusing it. */
const CAN_CENSOR: Record<RuleKey, boolean> = {
  words: true,
  links: true,
  mentions: false,
  caps: false,
  flood: false,
  repetition: false,
};

/**
 * Automatic moderation.
 *
 * The whole rule set is edited as one and saved as one, because the rules
 * constrain each other and a half-applied edit is not a state worth being able
 * to reach. What comes back from a save is what is now in force — the server
 * bounds and de-duplicates what it was sent — so the screen shows that rather
 * than what was typed.
 */
export function ServerAutoModPage() {
  const { t } = useTranslation();
  const stored = useSession((state) => state.automod);
  const loadAutoMod = useSession((state) => state.loadAutoMod);
  const updateAutoMod = useSession((state) => state.updateAutoMod);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);

  const permissions = useMyPermissions();
  const allowed = has(permissions, Perm.ManageServer);

  const [draft, setDraft] = useState<AutoModConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    loadAutoMod().catch((failure: unknown) => setError(describeError(failure)));
  }, [allowed, loadAutoMod]);

  // The draft is seeded from what was fetched and then owned by this screen:
  // re-seeding on every store change would throw away half-typed edits every
  // time somebody else saved something.
  useEffect(() => {
    if (stored && draft === null) setDraft(stored);
  }, [stored, draft]);

  // The everyone role is left out: exempting it would switch the rule off, and
  // there is already a switch for that. Highest first, which is the order the
  // role editor lists them in.
  const assignableRoles = useMemo(
    () =>
      [...roles.values()]
        .filter((role) => role.managed !== "everyone")
        .sort((a, b) => b.position - a.position),
    [roles],
  );
  // Only the channels rules can actually fire in. A category holds no messages
  // and a voice channel carries no text.
  const writableChannels = useMemo(
    () =>
      [...channels.values()].filter(
        (channel) => channel.type === "text" || isPostChannel(channel.type),
      ),
    [channels],
  );

  if (!allowed) {
    return (
      <div className="settings-section">
        <header className="settings-section__header">
          <h2 className="settings-section__title">{t("dialogs.serverSettings.automod.title")}</h2>
          <p className="settings-section__desc">
            {t("dialogs.serverSettings.automod.noPermission")}
          </p>
        </header>
      </div>
    );
  }

  const config = draft ?? stored ?? defaultAutoMod();
  const dirty = stored !== null && JSON.stringify(config) !== JSON.stringify(stored);

  const patch = (changes: Partial<AutoModConfig>) => {
    setSaved(false);
    setDraft({ ...config, ...changes });
  };

  const patchRule = <K extends RuleKey>(key: K, changes: Partial<AutoModConfig[K]>) => {
    setSaved(false);
    setDraft({ ...config, [key]: { ...config[key], ...changes } } as AutoModConfig);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateAutoMod(config);
      setDraft(null);
      setSaved(true);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.automod.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.automod.desc")}</p>
      </header>

      <div className="settings-card">
        <Toggle
          label={t("dialogs.serverSettings.automod.enabled")}
          hint={t("dialogs.serverSettings.automod.enabledHint")}
          checked={config.enabled}
          onChange={(enabled) => patch({ enabled })}
        />

        <RolePicker
          label={t("dialogs.serverSettings.automod.exemptRoles")}
          hint={t("dialogs.serverSettings.automod.exemptRolesHint")}
          roles={assignableRoles}
          selected={config.exemptRoles}
          onChange={(exemptRoles) => patch({ exemptRoles })}
        />

        <div className="field">
          <span className="field__label">
            {t("dialogs.serverSettings.automod.exemptChannels")}
          </span>
          <p className="field__hint">{t("dialogs.serverSettings.automod.exemptChannelsHint")}</p>
          <div className="chip-row">
            {writableChannels.map((channel) => {
              const on = config.exemptChannels.includes(channel.id);
              return (
                <button
                  key={channel.id}
                  type="button"
                  className={on ? "chip chip--on" : "chip"}
                  onClick={() =>
                    patch({
                      exemptChannels: on
                        ? config.exemptChannels.filter((id) => id !== channel.id)
                        : [...config.exemptChannels, channel.id],
                    })
                  }
                >
                  #{channel.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <RuleCard
        rule="words"
        value={config.words}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("words", changes)}
        disabled={!config.enabled}
      >
        <WordList
          words={config.words.words}
          onChange={(words) => patchRule("words", { words })}
        />
        <Toggle
          label={t("dialogs.serverSettings.automod.wholeWord")}
          hint={t("dialogs.serverSettings.automod.wholeWordHint")}
          checked={config.words.wholeWord}
          onChange={(wholeWord) => patchRule("words", { wholeWord })}
        />
      </RuleCard>

      <RuleCard
        rule="links"
        value={config.links}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("links", changes)}
        disabled={!config.enabled}
      >
        <WordList
          label={t("dialogs.serverSettings.automod.allowedDomains")}
          hint={t("dialogs.serverSettings.automod.allowedDomainsHint")}
          placeholder="github.com"
          words={config.links.allowedDomains}
          onChange={(allowedDomains) => patchRule("links", { allowedDomains })}
        />
      </RuleCard>

      <RuleCard
        rule="mentions"
        value={config.mentions}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("mentions", changes)}
        disabled={!config.enabled}
      >
        <NumberField
          label={t("dialogs.serverSettings.automod.mentionLimit")}
          value={config.mentions.limit}
          min={1}
          max={50}
          onChange={(limit) => patchRule("mentions", { limit })}
        />
      </RuleCard>

      <RuleCard
        rule="caps"
        value={config.caps}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("caps", changes)}
        disabled={!config.enabled}
      >
        <NumberField
          label={t("dialogs.serverSettings.automod.capsPercent")}
          value={config.caps.percent}
          min={10}
          max={100}
          onChange={(percent) => patchRule("caps", { percent })}
        />
        <NumberField
          label={t("dialogs.serverSettings.automod.capsMinLength")}
          value={config.caps.minLength}
          min={4}
          max={500}
          onChange={(minLength) => patchRule("caps", { minLength })}
        />
      </RuleCard>

      <RuleCard
        rule="flood"
        value={config.flood}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("flood", changes)}
        disabled={!config.enabled}
      >
        <NumberField
          label={t("dialogs.serverSettings.automod.floodMessages")}
          value={config.flood.messages}
          min={2}
          max={30}
          onChange={(messages) => patchRule("flood", { messages })}
        />
        <NumberField
          label={t("dialogs.serverSettings.automod.floodSeconds")}
          value={config.flood.seconds}
          min={1}
          max={60}
          onChange={(seconds) => patchRule("flood", { seconds })}
        />
      </RuleCard>

      <RuleCard
        rule="repetition"
        value={config.repetition}
        roles={assignableRoles}
        onPatch={(changes) => patchRule("repetition", changes)}
        disabled={!config.enabled}
      >
        <NumberField
          label={t("dialogs.serverSettings.automod.repetitionTimes")}
          value={config.repetition.times}
          min={2}
          max={20}
          onChange={(times) => patchRule("repetition", { times })}
        />
      </RuleCard>

      {error ? <p className="settings-inline-error">{error}</p> : null}
      {saved ? (
        <p className="settings-inline-success">{t("dialogs.serverSettings.automod.saved")}</p>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? t("common.loading") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

interface RuleCardProps {
  /** Which rule this is, which decides its wording and whether it may censor. */
  rule: RuleKey;
  value: AutoModRule;
  roles: Role[];
  disabled: boolean;
  /**
   * Applies a change to the half every rule has. The half that differs — a
   * word list, a limit, a window — is passed in as children by the caller,
   * which is the only place that knows the shape of it.
   */
  onPatch(changes: Partial<AutoModRule>): void;
  children?: ReactNode;
}

/**
 * One rule: whether it runs, what it does when it matches, who it spares, and
 * whatever it needs beyond that.
 *
 * The per-rule exemption is offered on every one of them because it is what
 * makes the feature usable: staff are usually exempt from everything, and one
 * rule — no links, most often — is very often lifted for a single role that
 * nothing else applies to.
 */
function RuleCard({ rule, value, roles, disabled, onPatch, children }: RuleCardProps) {
  const { t } = useTranslation();

  return (
    <div className={disabled ? "settings-card settings-card--dim" : "settings-card"}>
      <div className="settings-card__header">
        <span className="settings-card__service-icon" aria-hidden="true">
          <FilterIcon size={18} />
        </span>
        <div className="settings-card__header-info">
          <h3 className="settings-card__title">
            {t(`dialogs.serverSettings.automod.rules.${rule}.title` as never)}
          </h3>
          <p className="settings-card__subtitle">
            {t(`dialogs.serverSettings.automod.rules.${rule}.desc` as never)}
          </p>
        </div>
      </div>

      <Toggle
        label={t("dialogs.serverSettings.automod.ruleEnabled")}
        checked={value.enabled}
        onChange={(enabled) => onPatch({ enabled })}
      />

      {value.enabled ? (
        <>
          <div className="field">
            <span className="field__label">{t("dialogs.serverSettings.automod.action")}</span>
            <div className="chip-row">
              {(["block", "censor"] as AutoModAction[]).map((action) => {
                if (action === "censor" && !CAN_CENSOR[rule]) return null;
                return (
                  <button
                    key={action}
                    type="button"
                    className={value.action === action ? "chip chip--on" : "chip"}
                    onClick={() => onPatch({ action })}
                  >
                    {t(`dialogs.serverSettings.automod.actions.${action}` as never)}
                  </button>
                );
              })}
            </div>
          </div>

          <RolePicker
            label={t("dialogs.serverSettings.automod.ruleExempt")}
            roles={roles}
            selected={value.exemptRoles}
            onChange={(exemptRoles) => onPatch({ exemptRoles })}
          />

          {children}
        </>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle__body">
        <span className="settings-toggle__label">{label}</span>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <div className="field field--inline">
      <label className="field__label">{label}</label>
      <input
        type="number"
        className="input input--narrow"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
      />
    </div>
  );
}

function RolePicker({
  label,
  hint,
  roles,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  roles: Role[];
  selected: number[];
  onChange(next: number[]): void;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {hint ? <p className="field__hint">{hint}</p> : null}
      <div className="chip-row">
        {roles.map((role) => {
          const on = selected.includes(role.id);
          return (
            <button
              key={role.id}
              type="button"
              className={on ? "chip chip--on" : "chip"}
              style={role.color ? { borderColor: role.color, color: on ? undefined : role.color } : undefined}
              onClick={() =>
                onChange(on ? selected.filter((id) => id !== role.id) : [...selected, role.id])
              }
            >
              {role.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A list of words or domains, edited one entry at a time.
 *
 * A textarea would be fewer lines and a worse idea: it makes a list of terms
 * look like prose, and the one thing this control has to make obvious is where
 * one entry ends and the next begins.
 */
function WordList({
  label,
  hint,
  placeholder,
  words,
  onChange,
}: {
  label?: string;
  hint?: string;
  placeholder?: string;
  words: string[];
  onChange(next: string[]): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  function add() {
    // A pasted list is split rather than taken as one long entry: pasting is
    // how anybody with a list already written puts it in.
    const entries = draft
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !words.includes(entry));
    if (entries.length === 0) {
      setDraft("");
      return;
    }
    onChange([...words, ...entries]);
    setDraft("");
  }

  return (
    <div className="field">
      <span className="field__label">{label ?? t("dialogs.serverSettings.automod.words")}</span>
      <p className="field__hint">{hint ?? t("dialogs.serverSettings.automod.wordsHint")}</p>

      <div className="field__row">
        <input
          type="text"
          className="input"
          value={draft}
          placeholder={placeholder ?? t("dialogs.serverSettings.automod.wordsPlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn--ghost" onClick={add} disabled={draft.trim() === ""}>
          {t("dialogs.serverSettings.automod.addWord")}
        </button>
      </div>

      {words.length > 0 ? (
        <div className="chip-row chip-row--wrap">
          {words.map((word) => (
            <button
              key={word}
              type="button"
              className="chip chip--removable"
              title={t("dialogs.serverSettings.automod.removeWord")}
              onClick={() => onChange(words.filter((entry) => entry !== word))}
            >
              {word}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
