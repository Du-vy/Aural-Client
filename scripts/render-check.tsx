/**
 * Mounts the whole component tree in a real DOM against seeded state.
 *
 * A type check proves the props line up; it does not prove a component renders.
 * This mounts every screen and dialog with realistic state and fails on the
 * first crash, which is what catches a bad selector or a missing guard before
 * anyone opens a browser.
 *
 * It runs against a DOM rather than the server renderer on purpose: zustand
 * hands a server render its *initial* state, so seeded state would be invisible
 * and every check would pass vacuously.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { App } = await import("@/App");
const { AccountDialog } = await import("@/components/dialogs/AccountDialog");
const { ChannelDialog } = await import("@/components/dialogs/ChannelDialog");
const { MemberDialog } = await import("@/components/dialogs/MemberDialog");
const { ServerSettingsDialog } = await import("@/components/dialogs/ServerSettingsDialog");
const { Perm, format } = await import("@/lib/permissions");
const { useSession } = await import("@/store/session");

type Channel = import("@/lib/protocol").Channel;
type Role = import("@/lib/protocol").Role;
type ServerInfo = import("@/lib/protocol").ServerInfo;
type User = import("@/lib/protocol").User;

// React needs to be told this is a test environment before act() is used.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let checks = 0;
let failed = false;

function render(name: string, element: React.ReactElement): void {
  checks += 1;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() => {
      root.render(element);
    });
    const html = container.innerHTML;
    if (html.length === 0) throw new Error("rendered nothing");
    console.log(`  ok    ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  } finally {
    try {
      act(() => {
        root.unmount();
      });
    } catch {
      // Unmount failures are not what this check is about.
    }
    container.remove();
  }
}

const noop = () => undefined;

const server: ServerInfo = {
  name: "Test Server",
  description: "A server used to render the client",
  protocolVersion: 1,
  softwareVersion: "0.1.0",
  maxUsers: 64,
  onlineUsers: 2,
  passwordProtected: false,
  registrationEnabled: true,
  guestsAllowed: true,
  voiceMode: "client_host",
};

const roles: Role[] = [
  {
    id: 1,
    name: "everyone",
    color: "",
    permissions: format(
      Perm.ViewChannel | Perm.Connect | Perm.Speak | Perm.ChangeNickname | Perm.Register,
    ),
    position: 0,
    hoist: false,
    managed: "everyone",
  },
  {
    id: 2,
    name: "Member",
    color: "#3ba55d",
    permissions: "0",
    position: 1,
    hoist: false,
    managed: "registered",
  },
  {
    id: 3,
    name: "Admin",
    color: "#e8544a",
    permissions: format(Perm.Administrator),
    position: 100,
    hoist: true,
    managed: "admin",
  },
];

const channels: Channel[] = [
  { id: 1, parentId: null, name: "General", type: "category", topic: "", position: 0, userLimit: 0, overwrites: [] },
  { id: 2, parentId: 1, name: "general", type: "text", topic: "Welcome to Aural", position: 0, userLimit: 0, overwrites: [] },
  { id: 3, parentId: 1, name: "Lobby", type: "voice", topic: "", position: 1, userLimit: 4, overwrites: [] },
  { id: 4, parentId: null, name: "Loose channel", type: "voice", topic: "", position: 0, userLimit: 0, overwrites: [] },
];

const admin: User = {
  id: 10,
  nickname: "Pablo",
  username: null,
  registered: false,
  roles: [1, 3],
  channelId: 3,
  online: true,
};

const guest: User = {
  id: 11,
  nickname: "Bob",
  username: null,
  registered: false,
  roles: [1],
  channelId: 3,
  online: true,
};

function seed(overrides: Partial<Parameters<typeof useSession.setState>[0]> = {}) {
  useSession.setState({
    status: "connected",
    server,
    self: admin,
    users: new Map([
      [admin.id, admin],
      [guest.id, guest],
    ]),
    channels: new Map(channels.map((channel) => [channel.id, channel])),
    roles: new Map(roles.map((role) => [role.id, role])),
    saved: [{ id: "127.0.0.1:9871", address: "127.0.0.1:9871", name: "Test Server", nickname: "Pablo" }],
    savedId: "127.0.0.1:9871",
    notice: "A notice, so its banner renders too.",
    ...overrides,
  });
}

console.log("\nrendering the client\n");

console.log("disconnected");
useSession.setState({ status: "idle", server: null, self: null, saved: [] });
render("connect screen", <App />);

console.log("\nconnected as an administrator");
seed();
render("server view", <App />);
render("account dialog", <AccountDialog onClose={noop} />);
render("channel dialog", <ChannelDialog parentId={1} onClose={noop} />);
render("member dialog", <MemberDialog userId={guest.id} onClose={noop} />);
render("server settings dialog", <ServerSettingsDialog onClose={noop} />);

console.log("\nconnected as a plain guest");
seed({ self: { ...admin, roles: [1] } });
render("server view", <App />);
render("account dialog", <AccountDialog onClose={noop} />);
render("member dialog for another guest", <MemberDialog userId={guest.id} onClose={noop} />);

console.log("\nedge cases");
seed({ channels: new Map(), self: { ...admin, channelId: null } });
render("server view with no visible channels", <App />);

seed({ self: { ...admin, registered: true, username: "pablo", channelId: null } });
render("account dialog for a registered member", <AccountDialog onClose={noop} />);

seed({ notice: null, saved: [] });
render("server view with no saved servers and no notice", <App />);

console.log(`\n${checks} screens rendered${failed ? ", with failures" : ""}.\n`);

await GlobalRegistrator.unregister();
process.exit(failed ? 1 : 0);
