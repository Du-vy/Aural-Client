import { useEffect, useState } from "react";

import { CloseIcon } from "@/components/Icons";
import { UpdateBanner } from "@/components/UpdateBanner";
import { startActivityWatch } from "@/lib/activity";
import { useTranslation } from "@/lib/i18n";
import { startIdleWatch } from "@/lib/idle";
import { preloadNotificationSound } from "@/lib/notificationSounds";
import { preloadVoiceSounds } from "@/lib/voiceSounds";
import { readNotifications } from "@/lib/storage";
import { setTrayLabels } from "@/lib/systemSettings";
import { startUnreadBadgeSync } from "@/lib/unreadBadge";
import { startUpdateWatch } from "@/lib/updater";
import { startNavigationListener } from "@/store/navigation";
import { ConnectView } from "@/views/ConnectView";
import { ServerView } from "@/views/ServerView";
import { useServerRegistry } from "@/store/servers";
import { useSession } from "@/store/session";

export function App() {
  const foregroundId = useServerRegistry((state) => state.foregroundId);
  const activeSection = useServerRegistry((state) => state.activeSection);
  const status = useSession((state) => state.status);
  const [showConnect, setShowConnect] = useState(false);
  const { t, language } = useTranslation();

  // Global mouse (Mouse 4/5) and keyboard (Alt+Left/Right) navigation history
  useEffect(() => startNavigationListener(), []);

  // The taskbar count follows every connection, not the one on screen, so it
  // is started here rather than anywhere inside the server view: that tree is
  // replaced whenever the foreground server changes.
  useEffect(() => startUnreadBadgeSync(), []);

  // Away follows every connection for the same reason the badge does, and for
  // one more: one person is idle or is not, and two watchers deciding that
  // separately would fight over the answer.
  useEffect(() => startIdleWatch(), []);

  // What somebody is doing outside Aural, reported to every server they are
  // on — for the same reason again, and because the two readers behind it are
  // machine-wide: there is one media session and one rich-presence socket, and
  // a watcher per connection would be several clients fighting over both.
  useEffect(() => startActivityWatch(), []);

  // Once, at startup, and only if the setting allows it. Deliberately not tied
  // to a connection: whether there is a newer Aural has nothing to do with
  // which server is being looked at, and a client left on the connect screen
  // is exactly the one most likely to be too old to reach anything.
  useEffect(() => startUpdateWatch(), []);

  // The tray menu is built during startup, before anything that knows which
  // language this is being read in has loaded, so it is written in English and
  // corrected from here — again whenever the language changes, because a tray
  // menu left in the old one is the only part of the client that would not
  // have followed.
  useEffect(() => {
    void setTrayLabels(
      t("dialogs.userSettings.startup.trayOpen"),
      t("dialogs.userSettings.startup.trayQuit"),
    );
  }, [t, language]);

  // Connecting from the overlay puts you on the new server, so the overlay has
  // done its job and should get out of the way. It is the change of server
  // that closes it, not the status: with other servers already open, the one
  // being added is the only thing that has happened.
  useEffect(() => {
    if (foregroundId !== null) setShowConnect(false);
  }, [foregroundId]);

  // A connection that is up, coming back, or signing somebody else in is still
  // the server being looked at. Only having none of them is the connect screen.
  const connected = foregroundId !== null && status !== "idle";

  // Fetched and decoded once there is a server to be notified by, rather than
  // on the first notification: a sound that arrives after the message it is
  // announcing is worse than no sound. Connecting is a click, so the audio
  // engine is unlocked by the time this runs.
  useEffect(() => {
    if (connected) {
      preloadNotificationSound(readNotifications().sound);
      preloadVoiceSounds();
    }
  }, [connected]);

  return (
    <>
      <div className="app-custom-bg" aria-hidden="true" />
      {/* Outside both branches: an update is worth saying whether somebody is
          on the connect screen or in a channel, and this way it survives the
          remount that switching servers causes. */}
      <UpdateBanner />
      {!connected ? (
        <ConnectView />
      ) : (
        <>
          {/* Keyed by server in server mode: switching servers replaces the tree rather than
              re-pointing it, so nothing carries a channel id, a scroll offset
              or a draft from one server into another where it means something
              else. In DM mode, keeping "dms" as key allows switching conversations
              across servers without unmounting the DM view. */}
          <ServerView
            key={activeSection === "dms" ? "dms" : foregroundId}
            onAddServer={() => setShowConnect(true)}
          />
          {showConnect ? (
            <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "var(--bg-main)" }}>
              <button
                className="iconbtn"
                onClick={() => setShowConnect(false)}
                aria-label="Back to the server"
                style={{ position: "absolute", top: 14, right: 16, zIndex: 1 }}
              >
                <CloseIcon size={20} />
              </button>
              <ConnectView />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
