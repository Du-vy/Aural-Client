import { useEffect, useMemo, useState } from "react";

import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatPanel } from "@/components/ChatPanel";
import {
  AuralMark,
  CloseIcon,
  GearIcon,
  HashIcon,
  MenuIcon,
  PlusIcon,
  UsersIcon,
  VoiceIcon,
} from "@/components/Icons";
import { MemberList } from "@/components/MemberList";
import { UserPanel } from "@/components/UserPanel";
import { AccountDialog } from "@/components/dialogs/AccountDialog";
import { ChannelDialog } from "@/components/dialogs/ChannelDialog";
import { MemberDialog } from "@/components/dialogs/MemberDialog";
import { ServerSettingsDialog } from "@/components/dialogs/ServerSettingsDialog";
import { Perm, has } from "@/lib/permissions";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";

type Dialog =
  | { kind: "none" }
  | { kind: "account" }
  | { kind: "settings" }
  | { kind: "channel"; parentId: number | null }
  | { kind: "member"; userId: number };

interface ServerViewProps {
  onAddServer(): void;
}

export function ServerView({ onAddServer }: ServerViewProps) {
  const server = useSession((state) => state.server);
  const channels = useSession((state) => state.channels);
  const saved = useSession((state) => state.saved);
  const savedId = useSession((state) => state.savedId);
  const notice = useSession((state) => state.notice);
  const dismissNotice = useSession((state) => state.dismissNotice);
  const connect = useSession((state) => state.connect);
  const permissions = useMyPermissions();

  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [membersOpen, setMembersOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selected = selectedChannelId === null ? null : (channels.get(selectedChannelId) ?? null);

  // The first text channel is a reasonable landing spot, and a channel that
  // disappears must not leave the header pointing at nothing.
  useEffect(() => {
    if (selectedChannelId !== null && channels.has(selectedChannelId)) return;
    const firstText = [...channels.values()]
      .filter((channel) => channel.type === "text")
      .sort((a, b) => a.position - b.position)[0];
    setSelectedChannelId(firstText?.id ?? null);
  }, [channels, selectedChannelId]);

  const canManageServer = useMemo(
    () => has(permissions, Perm.ManageServer) || has(permissions, Perm.ManageRoles),
    [permissions],
  );
  const canManageChannels = has(permissions, Perm.ManageChannels);

  if (!server) return null;

  const shellClasses = ["app", "app--with-members"];
  if (membersOpen) shellClasses.push("app--members-open");
  if (drawerOpen) shellClasses.push("app--drawer-open");

  return (
    <div className={shellClasses.join(" ")}>
      <nav className="rail" aria-label="Servers">
        {saved.map((entry) => (
          <button
            key={entry.id}
            className={entry.id === savedId ? "rail__item rail__item--active" : "rail__item"}
            title={`${entry.name} (${entry.id})`}
            aria-label={entry.name}
            onClick={() => {
              if (entry.id === savedId) return;
              void connect({ address: entry.address }).catch(() => {
                // The connect screen surfaces the failure.
              });
            }}
          >
            {entry.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <div className="rail__divider" />
        <button className="rail__item" onClick={onAddServer} title="Connect to another server" aria-label="Connect to another server">
          <PlusIcon size={20} />
        </button>
      </nav>

      <aside className="sidebar">
        <header className="sidebar__header">
          <span className="sidebar__name" title={server.description || server.name}>
            {server.name}
          </span>
          <span style={{ display: "flex", gap: 2 }}>
            {canManageChannels ? (
              <button
                className="iconbtn"
                onClick={() => setDialog({ kind: "channel", parentId: null })}
                title="Create a channel"
                aria-label="Create a channel"
              >
                <PlusIcon size={17} />
              </button>
            ) : null}
            {canManageServer ? (
              <button
                className="iconbtn"
                onClick={() => setDialog({ kind: "settings" })}
                title="Server settings"
                aria-label="Server settings"
              >
                <GearIcon size={17} />
              </button>
            ) : null}
          </span>
        </header>

        <ChannelSidebar
          selectedChannelId={selectedChannelId}
          onSelectChannel={(id) => {
            setSelectedChannelId(id);
            setDrawerOpen(false);
          }}
          onCreateChannel={(parentId) => setDialog({ kind: "channel", parentId })}
          onOpenMember={(userId) => setDialog({ kind: "member", userId })}
        />

        <UserPanel onOpenAccount={() => setDialog({ kind: "account" })} />
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="iconbtn drawer-toggle"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label="Toggle channel list"
          >
            <MenuIcon size={18} />
          </button>

          <span className="topbar__title">
            {selected ? (
              <>
                {selected.type === "voice" ? <VoiceIcon size={17} /> : <HashIcon size={17} />}
                <span>{selected.name}</span>
              </>
            ) : (
              <span>{server.name}</span>
            )}
          </span>
          {selected?.topic ? <span className="topbar__topic">{selected.topic}</span> : null}

          <span className="topbar__spacer" />

          <button
            className="iconbtn"
            onClick={() => setMembersOpen((open) => !open)}
            title="Toggle member list"
            aria-label="Toggle member list"
            aria-pressed={membersOpen}
          >
            <UsersIcon size={18} />
          </button>
        </header>

        {notice ? (
          <div className="notice">
            <span>{notice}</span>
            <button className="notice__close" onClick={dismissNotice} aria-label="Dismiss">
              <CloseIcon size={15} />
            </button>
          </div>
        ) : null}

        {selected?.type === "text" ? (
          <ChatPanel key={selected.id} channel={selected} />
        ) : (
          <div className="content">
            <div className="placeholder">
              <span className="placeholder__icon" style={{ color: "var(--accent)" }}>
                <AuralMark size={30} />
              </span>
              <h2 className="placeholder__title">{server.name}</h2>
              <p className="placeholder__body">
                {server.description ||
                  "Pick a text channel to read it, or a voice channel to join it."}
              </p>
              <p className="field__hint">
                Voice hosting on this server:{" "}
                {server.voiceMode === "client_host"
                  ? "the first user in a channel relays its audio"
                  : "the server relays all audio"}
              </p>
            </div>
          </div>
        )}
      </main>

      <MemberList onOpenMember={(userId) => setDialog({ kind: "member", userId })} />

      {drawerOpen ? (
        <div className="scrim--drawer" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      ) : null}

      {dialog.kind === "account" ? <AccountDialog onClose={() => setDialog({ kind: "none" })} /> : null}
      {dialog.kind === "settings" ? (
        <ServerSettingsDialog onClose={() => setDialog({ kind: "none" })} />
      ) : null}
      {dialog.kind === "channel" ? (
        <ChannelDialog parentId={dialog.parentId} onClose={() => setDialog({ kind: "none" })} />
      ) : null}
      {dialog.kind === "member" ? (
        <MemberDialog userId={dialog.userId} onClose={() => setDialog({ kind: "none" })} />
      ) : null}
    </div>
  );
}
