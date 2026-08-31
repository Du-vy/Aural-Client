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
const { EmojiPicker } = await import("@/components/EmojiPicker");
const { MessageList } = await import("@/components/MessageList");
const { insertAtCaret } = await import("@/components/MessageComposer");
const { ServerSettingsDialog } = await import("@/components/dialogs/ServerSettingsDialog");
const { Perm, format } = await import("@/lib/permissions");
const { useSession } = await import("@/store/session");

type Channel = import("@/lib/protocol").Channel;
type Message = import("@/lib/protocol").Message;
type Role = import("@/lib/protocol").Role;
type ServerInfo = import("@/lib/protocol").ServerInfo;
type User = import("@/lib/protocol").User;

// React needs to be told this is a test environment before act() is used.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let checks = 0;
let failed = false;

/**
 * Mounts one element and reports whether it survived.
 *
 * `expected` is what the rendered HTML must contain. Without it this proves
 * only that a component did not throw, which is too weak a claim for anything
 * whose job is to display particular content.
 */
function render(name: string, element: React.ReactElement, expected: string[] = []): void {
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
    for (const needle of expected) {
      if (!html.includes(needle)) throw new Error(`rendered without ${JSON.stringify(needle)}`);
    }
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

const DAY = 24 * 60 * 60;
const nowSeconds = Math.floor(Date.now() / 1000);

// Spread across two days and two authors, so day separators, grouped blocks
// and the offline-author fallback are all exercised.
const messages: Message[] = [
  {
    id: 1,
    channelId: 2,
    userId: 99,
    author: "Someone who left",
    content: "An author this client has never seen, because they are offline.",
    createdAt: nowSeconds - DAY - 60,
    editedAt: null,
  },
  {
    id: 2,
    channelId: 2,
    userId: guest.id,
    author: "Bob",
    content: "First of a block.",
    createdAt: nowSeconds - 300,
    editedAt: null,
  },
  {
    id: 3,
    channelId: 2,
    userId: guest.id,
    author: "Bob",
    content: "Second of the same block, so it has no header.",
    createdAt: nowSeconds - 290,
    editedAt: null,
  },
  {
    id: 4,
    channelId: 2,
    userId: admin.id,
    author: "Pablo",
    content: "A reply.\nWith a second line.",
    createdAt: nowSeconds - 120,
    editedAt: nowSeconds - 60,
  },
];

const seededHistory = new Map([
  [2, { messages, hasMore: true, loading: false, error: null }],
]);

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
    history: seededHistory,
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

console.log("\ntext channels");
seed();
render("chat with history", <App />, [
  "First of a block.",
  // The author of an old message is rendered from the message itself, since
  // this client has never seen that user.
  "Someone who left",
  "(edited)",
  "Yesterday",
  // The composer is available, because this seed can post.
  "Message #general",
]);

seed({ history: new Map([[2, { messages: [], hasMore: false, loading: false, error: null }]]) });
render("chat with an empty channel", <App />, ["Welcome to #general"]);

seed({ history: new Map([[2, { messages: [], hasMore: false, loading: true, error: null }]]) });
render("chat while history is loading", <App />);

// The failed-load banner is rendered from MessageList directly, because
// mounting ChatPanel starts a retry that clears the error before it is seen.
seed();
render(
  "message list after a failed history load",
  <MessageList
    channelName="general"
    messages={messages}
    users={new Map([[guest.id, guest]])}
    roles={new Map(roles.map((role) => [role.id, role]))}
    selfId={admin.id}
    hasMore={false}
    loading={false}
    error="The server refused that."
    canManageMessages={false}
    onLoadOlder={noop}
    onEdit={noop}
    onDelete={noop}
  />,
  ["The server refused that.", "First of a block."],
);

// With SendMessages taken off everyone, the composer is replaced by a reason.
seed({
  self: { ...admin, roles: [1] },
  roles: new Map(
    roles.map((role) =>
      role.managed === "everyone"
        ? [role.id, { ...role, permissions: format(Perm.ViewChannel | Perm.Connect) }]
        : [role.id, role],
    ),
  ),
});
render("chat with posting refused", <App />, [
  "You do not have permission to send messages here.",
]);

// The picker is lazy-loaded behind Suspense in the composer, so it is rendered
// directly here rather than through the App.
render("emoji picker", <EmojiPicker onPick={noop} onClose={noop} />, [
  "Search emoji",
  "Smileys",
  "Flags",
  // A grid that renders no emoji would still pass a bare "did it render" check.
  "\u{1F600}",
]);

// A message of nothing but emoji is rendered large.
seed({
  history: new Map([
    [
      2,
      {
        messages: [
          { id: 1, channelId: 2, userId: admin.id, author: "Pablo", content: "\u{1F389}\u{1F389}", createdAt: nowSeconds - 30, editedAt: null },
        ],
        hasMore: false,
        loading: false,
        error: null,
      },
    ],
  ]),
});
render("chat with an emoji-only message", <App />, ["msg__content--jumbo"]);

console.log("\nedge cases");
seed({ channels: new Map(), self: { ...admin, channelId: null } });
render("server view with no visible channels", <App />);

seed({ self: { ...admin, registered: true, username: "pablo", channelId: null } });
render("account dialog for a registered member", <AccountDialog onClose={noop} />);

seed({ notice: null, saved: [] });
render("server view with no saved servers and no notice", <App />);

// --- behaviour ---------------------------------------------------------------
//
// Two things rendering cannot prove: that picking an emoji reports the right
// character, and that it lands where the caret is rather than at the end.

console.log("\nbehaviour");

function checkThat(name: string, condition: boolean): void {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    failed = true;
  }
}

{
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let picked: string | null = null;

  act(() => {
    root.render(<EmojiPicker onPick={(emoji) => (picked = emoji)} onClose={noop} />);
  });

  const buttons = container.querySelectorAll<HTMLButtonElement>(".picker__emoji");
  checkThat("the picker renders a grid of emoji", buttons.length > 100);

  act(() => {
    buttons[0]?.click();
  });
  checkThat("clicking an emoji reports one character", typeof picked === "string" && picked !== "");

  act(() => {
    root.unmount();
  });
  container.remove();
}

{
  const middle = insertAtCaret("hello world", 5, 5, "\u{1F389}");
  checkThat("an emoji lands at the caret, not at the end", middle.value === "hello\u{1F389} world");
  checkThat("an existing space is not doubled", !middle.value.includes("  "));
  checkThat("the caret ends up past the space", middle.caret === "hello\u{1F389} ".length);

  const replacing = insertAtCaret("hello world", 0, 5, "\u{1F44B}");
  checkThat("a selection is replaced", replacing.value === "\u{1F44B} world");

  const ending = insertAtCaret("hello", 5, 5, "\u{1F389}");
  checkThat("a space is added when none follows", ending.value === "hello\u{1F389} ");

  const empty = insertAtCaret("", 0, 0, "\u{1F389}");
  checkThat("an empty box takes the emoji", empty.value === "\u{1F389} ");
}

console.log(`\n${checks} checks${failed ? ", with failures" : ""}.\n`);

await GlobalRegistrator.unregister();
process.exit(failed ? 1 : 0);
