import { useEffect, useState } from "react";

import { CloseIcon } from "@/components/Icons";
import { ConnectView } from "@/views/ConnectView";
import { ServerView } from "@/views/ServerView";
import { useSession } from "@/store/session";

export function App() {
  const status = useSession((state) => state.status);
  const [showConnect, setShowConnect] = useState(false);

  // Connecting from the overlay puts you on the new server, so the overlay has
  // done its job and should get out of the way.
  useEffect(() => {
    if (status === "connected") setShowConnect(false);
  }, [status]);

  const connected = status === "connected" || status === "reconnecting";

  return (
    <>
      <div className="app-custom-bg" aria-hidden="true" />
      {!connected ? (
        <ConnectView />
      ) : (
        <>
          <ServerView onAddServer={() => setShowConnect(true)} />
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
