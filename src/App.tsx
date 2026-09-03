import { useEffect, useState } from "react";

import { CloseIcon } from "@/components/Icons";
import { ConnectView } from "@/views/ConnectView";
import { ServerView } from "@/views/ServerView";
import { useServerRegistry } from "@/store/servers";
import { useSession } from "@/store/session";

export function App() {
  const foregroundId = useServerRegistry((state) => state.foregroundId);
  const activeSection = useServerRegistry((state) => state.activeSection);
  const status = useSession((state) => state.status);
  const [showConnect, setShowConnect] = useState(false);

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

  return (
    <>
      <div className="app-custom-bg" aria-hidden="true" />
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
