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
import type { Conversation } from "@/lib/protocol";

GlobalRegistrator.register();

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { App } = await import("@/App");
const { AccountDialog } = await import("@/components/dialogs/AccountDialog");
const { ChannelDialog } = await import("@/components/dialogs/ChannelDialog");
const { ConfirmDialog } = await import("@/components/dialogs/ConfirmDialog");
const { DeleteMessageDialog } = await import("@/components/dialogs/DeleteMessageDialog");
const { MemberDialog } = await import("@/components/dialogs/MemberDialog");
const { defaultAutoMod } = await import("@/lib/protocol");
const { emojiDirectory } = await import("@/lib/customEmoji");
const { BanUserDialog } = await import("@/components/dialogs/BanUserDialog");
const { SoundboardPanel } = await import("@/components/SoundboardPanel");
const { KickUserDialog } = await import("@/components/dialogs/KickUserDialog");
const { NicknameDialog } = await import("@/components/dialogs/NicknameDialog");
const { ContextMenu } = await import("@/components/ContextMenu");
const { EmojiPicker } = await import("@/components/EmojiPicker");
const { MentionPicker } = await import("@/components/MentionPicker");
const { MessageList } = await import("@/components/MessageList");
const { RichEmbeds, colorOf } = await import("@/components/embeds/RichEmbed");
const { SearchResults } = await import("@/components/SearchResults");
const { insertAtCaret } = await import("@/components/MessageComposer");
const { ServerSettingsDialog } = await import("@/components/dialogs/ServerSettingsDialog");
const { UserSettingsDialog } = await import("@/components/dialogs/UserSettingsDialog");
const { ExternalLinkDialog } = await import("@/components/dialogs/ExternalLinkDialog");
const { ImageCropDialog } = await import("@/components/dialogs/ImageCropDialog");
const { MessageContent } = await import("@/components/MessageContent");
const { MessageAttachments } = await import("@/components/attachments/MessageAttachments");
const { AttachmentTray } = await import("@/components/AttachmentTray");
const { Markdown } = await import("@/components/attachments/Markdown");
const { TextAttachment } = await import("@/components/attachments/TextAttachment");
const { parseMarkdown, parseInline } = await import("@/lib/markdown");
const { attachmentKind, formatBytes, extensionOf, attachmentUrl } = await import("@/lib/uploads");
const { parseAddress } = await import("@/lib/address");
const { extractUrls, classifyUrl, isOnlyMediaUrls, tokenizeMessageText } = await import("@/lib/links");
const { buildMentions, findMentionQuery, rankMentions, splitMentions } = await import("@/lib/mentions");
const {
  activeTokenAt,
  buildDirectory,
  buildSearchRequest,
  parseDateSpan,
  parseSearchInput,
  replaceTokenAt,
  searchTerms,
  splitHighlights,
} = await import("@/lib/search");
const { addTrustedDomain, isDomainTrusted } = await import("@/lib/storage");
const { Perm, format } = await import("@/lib/permissions");
const {
  useSession,
  EMPTY_SEARCH,
  CHANNEL_WINDOW,
  IDLE_CHANNEL_WINDOW,
  OPEN_CHANNEL_LIMIT,
  clampWindow,
  mentionsSelf,
} = await import("@/store/session");
const { useServers } = await import("@/store/servers");
const { createConnection } = await import("@/store/connection");
const { unreadTotals, manageableWebhookChannels } = await import("@/store/selectors");
const { setLanguage, getLanguage, t, SUPPORTED_LANGUAGES } = await import("@/lib/i18n");
const { Ev } = await import("@/lib/protocol");

type Attachment = import("@/lib/protocol").Attachment;
type Channel = import("@/lib/protocol").Channel;
type Message = import("@/lib/protocol").Message;
type Role = import("@/lib/protocol").Role;
type ServerInfo = import("@/lib/protocol").ServerInfo;
type User = import("@/lib/protocol").User;

// React needs to be told this is a test environment before act() is used.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every request this check makes is answered from here.
 *
 * Two things in the client fetch on render: the OpenGraph embed behind a web
 * link, and the preview of a text attachment. A check that reaches the real
 * internet is one that fails on a train, leaks what is being tested to a third
 * party, and leaves requests in flight for the teardown to abort noisily.
 */
const served: { body: string; status: number; requests: Array<{ url: string; range: string | null }> } = {
  body: "",
  status: 206,
  requests: [],
};

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  served.requests.push({ url: String(input), range: headers.get("Range") });
  return Promise.resolve(
    new Response(served.body, {
      status: served.status,
      headers: { "Content-Type": "text/plain" },
    }),
  );
}) as typeof fetch;

// Ensure default English for standard render assertions
setLanguage("en");


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
    const html = container.innerHTML.length > 0 ? container.innerHTML : document.body.innerHTML;
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

/**
 * The same, for a component with nothing to show until a promise settles.
 *
 * `await act` is what flushes the effect, the call it makes, and the state
 * update its answer causes. The synchronous version above would photograph the
 * loading state and prove nothing about the page.
 */
async function renderAsync(
  name: string,
  element: React.ReactElement,
  expected: string[] = [],
): Promise<void> {
  checks += 1;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(element);
    });
    const html = container.innerHTML.length > 0 ? container.innerHTML : document.body.innerHTML;
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
      await act(async () => {
        root.unmount();
      });
    } catch {
      // Unmount failures are not what this check is about.
    }
    container.remove();
  }
}

/**
 * Runs something with a stub desktop shell in place.
 *
 * Node is a browser as far as this script is concerned, so anything gated on
 * running inside Tauri takes its other branch and is never rendered. These two
 * globals are exactly what `isTauri` and `invoke` look at, so installing them
 * around a render is what puts the desktop half of a page on screen — and
 * removing them afterwards keeps every other check on the browser path each
 * one was written for.
 */
async function withDesktopShell(
  answer: (command: string, args: Record<string, unknown>) => unknown,
  body: () => Promise<void>,
): Promise<void> {
  const globals = globalThis as Record<string, unknown>;
  globals.isTauri = true;
  globals.__TAURI_INTERNALS__ = {
    invoke: (command: string, args: Record<string, unknown>) =>
      Promise.resolve(answer(command, args ?? {})),
  };
  try {
    await body();
  } finally {
    delete globals.isTauri;
    delete globals.__TAURI_INTERNALS__;
  }
}

const noop = () => undefined;

const server: ServerInfo = {
  name: "Test Server",
  description: "A server used to render the client",
  protocolVersion: 1,
  softwareVersion: "0.5.0",
  maxUsers: 64,
  onlineUsers: 2,
  passwordProtected: false,
  registrationEnabled: true,
  guestsAllowed: true,
  voiceMode: "client_host",
  uploads: {
    enabled: true,
    maxFileBytes: String(50 * 1024 * 1024),
    maxTotalBytes: String(5 * 1024 * 1024 * 1024),
    usedBytes: "0",
    maxPerMessage: 10,
  },
};

/** One of each kind of attachment, so every renderer is exercised. */
const attachments: Attachment[] = [
  {
    id: 1,
    filename: "screenshot.png",
    contentType: "image/png",
    size: String(184 * 1024),
    url: "/attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/screenshot.png",
    width: 800,
    height: 450,
  },
  {
    id: 2,
    filename: "clip.mp4",
    contentType: "video/mp4",
    size: String(4 * 1024 * 1024),
    url: "/attachments/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/clip.mp4",
  },
  {
    id: 3,
    filename: "voice-note.mp3",
    contentType: "audio/mpeg",
    size: String(920 * 1024),
    url: "/attachments/cccccccccccccccccccccccccccccccc/voice-note.mp3",
  },
  {
    id: 4,
    filename: "README.md",
    contentType: "text/plain",
    size: "2048",
    url: "/attachments/dddddddddddddddddddddddddddddddd/README.md",
  },
  {
    id: 5,
    filename: "release.zip",
    contentType: "application/zip",
    size: String(12 * 1024 * 1024),
    url: "/attachments/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/release.zip",
  },
];

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
  // A second text channel, so there is one the view does not open by itself:
  // an unread badge only means anything on a channel nobody is reading.
  { id: 5, parentId: 1, name: "announcements", type: "text", topic: "", position: 2, userLimit: 0, overwrites: [] },
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

/** A member who is not connected, which the list groups on her own. */
const absent: User = {
  id: 12,
  nickname: "Carla",
  username: "carla",
  registered: true,
  roles: [1, 2],
  channelId: null,
  online: false,
  status: "offline",
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
  [2, { messages, hasMore: true, hasMoreAfter: false, loading: false, error: null }],
]);

const seededUsers = new Map([
  [admin.id, admin],
  [guest.id, guest],
  [absent.id, absent],
]);
const seededRoles = new Map(roles.map((role) => [role.id, role]));

/** Everyone this check can name, for a mention in a message and in the picker. */
const mentionDirectory = buildMentions(seededUsers, seededRoles);

const testServerId = "127.0.0.1:9871";
const savedServers = [
  { id: testServerId, address: testServerId, name: "Test Server", nickname: "Pablo" },
  { id: "192.168.1.20:9871", address: "192.168.1.20:9871", name: "Second Server", nickname: "Pablo" },
];

/**
 * One connection, with a host that answers for a registry that is not running.
 *
 * The client renders whichever connection is in front, so seeded state that
 * nothing is looking at renders the connect screen instead: the registry has
 * to be told about this one before any of it appears.
 */
const testConnection = createConnection({
  id: testServerId,
  address: testServerId,
  host: {
    foreground: () => true,
    ownsVoice: () => false,
    callElsewhere: () => false,
    takeVoice: () => undefined,
    dropVoice: () => undefined,
    savedChanged: () => undefined,
    ended: () => undefined,
    reveal: () => undefined,
  },
});

function seedRegistry(overrides: Partial<Parameters<typeof useServers.setState>[0]> = {}) {
  useServers.setState({
    connections: new Map([[testServerId, testConnection]]),
    order: [testServerId],
    foregroundId: testServerId,
    voiceId: null,
    dialing: [],
    error: null,
    notice: null,
    saved: savedServers,
    ...overrides,
  });
}

function seed(overrides: Partial<Parameters<typeof useSession.setState>[0]> = {}) {
  seedRegistry();
  useSession.setState({
    status: "connected",
    serverId: testServerId,
    server,
    self: admin,
    users: new Map([
      [admin.id, admin],
      [guest.id, guest],
      [absent.id, absent],
    ]),
    channels: new Map(channels.map((channel) => [channel.id, channel])),
    roles: new Map(roles.map((role) => [role.id, role])),
    notice: "A notice, so its banner renders too.",
    history: seededHistory,
    unread: new Map(),
    activeChannelId: 2,
    voiceStates: new Map(),
    speaking: new Set(),
    ...overrides,
  });
}

/** Back to nothing open, which is the connect screen. */
function seedDisconnected() {
  useServers.setState({
    connections: new Map(),
    order: [],
    foregroundId: null,
    voiceId: null,
    dialing: [],
    error: null,
    notice: null,
    saved: [],
  });
  useSession.setState({ status: "idle", server: null, self: null });
}

console.log("\nrendering the client\n");

console.log("disconnected");
seedDisconnected();
render("connect screen", <App />);

console.log("\nconnected as an administrator");
seed();
// The offline group is what says the member list is a roster rather than a
// list of who is connected.
render("server view", <App />, ["Offline — 1", "Carla"]);
render("account dialog", <AccountDialog onClose={noop} />);
render("channel dialog", <ChannelDialog parentId={1} onClose={noop} />);
render("channel dialog in edit mode", <ChannelDialog editChannelId={2} onClose={noop} />, ["Edit Channel", "Save Changes"]);
render("nickname dialog", <NicknameDialog userId={guest.id} onClose={noop} />, ["Change Nickname"]);
render("member dialog", <MemberDialog userId={guest.id} onClose={noop} />);
render("server settings dialog", <ServerSettingsDialog onClose={noop} />);

// The user settings dialog mounts one page at a time, so a page that throws
// is invisible until somebody clicks its tab. Each is asked for by name.
render("user settings, profile", <UserSettingsDialog onClose={noop} />, ["User Profile", "Profile Identity"]);
render("user settings, account", <UserSettingsDialog initialTab="account" onClose={noop} />, ["My Account", "Claim Account with Password"]);
render("user settings, privacy", <UserSettingsDialog initialTab="privacy" onClose={noop} />, ["Who Can Message You"]);
render("user settings, voice", <UserSettingsDialog initialTab="voice" onClose={noop} />, ["Mic Test"]);
render("user settings, appearance", <UserSettingsDialog initialTab="appearance" onClose={noop} />, ["Interface Themes", "Message Density"]);
render("user settings, language", <UserSettingsDialog initialTab="language" onClose={noop} />, ["Interface Language", "Español"]);
render("user settings, notifications", <UserSettingsDialog initialTab="notifications" onClose={noop} />, ["Notification Sound", "Only mentions", "Chime"]);
// The system settings page is the one page with no browser half: every switch
// on it is held by the shell or by the operating system. So it is checked
// twice — once as a browser sees it, where the honest answer is that there is
// nothing here to change, and once against a stub shell, which is the only way
// the four switches are ever rendered by this script at all.
render("user settings, startup, in a browser", <UserSettingsDialog initialTab="startup" onClose={noop} />, [
  "desktop client",
]);
await withDesktopShell(
  (command) =>
    command === "get_system_settings"
      ? {
          launchOnStartup: true,
          startMinimized: false,
          closeToTray: true,
          hardwareAcceleration: true,
          hardwareAccelerationSupported: true,
          trayAvailable: true,
        }
      : undefined,
  () =>
    renderAsync("user settings, startup, on the desktop", <UserSettingsDialog initialTab="startup" onClose={noop} />, [
      "Launch Aural on System Startup",
      "Minimize to Tray on Close",
      "Hardware Acceleration",
    ]),
);
// And once more with the shell reporting what it cannot do, because a disabled
// switch with a reason beside it is a different render from a working one.
await withDesktopShell(
  (command) =>
    command === "get_system_settings"
      ? {
          launchOnStartup: false,
          startMinimized: false,
          closeToTray: true,
          hardwareAcceleration: true,
          hardwareAccelerationSupported: false,
          trayAvailable: false,
        }
      : undefined,
  () =>
    renderAsync(
      "user settings, startup, with no tray and no GPU switch",
      <UserSettingsDialog initialTab="startup" onClose={noop} />,
      ["could not create a tray icon", "macOS does not offer a switch", "disabled"],
    ),
);
render(
  "delete message dialog",
  <DeleteMessageDialog
    message={messages[0]!}
    author={admin}
    roles={new Map(roles.map((role) => [role.id, role]))}
    onConfirm={noop}
    onClose={noop}
  />,
  ["Delete Message", "PROTIP:", "An author this client has never seen"],
);
render(
  "confirm dialog",
  <ConfirmDialog
    title="Delete Channel"
    subtitle="Are you sure you want to delete #general?"
    confirmText="Delete Channel"
    onConfirm={noop}
    onClose={noop}
  />,
  ["Delete Channel", "Are you sure you want to delete #general?"],
);
render(
  "external link dialog",
  <ExternalLinkDialog
    url="https://example.com/test"
    onConfirm={noop}
    onClose={noop}
  />,
  ["External Link", "https://example.com/test", "example.com"],
);
render(
  "context menu",
  <ContextMenu
    x={100}
    y={100}
    items={[
      { id: "1", label: "Profile" },
      { type: "separator" },
      { id: "2", label: "Roles", items: [{ id: "r1", label: "Member", checked: true }] },
    ]}
    onClose={noop}
  />,
  ["Profile", "Roles"],
);

console.log("\nconnected as a plain guest");
seed({ self: { ...admin, roles: [1] } });
render("server view", <App />);
render("account dialog", <AccountDialog onClose={noop} />);
render("member dialog for another guest", <MemberDialog userId={guest.id} onClose={noop} />);

console.log("\nconnected as the owner");
// Ownership is not a role: the owner holds the everyone role and nothing else,
// and every authority all the same. The crown is the only thing that says so,
// which is why both places it appears are rendered.
const owner: User = { ...admin, roles: [1], owner: true };
seed({
  self: owner,
  users: new Map([
    [owner.id, owner],
    [guest.id, guest],
    [absent.id, absent],
  ]),
});
render("server view marks the owner", <App />, ["member__crown"]);
render("member dialog for the owner", <MemberDialog userId={owner.id} onClose={noop} />, ["Owner"]);

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

seed({
  history: new Map([[2, { messages: [], hasMore: false, hasMoreAfter: false, loading: false, error: null }]]),
});
render("chat with an empty channel", <App />, ["Welcome to #general"]);

seed({
  history: new Map([[2, { messages: [], hasMore: false, hasMoreAfter: false, loading: true, error: null }]]),
});
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
    self={admin}
    hasMore={false}
    hasMoreAfter={false}
    loading={false}
    error="The server refused that."
    canManageMessages={false}
    jump={null}
    onJumpDone={noop}
    onLoadOlder={noop}
    onLoadNewer={noop}
    onReturnToPresent={noop}
    onEdit={noop}
    onDelete={noop}
  />,
  ["The server refused that.", "First of a block."],
);

// A message that names the reader marks the whole row, not just the name.
render(
  "message list holding a message that names the reader",
  <MessageList
    channelName="general"
    messages={[
      {
        id: 9,
        userId: guest.id,
        author: "Bob",
        content: "@Pablo could you look at this",
        createdAt: nowSeconds - 30,
        editedAt: null,
      },
    ]}
    users={seededUsers}
    roles={seededRoles}
    self={admin}
    mentions={mentionDirectory}
    hasMore={false}
    hasMoreAfter={false}
    loading={false}
    error={null}
    canManageMessages={false}
    jump={null}
    onJumpDone={noop}
    onLoadOlder={noop}
    onLoadNewer={noop}
    onReturnToPresent={noop}
    onEdit={noop}
    onDelete={noop}
  />,
  ["msg--mention", "mention--self", "@Pablo"],
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

// A name that resolves is drawn as a mention; one that does not is left alone.
render(
  "message naming a member, a role and everyone",
  <MessageContent
    content="thanks @bob, @Admin and @everyone — not @nobody"
    editedAt={null}
    mentions={mentionDirectory}
    self={admin}
    onOpenLink={noop}
    onOpenMember={noop}
  />,
  ["mention", "@Bob", "@Admin", "@everyone", "@nobody"],
);

// The same message as a webhook posts it: ids rather than names, drawn as the
// names they reach.
render(
  "message naming a member and a role by id",
  <MessageContent
    content={`thanks <@${guest.id}>, <@&3> and <@&1> — not <@4242>`}
    editedAt={null}
    mentions={mentionDirectory}
    self={admin}
    onOpenLink={noop}
    onOpenMember={noop}
  />,
  ["mention", "@Bob", "@Admin", "@everyone", "&lt;@4242&gt;"],
);

// The picker over the composer, offering everybody when nothing is typed yet.
render(
  "the mention picker",
  <MentionPicker
    targets={rankMentions("", mentionDirectory)}
    active={0}
    onHover={noop}
    onPick={noop}
  />,
  ["mention-option", "Bob", "everyone"],
);

// A message with an external link is rendered as an interactive link.
render(
  "message with web link",
  <MessageContent
    content="Check this out: https://github.com/aural-chat/aural"
    editedAt={null}
    onOpenLink={noop}
  />,
  ["msg__link", "https://github.com/aural-chat/aural"],
);

// A message with only an image URL renders media-only without plain text link.
render(
  "message with direct image URL",
  <MessageContent
    content="https://example.com/photo.png"
    editedAt={null}
    onOpenLink={noop}
  />,
  ["msg-embed--image", "msg__media-only"],
);

// A message with only a YouTube URL renders YouTube embed.
render(
  "message with YouTube URL",
  <MessageContent
    content="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    editedAt={null}
    onOpenLink={noop}
  />,
  ["msg-embed--youtube"],
);

console.log("\nattachments");

// The address matters: the server sends a root-relative URL, and it is the
// connected address that turns it into one a browser can actually fetch.
seed({ address: parseAddress("127.0.0.1:9871") });

render(
  "a message carrying one of every kind of file",
  <MessageAttachments attachments={attachments} onOpenLink={noop} />,
  ["attachment--image", "attachment--video", "attachment--audio", "attachment--text", "attachment--file"],
);

render(
  "a message that is nothing but a picture",
  <MessageContent content="" editedAt={null} attachments={[attachments[0]!]} onOpenLink={noop} />,
  ["attachment--image"],
);

render(
  "a message with words and a file",
  <MessageContent
    content="Here is the build."
    editedAt={null}
    attachments={[attachments[4]!]}
    onOpenLink={noop}
  />,
  ["Here is the build.", "release.zip", "12 MB"],
);

render(
  "an image whose file has gone missing",
  <MessageAttachments
    attachments={[{ ...attachments[0]!, url: "missing.png" }]}
    onOpenLink={noop}
  />,
  ["attachment--broken", "no longer available"],
);

render(
  "the composer tray, mid-upload and after a refusal",
  <AttachmentTray
    items={[
      {
        localId: "a",
        file: new File(["x"], "uploading.png", { type: "image/png" }),
        previewUrl: null,
        progress: 0.42,
        attachment: null,
        error: null,
      },
      {
        localId: "b",
        file: new File(["x"], "huge.iso", { type: "application/octet-stream" }),
        previewUrl: null,
        progress: 0,
        attachment: null,
        error: "That file is larger than the 50.0 MB this server allows.",
      },
    ]}
    onRemove={noop}
  />,
  ["uploading.png", "huge.iso", "tray__item--failed", "tray__progress"],
);

render(
  "markdown rendered from an attached file",
  <Markdown
    source={[
      "# Title",
      "",
      "Some **bold** and *italic* and `code`, plus a [link](https://aural.chat).",
      "",
      "- one",
      "- two",
      "",
      "```go",
      "func main() {}",
      "```",
      "",
      "> a quote",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n")}
    onOpenLink={noop}
  />,
  ["Title", "md__pre", "func main() {}", "md__list", "md__quote", "md__table", "msg__link"],
);

console.log("\nsearch");

seed();
useSession.setState({ search: { ...EMPTY_SEARCH, open: true, focus: 1 } });
render("search open with an empty query", <App />, ["search__input", "results__placeholder"]);

{
  const hitMessage: Message = {
    id: 41,
    channelId: 2,
    userId: guest.id,
    author: guest.nickname,
    content: "the deploy pipeline broke again",
    createdAt: nowSeconds - 900,
    editedAt: null,
  };
  seed();
  useSession.setState({
    search: {
      ...EMPTY_SEARCH,
      open: true,
      input: "in:general deploy",
      ran: "in:general deploy",
      total: 1,
      hits: [
        {
          message: hitMessage,
          before: { ...hitMessage, id: 40, content: "what happened?", author: admin.nickname, userId: admin.id },
          after: { ...hitMessage, id: 42, content: "looking now", author: admin.nickname, userId: admin.id },
        },
      ],
    },
  });
  // The words that matched are marked, so the hit itself is only contiguous in
  // the HTML on either side of the mark.
  render("search results with a hit and its neighbours", <App />, [
    "hit__msg--match",
    "hit__mark",
    "pipeline broke again",
    "what happened?",
  ]);

  seed();
  useSession.setState({
    search: { ...EMPTY_SEARCH, open: true, input: "nothing", ran: "nothing", error: "The server refused that." },
  });
  render("search results after a failed search", <SearchResults />, ["results__error"]);

  seed();
  useSession.setState({
    search: {
      ...EMPTY_SEARCH,
      open: true,
      input: "from:nobody hello",
      ran: "from:nobody hello",
      unresolved: [{ key: "from", value: "nobody", start: 0, end: 11 }],
    },
  });
  render("search results warning about a filter it could not resolve", <SearchResults />, [
    "results__warning",
    "from:nobody",
  ]);
}

seed({
  history: new Map([
    [2, { messages, hasMore: true, hasMoreAfter: true, loading: false, error: null }],
  ]),
});
render("a window jumped into, offering the way back to the present", <App />, ["chat__present"]);

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

{
  const urls = extractUrls("Hello https://example.com/test and https://image.png?v=1.");
  checkThat("extractUrls finds and trims urls correctly", urls.length === 2 && urls[0] === "https://example.com/test" && urls[1] === "https://image.png?v=1");

  const imgClassified = classifyUrl("https://foo.com/pic.jpg");
  checkThat("classifyUrl identifies images", imgClassified.type === "image");

  const ytClassified = classifyUrl("https://youtu.be/dQw4w9WgXcQ?t=42");
  checkThat("classifyUrl identifies youtube and params", ytClassified.type === "youtube" && ytClassified.videoId === "dQw4w9WgXcQ" && ytClassified.startTime === 42);

  const videoClassified = classifyUrl("https://foo.com/clip.mp4");
  checkThat("classifyUrl identifies videos", videoClassified.type === "video");

  const audioClassified = classifyUrl("https://foo.com/track.mp3");
  checkThat("classifyUrl identifies audio", audioClassified.type === "audio");

  checkThat("isOnlyMediaUrls is true for pure image url", isOnlyMediaUrls(" https://foo.com/pic.png "));
  checkThat("isOnlyMediaUrls is false when mixed with text", !isOnlyMediaUrls("look at this https://foo.com/pic.png"));

  const tokens = tokenizeMessageText("Look at https://aural.chat right now");
  checkThat("tokenizeMessageText produces link and text tokens", tokens.length === 3 && tokens[1]?.type === "link" && tokens[1]?.url === "https://aural.chat");

  addTrustedDomain("trusted-site.org");
  checkThat("trusted domain is recorded and checked", isDomainTrusted("trusted-site.org") && isDomainTrusted("sub.trusted-site.org") && !isDomainTrusted("untrusted.org"));
}

{
  checkThat(
    "an attachment is classified by what the server says it is",
    attachmentKind(attachments[0]!) === "image" &&
      attachmentKind(attachments[1]!) === "video" &&
      attachmentKind(attachments[2]!) === "audio" &&
      attachmentKind(attachments[3]!) === "text" &&
      attachmentKind(attachments[4]!) === "file",
  );

  checkThat(
    "byte counts read the way a person says them",
    formatBytes(0) === "0 B" &&
      formatBytes(1536) === "1.5 KB" &&
      formatBytes(50 * 1024 * 1024) === "50 MB",
  );

  checkThat(
    "an extension is the last segment, lowercased",
    extensionOf("Report.FINAL.PDF") === "pdf" && extensionOf("Makefile") === "",
  );

  // The relative URL the server sends has to resolve against the address this
  // client connected to, or nothing would load through a proxy.
  const address = parseAddress("192.168.1.5:9871");
  checkThat(
    "an attachment url resolves against the connected server",
    attachmentUrl(address, attachments[0]!) ===
      "http://192.168.1.5:9871/attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/screenshot.png",
  );

  // Markdown must never be able to produce markup, only a tree of nodes.
  const blocks = parseMarkdown("# Heading\n\ntext\n\n- item\n\n```\ncode\n```");
  checkThat(
    "markdown parses into heading, paragraph, list and code",
    blocks.length === 4 &&
      blocks[0]?.type === "heading" &&
      blocks[1]?.type === "paragraph" &&
      blocks[2]?.type === "list" &&
      blocks[3]?.type === "code",
  );

  const inline = parseInline("a **bold** and `**not bold**`");
  checkThat(
    "inline code is never looked inside",
    inline.some((node) => node.type === "strong") &&
      inline.some((node) => node.type === "code" && node.value === "**not bold**"),
  );

  const link = parseInline("[click](javascript:alert(1))");
  checkThat(
    "a link that is not http is stripped of its href",
    link.every((node) => node.type !== "link"),
  );
}

{
  // Editing swaps the message body for a box. Rendering both at once is the
  // kind of mistake a static render check cannot see, so this drives the real
  // button and looks at what is left.
  const withFile: Message = {
    id: 900,
    channelId: 2,
    userId: admin.id,
    author: "Pablo",
    content: "the text being edited",
    createdAt: nowSeconds - 30,
    editedAt: null,
    attachments: [attachments[4]!],
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MessageList
        channelName="general"
        messages={[withFile]}
        users={new Map([[admin.id, admin]])}
        roles={new Map(roles.map((role) => [role.id, role]))}
        self={admin}
        hasMore={false}
        hasMoreAfter={false}
        loading={false}
        error={null}
        canManageMessages={false}
        jump={null}
        onJumpDone={noop}
        onLoadOlder={noop}
        onLoadNewer={noop}
        onReturnToPresent={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );
  });

  const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit message"]');
  checkThat("a message of your own offers an edit button", edit !== null);

  act(() => {
    edit?.click();
  });

  const html = container.innerHTML;
  checkThat("editing opens a box", html.includes("msg__edit-input"));
  checkThat(
    "editing replaces the message rather than doubling it",
    !html.includes("msg__content-wrap"),
  );
  checkThat(
    "the files stay on screen while the words are rewritten",
    html.includes("release.zip"),
  );

  act(() => {
    root.unmount();
  });
  container.remove();
}

{
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MessageContent
        content="https://example.com/cat.png"
        editedAt={null}
        onOpenLink={noop}
      />,
    );
  });

  const img = container.querySelector<HTMLImageElement>(".msg-embed__image");
  checkThat("an external image embed renders an image element", img !== null);
  checkThat("lightbox is initially not open", container.querySelector(".lightbox") === null);

  act(() => {
    img?.click();
  });

  checkThat("clicking an external image opens the lightbox", container.querySelector(".lightbox") !== null);
  checkThat(
    "the lightbox displays the image filename in header",
    container.querySelector(".lightbox__name")?.textContent === "cat.png",
  );

  const closeBtn = container.querySelector<HTMLButtonElement>(
    '.lightbox button[aria-label="Close"], .lightbox button[title="Close"]',
  );
  act(() => {
    closeBtn?.click();
  });

  checkThat("closing the lightbox hides it", container.querySelector(".lightbox") === null);

  act(() => {
    root.unmount();
  });
  container.remove();
}


{
  // A preview that never resolves renders exactly like one still loading, so
  // the only way to tell them apart is to open one and wait for it. This is
  // what catches an effect that cancels its own request.
  served.body = "# Title\n\nsome **prose** from the file.\n";
  served.requests.length = 0;
  // Only this file's requests are counted: the OpenGraph embeds rendered
  // earlier resolve on their own schedule and would otherwise be counted here.
  const asked = () => served.requests.filter((r) => r.url.includes("README.md"));

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <TextAttachment
        attachment={attachments[3]!}
        url="http://127.0.0.1:9871/attachments/dddddddddddddddddddddddddddddddd/README.md"
        onDownload={noop}
        onOpenLink={noop}
      />,
    );
  });

  checkThat("a text file is closed until it is asked for", asked().length === 0);

  const toggle = container.querySelector<HTMLButtonElement>(".attachment__text-toggle");
  await act(async () => {
    toggle?.click();
  });
  // One more turn of the loop, for the fetch and the state it sets.
  await act(async () => {
    await Promise.resolve();
  });

  checkThat("opening it fetches the file once", asked().length === 1);
  checkThat("it asks for only the head of the file", asked()[0]?.range === "bytes=0-65535");

  const html = container.innerHTML;
  checkThat("the preview resolves instead of loading forever", !html.includes("Loading..."));
  checkThat("a markdown file renders as markdown", html.includes("md__h") && html.includes("<strong>"));
  checkThat("the file's text actually reaches the screen", html.includes("some "));

  await act(async () => {
    root.unmount();
  });
  container.remove();
}

console.log("\nthe query language");

{
  const parsed = parseSearchInput('from:Alice in:"off topic" has:link  the  quick fox');
  checkThat("filters and free text are told apart", parsed.text === "the quick fox");
  checkThat("a quoted value keeps its space", parsed.filters[1]?.value === "off topic");
  checkThat("three filters are read", parsed.filters.length === 3);

  const bare = parseSearchInput("hello world");
  checkThat("a line with no filters is all text", bare.filters.length === 0 && bare.text === "hello world");

  const half = parseSearchInput("has:");
  checkThat("a key with no value yet is still a filter", half.filters[0]?.value === "");

  // The caret decides what is being typed, which is what the dropdown offers.
  const token = activeTokenAt("from:al hello", 7);
  checkThat("the caret inside a value reports the key", token.kind === "value" && token.key === "from");
  checkThat("... and how much of the value is written", token.kind === "value" && token.value === "al");

  const word = activeTokenAt("fro", 3);
  checkThat("the caret in a bare word reports a word", word.kind === "word" && word.value === "fro");

  const replaced = replaceTokenAt("from:al hello", 7, "from:Alice");
  checkThat("accepting a suggestion rewrites the token", replaced.input === "from:Alice hello");
  checkThat("... and leaves the caret past it", replaced.caret === "from:Alice ".length);

  const day = parseDateSpan("2026-08-31");
  const month = parseDateSpan("2026-08");
  checkThat("a day spans one day", day !== null && day.end - day.start === 86_400);
  checkThat("a month spans that month", month !== null && month.end - month.start === 31 * 86_400);
  checkThat("an impossible date is refused", parseDateSpan("2026-02-31") === null);
  checkThat("a word is not a date", parseDateSpan("yesterday") === null);

  const directory = buildDirectory(
    new Map(channels.map((channel) => [channel.id, channel])),
    new Map([[admin.id, admin]]),
    new Map([[2, { messages }]]),
  );
  checkThat(
    "only text channels can be searched in",
    directory.channels.every((entry) => entry.name !== "Lobby"),
  );
  checkThat(
    "an author read from history is offered even while offline",
    directory.users.some((entry) => entry.id === guest.id),
  );

  const built = buildSearchRequest(parseSearchInput("in:general from:Pablo has:image hola"), directory, {
    sort: "relevance",
  });
  checkThat("names resolve to the ids the server matches on", built.request.channelIds?.[0] === 2);
  checkThat("an author resolves too", built.request.authorIds?.[0] === admin.id);
  checkThat("has: survives", built.request.has?.[0] === "image");
  checkThat("the words are what is left", built.request.query === "hola");
  checkThat("nothing was left unresolved", built.unresolved.length === 0);

  const unknown = buildSearchRequest(parseSearchInput("from:Nobody hi"), directory, { sort: "newest" });
  checkThat("a name nobody holds is reported, not dropped", unknown.unresolved.length === 1);

  const nothing = buildSearchRequest(parseSearchInput("   "), directory, { sort: "newest" });
  checkThat("an empty line is not a search", nothing.empty);

  // before: and after: exclude the day they name; during: is that day alone.
  const around = buildSearchRequest(parseSearchInput("after:2026-08-31 x"), directory, { sort: "newest" });
  checkThat(
    "after: a day starts the next one",
    around.request.after === parseDateSpan("2026-08-31")!.end,
  );

  checkThat("quotes hold a phrase together", searchTerms('"two words" three').length === 2);

  const marked = splitHighlights("Un CAFÉ con leche", ["cafe"]);
  checkThat(
    "a match is found through case and accent",
    marked.some((part) => part.match && part.value === "CAFÉ"),
  );
  checkThat(
    "and the text either side survives intact",
    marked.map((part) => part.value).join("") === "Un CAFÉ con leche",
  );
}

console.log("\nmulti-language (i18n) verification");
seedDisconnected();
for (const lang of SUPPORTED_LANGUAGES) {
  setLanguage(lang.code);
  checkThat(`language can be set to ${lang.name} (${lang.code})`, getLanguage() === lang.code);
  checkThat(`translation key 'common.cancel' exists in ${lang.code}`, t("common.cancel").length > 0);
  checkThat(`translation key 'connect.title' exists in ${lang.code}`, t("connect.title").length > 0);
  render(`connect screen in ${lang.name}`, <App />, [t("connect.connectButton")]);
}
// Reset back to English
setLanguage("en");

console.log("\nchannel window");

{
  // A channel holds at most CHANNEL_WINDOW messages, and a trim has to say
  // which end it cut or the view draws a gap as if it were an unbroken run.
  const run = (from: number, count: number): Message[] =>
    Array.from({ length: count }, (_, index) => ({
      id: from + index,
      channelId: 1,
      userId: 1,
      author: "Pablo",
      content: `message ${from + index}`,
      createdAt: nowSeconds - (count - index),
      editedAt: null,
    }));

  const short = run(1, CHANNEL_WINDOW);
  const kept = clampWindow(short, "newest");
  checkThat("a run at the window is left alone", kept.messages === short);
  checkThat(
    "and claims nothing about either end",
    kept.hasMore === undefined && kept.hasMoreAfter === undefined,
  );

  const over = run(1, CHANNEL_WINDOW + 50);
  const newest = clampWindow(over, "newest");
  checkThat("a trim leaves exactly the window", newest.messages.length === CHANNEL_WINDOW);
  checkThat("keeping the newest end drops the oldest", newest.messages[0]?.id === 51);
  checkThat("and the newest message survives it", newest.messages.at(-1)?.id === CHANNEL_WINDOW + 50);
  checkThat("cutting the old end says there is more before", newest.hasMore === true);
  checkThat("and says nothing about the end it kept", newest.hasMoreAfter === undefined);

  const oldest = clampWindow(over, "oldest");
  checkThat("keeping the oldest end drops the newest", oldest.messages.at(-1)?.id === CHANNEL_WINDOW);
  checkThat("and the oldest message survives it", oldest.messages[0]?.id === 1);
  checkThat("cutting the new end says there is more after", oldest.hasMoreAfter === true);
  checkThat(
    "which is what leaves an arriving message for the walk back",
    oldest.hasMore === undefined,
  );

  // Spreading the trim last is what makes it win over the page's own account
  // of the channel, which after a cut is no longer this client's to give.
  const patch = { hasMore: false, hasMoreAfter: false, ...clampWindow(over, "newest") };
  checkThat("a trim overrides a page that said there was nothing before", patch.hasMore === true);
  checkThat(
    "and leaves the end it did not cut as the page reported it",
    patch.hasMoreAfter === false,
  );
}


console.log("\nseveral servers at once");

{
  // A channel that has been left keeps the page under its composer and nothing
  // above it: the difference between one full window and one per channel ever
  // opened.
  const run = (from: number, count: number): Message[] =>
    Array.from({ length: count }, (_, index) => ({
      id: from + index,
      channelId: 1,
      userId: 1,
      author: "Pablo",
      content: `message ${from + index}`,
      createdAt: nowSeconds - (count - index),
      editedAt: null,
    }));

  const full = run(1, CHANNEL_WINDOW);
  const idle = clampWindow(full, "newest", IDLE_CHANNEL_WINDOW);
  checkThat("leaving a channel cuts it to one page", idle.messages.length === IDLE_CHANNEL_WINDOW);
  checkThat(
    "and the page kept is the one under the composer",
    idle.messages.at(-1)?.id === CHANNEL_WINDOW,
  );
  checkThat("with the rest reachable again by asking", idle.hasMore === true);

  // The window bounds one channel; this bounds how many of them there are.
  // Without it, somebody who walks through fifty channels holds fifty windows
  // and is reading one of them.
  seed();
  const many = new Map(
    Array.from({ length: OPEN_CHANNEL_LIMIT + 4 }, (_, index) => [
      index + 1,
      { messages: run(1, 3), hasMore: false, hasMoreAfter: false, loading: false, error: null },
    ]),
  );
  many.set(3, {
    messages: run(1, CHANNEL_WINDOW),
    hasMore: false,
    hasMoreAfter: false,
    loading: false,
    error: null,
  });
  useSession.setState({ history: many, activeChannelId: null });
  useSession.getState().setActiveChannel(3);
  const kept = useSession.getState().history;
  checkThat("only so many channels keep their messages", kept.size === OPEN_CHANNEL_LIMIT);
  checkThat("and the cut never takes the one being read", kept.has(3));

  // Reading somewhere else is what cuts the channel just left back to a page.
  useSession.getState().setActiveChannel(4);
  checkThat(
    "leaving a channel trims it where it stands",
    useSession.getState().history.get(3)?.messages.length === IDLE_CHANNEL_WINDOW,
  );
  checkThat(
    "and says the rest is a request away",
    useSession.getState().history.get(3)?.hasMore === true,
  );
  seed();

  // Unread is what a connection in the background holds instead of messages.
  const waiting = unreadTotals(
    new Map([
      [1, { count: 3, mention: false }],
      [2, { count: 4, mention: true }],
    ]),
  );
  checkThat("a rail badge sums every channel", waiting.count === 7);
  checkThat("and counts the channels that named you", waiting.mentions === 1);
  checkThat("nothing waiting is nothing to draw", unreadTotals(new Map()).count === 0);

  const me = { ...admin, nickname: "Pablo", username: "pablo" };
  checkThat("a message naming you is a mention", mentionsSelf("hey @Pablo look", me));
  checkThat("case is not what tells two people apart", mentionsSelf("@pablo?", me));
  checkThat("the username counts as much as the nickname", mentionsSelf("cc @pablo", me));
  checkThat(
    "a longer name that starts the same is somebody else",
    !mentionsSelf("@Pablonia is a country", me),
  );
  checkThat("and a bare mention of nobody is not one", !mentionsSelf("email me @ work", me));
  checkThat(
    "a role somebody holds names them as surely as their own name does",
    mentionsSelf("@Admin look at this", admin, seededRoles),
  );
  checkThat("and everyone means everyone", mentionsSelf("@everyone stand up", guest, seededRoles));

  // An id lights the same badge a name does, or the webhook that posted it
  // would name somebody who is never told.
  checkThat("an id names the person it points at", mentionsSelf(`ping <@${admin.id}>`, admin));
  checkThat("and nobody else", !mentionsSelf(`ping <@${guest.id}>`, admin));
  checkThat("a role id reaches everyone holding it", mentionsSelf("ping <@&3>", admin, seededRoles));
  checkThat("and only them", !mentionsSelf("ping <@&3>", guest, seededRoles));
  checkThat(
    "the everyone role by id still means everyone",
    mentionsSelf("ping <@&1>", guest, seededRoles),
  );
  checkThat("an id nobody answers to names nobody", !mentionsSelf("ping <@4242>", admin, seededRoles));
}

{
  // What an `@` resolves to when a message is read back, which is the only
  // place a mention exists: the server stored the words and nothing else.
  const named = (content: string) =>
    splitMentions(content, mentionDirectory).filter((token) => token.type === "mention");

  checkThat("a nickname reaches the member it names", named("hi @Bob")[0]?.target.id === guest.id);
  checkThat(
    "a username reaches the same person their nickname does",
    named("@carla?")[0]?.target.name === "Carla",
  );
  checkThat("a name nobody answers to is left as typed", named("@nobody at all").length === 0);
  checkThat("an email address is not somebody being named", named("write to bob@b.example").length === 0);
  checkThat("a role can be named as well as a person", named("@Admin please")[0]?.target.kind === "role");
  checkThat("and everyone is a name of its own", named("@everyone")[0]?.target.kind === "keyword");

  // The second spelling, which a Discord-shaped webhook posts and this client
  // only ever reads.
  checkThat("an id reaches the member it names", named(`hi <@${guest.id}>`)[0]?.target.id === guest.id);
  checkThat("and is drawn as their name, not as the id", named(`<@${guest.id}>`)[0]?.value === "@Bob");
  checkThat("a role is named by id with an &", named("<@&3> please")[0]?.target.kind === "role");
  checkThat(
    "the everyone role by id is the keyword that replaced it",
    named("<@&1>")[0]?.target.kind === "keyword",
  );
  checkThat("an id nobody answers to is left as typed", named("<@4242> at all").length === 0);
  checkThat("something that is not an id is not one", named("<@nobody> or <@1a>").length === 0);
  checkThat("nor is one left unclosed", named("<@11 still text").length === 0);
  checkThat(
    "words either side of an id are kept",
    splitMentions(`a <@${guest.id}> b`, mentionDirectory).length === 3,
  );

  // The picker follows the caret rather than the end of the box.
  checkThat("typing an @ starts a name", findMentionQuery("hey @bo", 7)?.query === "bo");
  checkThat("which ends at the caret", findMentionQuery("hey @bo there", 7)?.query === "bo");
  checkThat("an address is not a name being typed", findMentionQuery("bob@bo", 6) === null);
  checkThat("nor is a name left behind on another line", findMentionQuery("@bob\nnext", 9) === null);
  checkThat("two spaces end it", findMentionQuery("@bo  and", 8) === null);
  checkThat(
    "a name just written does not ask to be written again",
    findMentionQuery("hey @Bob ", 9) === null,
  );
  checkThat(
    "but a nickname may still hold a space of its own",
    findMentionQuery("@Bob S", 6)?.query === "Bob S",
  );

  checkThat(
    "the best answer to what was typed is offered first",
    rankMentions("bo", mentionDirectory)[0]?.name === "Bob",
  );
  checkThat(
    "somebody who is here outranks a role and a keyword",
    rankMentions("", mentionDirectory)[0]?.kind === "user",
  );
  checkThat(
    "and a name nobody answers to offers nothing at all",
    rankMentions("nobody", mentionDirectory).length === 0,
  );
}

{
  // The rail is the one part of the client that is about servers nobody is
  // looking at: what is waiting on them, and which one has the call.
  seed({
    unread: new Map([[5, { count: 3, mention: true }]]),
    activeChannelId: null,
  });
  render("server view with unread channels", <App />, ["channel--unread", "channel__badge"]);

  useServers.setState({ voiceId: testServerId });
  render("rail with a call running", <App />, ["rail__call"]);
  useServers.setState({ voiceId: null });

  // A server open but behind another one: the badge is the whole of what it is
  // holding, and its rail entry has to draw it.
  seed({ unread: new Map([[5, { count: 5, mention: false }]]), activeChannelId: null });
  useSession.setState({ serverId: "192.168.1.20:9871" });
  render("rail badge for a server in the background", <App />, ["rail__badge"]);
  seed();
}

console.log("\ndedicated direct messages section");
{
  const server2Id = "192.168.1.50:9871";
  const server2Connection = createConnection({
    id: server2Id,
    address: server2Id,
    host: {
      foreground: () => useServers.getState().foregroundId === server2Id,
      ownsVoice: () => false,
      callElsewhere: () => false,
      takeVoice: () => undefined,
      dropVoice: () => undefined,
      savedChanged: () => undefined,
      ended: () => undefined,
      reveal: () => undefined,
    },
  });

  const carlos1: User = {
    id: 10,
    username: "carlos_dev",
    nickname: "Carlos",
    avatar: "",
    status: "online",
    roles: [1],
    channelId: null,
    registered: false,
    online: true,
  };

  const carlos2: User = {
    id: 20,
    username: "carlos_gaming",
    nickname: "Carlos",
    avatar: "",
    status: "online",
    roles: [1],
    channelId: null,
    registered: false,
    online: true,
  };

  const extraUser1: User = {
    id: 11,
    username: "alice",
    nickname: "Alice",
    avatar: "",
    status: "online",
    roles: [1],
    channelId: null,
    registered: false,
    online: true,
  };

  const extraUser2: User = {
    id: 12,
    username: "charlie",
    nickname: "Charlie",
    avatar: "",
    status: "idle",
    roles: [1],
    channelId: null,
    registered: false,
    online: true,
  };

  const extraUser3: User = {
    id: 13,
    username: "diana",
    nickname: "Diana",
    avatar: "",
    status: "offline",
    roles: [1],
    channelId: null,
    registered: false,
    online: false,
  };

  const now = Math.floor(Date.now() / 1000);
  const server1Conversations = new Map<number, Conversation>([
    [
      carlos1.id,
      {
        id: 1,
        userId: carlos1.id,
        lastMessageAt: now - 10,
        unread: 1,
        lastMessage: {
          id: 100,
          conversationId: 1,
          userId: carlos1.id,
          author: "Carlos",
          content: "Hola desde Test Server!",
          createdAt: now - 10,
          editedAt: null,
        },
      },
    ],
    [
      extraUser1.id,
      {
        id: 2,
        userId: extraUser1.id,
        lastMessageAt: now - 20,
        unread: 0,
        lastMessage: {
          id: 101,
          conversationId: 2,
          userId: extraUser1.id,
          author: "Alice",
          content: "Hey there!",
          createdAt: now - 20,
          editedAt: null,
        },
      },
    ],
    [
      extraUser2.id,
      {
        id: 3,
        userId: extraUser2.id,
        lastMessageAt: now - 30,
        unread: 0,
        lastMessage: {
          id: 102,
          conversationId: 3,
          userId: extraUser2.id,
          author: "Charlie",
          content: "See you later",
          createdAt: now - 30,
          editedAt: null,
        },
      },
    ],
    [
      extraUser3.id,
      {
        id: 4,
        userId: extraUser3.id,
        lastMessageAt: now - 40,
        unread: 0,
        lastMessage: {
          id: 103,
          conversationId: 4,
          userId: extraUser3.id,
          author: "Diana",
          content: "Goodbye",
          createdAt: now - 40,
          editedAt: null,
        },
      },
    ],
  ]);

  testConnection.setState({
    serverId: testServerId,
    status: "connected",
    server: { ...server, name: "Test Server", directMessages: true },
    users: new Map([
      [admin.id, admin],
      [carlos1.id, carlos1],
      [extraUser1.id, extraUser1],
      [extraUser2.id, extraUser2],
      [extraUser3.id, extraUser3],
    ]),
    conversations: server1Conversations,
  });

  server2Connection.setState({
    serverId: server2Id,
    status: "connected",
    server: { ...server, name: "Gaming Lounge", directMessages: true },
    self: admin,
    roles: new Map(roles.map((role) => [role.id, role])),
    channels: new Map(),
    users: new Map([
      [admin.id, admin],
      [carlos2.id, carlos2],
    ]),
    conversations: new Map([
      [
        carlos2.id,
        {
          id: 5,
          userId: carlos2.id,
          lastMessageAt: now - 5,
          unread: 2,
          lastMessage: {
            id: 200,
            conversationId: 5,
            userId: carlos2.id,
            author: "Carlos",
            content: "Sale partida en Gaming Lounge?",
            createdAt: now - 5,
            editedAt: null,
          },
        },
      ],
    ]),
    directHistory: new Map([
      [
        carlos2.id,
        {
          messages: [
            {
              id: 200,
              conversationId: 5,
              userId: carlos2.id,
              author: "Carlos",
              content: "Sale partida en Gaming Lounge?",
              createdAt: now - 5,
              editedAt: null,
            },
          ],
          hasMore: false,
          hasMoreAfter: false,
          loading: false,
          error: null,
        },
      ],
    ]),
  });

  useServers.setState({
    connections: new Map([
      [testServerId, testConnection],
      [server2Id, server2Connection],
    ]),
    order: [testServerId, server2Id],
    foregroundId: testServerId,
    activeSection: "server",
  });

  // 1. In Server mode: test the DM button at top of rail, separator, and DM capping in ChannelSidebar
  render("rail has DM button, separator, and unread badge", <App />, [
    "rail__item--dms",
    "rail__separator",
    "rail__badge--mention",
    "dm-list__more",
  ]);

  // 2. Switch to Direct Messages mode
  useServers.getState().setActiveSection("dms");
  render("dedicated DM section home with sidebar and server badges", <App />, [
    "rail__item--dms rail__item--active",
    "dm-sidebar",
    "dm-home",
    "Test Server",
    "Gaming Lounge",
    "127.0.0.1:9871",
    "192.168.1.50:9871",
  ]);

  // 3. Open conversation with Carlos from Server 2
  useServers.getState().focus(server2Id);
  server2Connection.setState({ activeConversationId: carlos2.id });
  render("active DM conversation with Carlos on Server 2 shows disambiguation badge", <App />, [
    "topbar__server-badge",
    "Gaming Lounge",
    "192.168.1.50:9871",
    "Sale partida en Gaming Lounge?",
  ]);

  // 4. Interactive transitions
  useServers.getState().setActiveSection("server");
  checkThat("initially activeSection is server", useServers.getState().activeSection === "server");
  useServers.getState().setActiveSection("dms");
  checkThat("switching activeSection to dms works", useServers.getState().activeSection === "dms");
  useServers.getState().setActiveSection("server");
  checkThat("switching back to server works", useServers.getState().activeSection === "server");

  // Reset back to defaults
  useServers.getState().setActiveSection("server");
  useServers.getState().focus(testServerId);
  seed();
}

console.log("\nkick user dialog & offline kick verification");
{
  const testOfflineUser: User = {
    id: 99,
    username: "offline_bad_actor",
    nickname: "BadActor",
    avatar: "",
    status: "offline",
    roles: [1],
    channelId: null,
    registered: true,
    online: false,
  };

  render(
    "KickUserDialog renders with user info, reason input, and purge options",
    <KickUserDialog user={testOfflineUser} onConfirm={noop} onClose={noop} />,
    ["kick-dialog", "kick-dialog__user-card", "kick-dialog__textarea", "kick-purge__grid", "BadActor"],
  );
}

console.log("\nwebhooks");
{
  seed();

  const alertEmbed = {
    title: "Disk almost full",
    description: "`/dev/sda1` is at **91%** — see [the dashboard](https://example.com/d)",
    url: "https://example.com/alert",
    color: 0xe5534b,
    author: { name: "monitor", icon_url: "https://example.com/monitor.png" },
    footer: { text: "node-1" },
    timestamp: "2026-09-03T10:00:00Z",
    fields: [
      { name: "Host", value: "node-1", inline: true },
      { name: "Free", value: "4 GB", inline: true },
      { name: "Mount", value: "/", inline: false },
    ],
    thumbnail: { url: "https://example.com/thumb.png" },
    image: { url: "https://example.com/graph.png", width: 800, height: 400 },
  };

  // A webhook message: no account behind it, so the badge and the picture come
  // from the message itself rather than from the member list.
  render(
    "message list holding a webhook message with a card",
    <MessageList
      channelName="general"
      messages={[
        {
          id: 501,
          userId: null,
          author: "Buildbot",
          content: "",
          createdAt: nowSeconds - 60,
          editedAt: null,
          webhook: { id: 7, avatar: "https://example.com/bot.png" },
          embeds: [alertEmbed],
        },
      ]}
      users={seededUsers}
      roles={seededRoles}
      self={admin}
      hasMore={false}
      hasMoreAfter={false}
      loading={false}
      error={null}
      canManageMessages={false}
      jump={null}
      onJumpDone={noop}
      onLoadOlder={noop}
      onLoadNewer={noop}
      onReturnToPresent={noop}
      onEdit={noop}
      onDelete={noop}
    />,
    [
      "Buildbot",
      "msg__app-badge",
      "msg__avatar-webhook",
      "https://example.com/bot.png",
      "rich-embed",
      "Disk almost full",
      // A card with no words in the message is still the whole message, so an
      // empty paragraph must not push it down the row.
      "node-1",
    ],
  );

  // Two webhooks posting under two names must not share one header, even though
  // both messages have a null userId.
  render(
    "two webhooks in a row keep their own headers",
    <MessageList
      channelName="general"
      messages={[
        {
          id: 502,
          userId: null,
          author: "Buildbot",
          content: "build 41 passed",
          createdAt: nowSeconds - 40,
          editedAt: null,
          webhook: { id: 7 },
        },
        {
          id: 503,
          userId: null,
          author: "Alertmanager",
          content: "cpu is high",
          createdAt: nowSeconds - 39,
          editedAt: null,
          webhook: { id: 8 },
        },
      ]}
      users={seededUsers}
      roles={seededRoles}
      self={admin}
      hasMore={false}
      hasMoreAfter={false}
      loading={false}
      error={null}
      canManageMessages={false}
      jump={null}
      onJumpDone={noop}
      onLoadOlder={noop}
      onLoadNewer={noop}
      onReturnToPresent={noop}
      onEdit={noop}
      onDelete={noop}
    />,
    ["Buildbot", "Alertmanager"],
  );

  render(
    "a rich embed draws its author, fields, footer and thumbnail",
    <RichEmbeds embeds={[alertEmbed]} onOpenLink={noop} />,
    [
      "rich-embed__author",
      "monitor",
      "rich-embed__title",
      "rich-embed__field--inline",
      "Host",
      "Mount",
      // Both pictures open full size, so both are buttons rather than bare
      // images: a click handler on an image alone cannot be reached by keyboard.
      "rich-embed__image-btn",
      "rich-embed__thumbnail-btn",
      "rich-embed__thumbnail",
      "rich-embed__footer",
      // The description is Markdown, so the link in it becomes a link.
      "the dashboard",
    ],
  );

  // A card whose fields are all absent still has to render rather than throw:
  // what arrives is written by somebody else's software.
  render("a rich embed with nothing but a description", <RichEmbeds embeds={[{ description: "just this" }]} onOpenLink={noop} />, [
    "just this",
  ]);
  render("no embeds draws nothing at all", <RichEmbeds embeds={[]} onOpenLink={noop} />, []);

  // Clicking either picture opens the lightbox over the conversation.
  for (const [what, picture] of [
    ["the big picture", "rich-embed__image-btn"],
    ["the thumbnail", "rich-embed__thumbnail-btn"],
  ] as const) {
    checks += 1;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(<RichEmbeds embeds={[alertEmbed]} onOpenLink={noop} />);
      });
      const button = container.querySelector<HTMLButtonElement>(`.${picture}`);
      if (!button) throw new Error("no button to click");
      act(() => {
        button.click();
      });
      // The lightbox mounts over the page rather than inside the card.
      if (!document.body.innerHTML.includes("lightbox")) {
        throw new Error("clicking it opened nothing");
      }
      console.log(`  ok    clicking ${what} of a card opens it full size`);
    } catch (error) {
      console.error(
        `  FAIL  clicking ${what} of a card opens it full size: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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

  checkThat("a colour becomes a hex string", colorOf(0xe5534b) === "#e5534b");
  checkThat("a colour keeps its leading zeroes", colorOf(0x0000ff) === "#0000ff");
  checkThat("no colour is no colour", colorOf(undefined) === undefined);

  // Who may mint a webhook is asked per channel, because the permission is held
  // per channel.
  const state = useSession.getState();
  checkThat(
    "an administrator may create a webhook in every text channel",
    manageableWebhookChannels(admin, state.roles, state.channels).length ===
      [...state.channels.values()].filter((channel) => channel.type === "text").length,
  );
  checkThat(
    "a plain guest may create one nowhere",
    manageableWebhookChannels(guest, state.roles, state.channels).length === 0,
  );
  checkThat(
    "and nobody at all may create one nowhere",
    manageableWebhookChannels(null, state.roles, state.channels).length === 0,
  );
}

{
  // The webhook card lives behind the integrations tab, so the dialog is
  // mounted and the tab is clicked: rendering the dialog alone would only ever
  // prove the overview page works.
  checks += 1;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    seed();
    act(() => {
      root.render(<ServerSettingsDialog onClose={noop} />);
    });
    const tab = [...container.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("Integrations"),
    );
    if (!tab) throw new Error("the integrations tab is missing");
    act(() => {
      tab.click();
    });
    const html = container.innerHTML;
    for (const needle of ["webhook-card__compat", "Webhooks", "New Webhook", "KLIPY"]) {
      if (!html.includes(needle)) throw new Error(`rendered without ${JSON.stringify(needle)}`);
    }
    console.log("  ok    the integrations tab shows both the Klipy key and the webhook card");
  } catch (error) {
    console.error(
      `  FAIL  the integrations tab shows both the Klipy key and the webhook card: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
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

console.log("\nreal-time channel and category deletion");
{
  seed();
  const session = useSession.getState();
  checkThat("channel 2 initially exists", session.channels.has(2));
  checkThat("category 1 initially exists", session.channels.has(1));
  checkThat("activeChannelId is initially 2", session.activeChannelId === 2);

  // 1. Test deleting channel 2 when cascaded is null (the exact bug case where Go serialized null)
  session.handleEvent(Ev.ChannelDeleted, { channelId: 2, cascaded: null });
  const afterDeleteChannel = useSession.getState();
  checkThat(
    "deleting a channel with cascaded: null removes it without throwing",
    !afterDeleteChannel.channels.has(2),
  );
  checkThat(
    "deleting the active channel resets activeChannelId to null",
    afterDeleteChannel.activeChannelId === null,
  );

  // 2. Test deleting a category with cascaded children IDs
  session.handleEvent(Ev.ChannelDeleted, { channelId: 1, cascaded: [3] });
  const afterDeleteCategory = useSession.getState();
  checkThat(
    "deleting a category removes the category itself",
    !afterDeleteCategory.channels.has(1),
  );
  checkThat(
    "deleting a category removes its cascaded descendant channels",
    !afterDeleteCategory.channels.has(3),
  );

  // 3. Test deleting when cascaded is undefined
  session.handleEvent(Ev.ChannelDeleted, { channelId: 4 });
  const afterDeleteUndefined = useSession.getState();
  checkThat(
    "deleting a channel with cascaded omitted removes it safely",
    !afterDeleteUndefined.channels.has(4),
  );
}

console.log("\nimage cropping dialog & animated gif support");
{
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  // Minimal 1x1 GIF file bytes
  const gifFile = new File(
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b])],
    "banner.gif",
    { type: "image/gif" },
  );

  await act(async () => {
    root.render(
      <ImageCropDialog
        file={gifFile}
        type="banner"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
  });

  const modal = host.querySelector(".modal--wide");
  checkThat("ImageCropDialog uses modal--wide for spacious layout", !!modal);

  const bannerOverlay = host.querySelector(".image-crop-overlay--banner");
  checkThat("renders banner crop overlay with 3:1 aspect ratio", !!bannerOverlay);

  const gifNotice = host.querySelector(".alert--info");
  checkThat("renders animated GIF preservation notice", !!gifNotice);

  const buttons = Array.from(host.querySelectorAll(".image-crop-footer button"));
  checkThat("renders cancel, upload original, and apply crop buttons", buttons.length === 3);

  const uploadOriginalBtn = buttons.find(
    (b) => b.textContent?.toLowerCase().includes("original"),
  );
  checkThat("renders upload original button for GIFs", !!uploadOriginalBtn);

  const applyCropBtn = buttons.find((b) => b.classList.contains("btn--primary"));
  checkThat("renders primary apply crop button", !!applyCropBtn);

  // Check avatar mode with static image
  const pngFile = new File([new Uint8Array(10)], "avatar.png", { type: "image/png" });
  await act(async () => {
    root.render(
      <ImageCropDialog
        file={pngFile}
        type="avatar"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
  });

  const avatarOverlay = host.querySelector(".image-crop-overlay--avatar");
  checkThat("renders avatar circular crop overlay", !!avatarOverlay);

  const pngButtons = Array.from(host.querySelectorAll(".image-crop-footer button"));
  checkThat("renders cancel and apply crop buttons for static image", pngButtons.length === 2);

  await act(async () => {
    root.unmount();
  });
  host.remove();
}

console.log("\nmoderation, expressions and the soundboard");
{
  const bannedUser: User = {
    id: 98,
    username: null,
    nickname: "Nuisance",
    roles: [1],
    channelId: null,
    registered: false,
    online: true,
  };

  render(
    "the ban dialog says what the ban will reach",
    <BanUserDialog user={bannedUser} onConfirm={noop} onClose={noop} />,
    ["kick-dialog", "Nuisance", "Their address", "Their device", "Permanent"],
  );

  // A ban list with one of each kind of subject: an account, and a guest whose
  // identity was removed with the ban.
  seed({
    bans: [
      {
        id: 1,
        userId: 98,
        userNickname: "Nuisance",
        userUsername: null,
        actorId: admin.id,
        actorNickname: admin.nickname,
        reason: "spam",
        createdAt: nowSeconds - 3600,
        expiresAt: null,
        active: true,
        matches: [
          { kind: "user", count: 1 },
          { kind: "device", count: 2 },
        ],
      },
      {
        id: 2,
        userId: null,
        userNickname: "Gone",
        userUsername: "gone",
        actorId: admin.id,
        actorNickname: admin.nickname,
        reason: "",
        createdAt: nowSeconds - 86400,
        expiresAt: nowSeconds - 60,
        active: false,
        matches: [{ kind: "ip", count: 1 }],
      },
    ],
  });
  render(
    "the ban list, with one in force and one that has run out",
    <ServerSettingsDialog initialTab="bans" onClose={noop} />,
    ["ban-list", "Nuisance", "Device", "Expired", "Address"],
  );

  seed({
    audit: {
      entries: [
        {
          id: 9,
          actorId: admin.id,
          actorName: admin.nickname,
          action: "user.ban",
          targetType: "user",
          targetId: 98,
          targetName: "Nuisance",
          reason: "spam",
          changes: [{ key: "expires", after: "2026-01-01T00:00:00Z" }],
          createdAt: nowSeconds - 3600,
        },
        {
          id: 8,
          actorId: null,
          actorName: "the server",
          action: "automod.action",
          targetType: "channel",
          targetId: 2,
          targetName: "general",
          reason: "words (censor)",
          createdAt: nowSeconds - 7200,
        },
      ],
      hasMore: true,
      loading: false,
      error: null,
    },
  });
  render(
    "the audit log, with a change list and a rule firing",
    <ServerSettingsDialog initialTab="audit" onClose={noop} />,
    ["audit-list", "banned", "Nuisance", "expires", "AutoMod acted in"],
  );

  seed({ automod: { ...defaultAutoMod(), enabled: true, words: { enabled: true, action: "censor", exemptRoles: [3], words: ["tonto"], wholeWord: true } } });
  render(
    "the automod page, with one rule switched on",
    <ServerSettingsDialog initialTab="automod" onClose={noop} />,
    ["AutoMod", "Blocked words", "tonto", "chip--on"],
  );

  seed({
    expressions: new Map([
      [1, { id: 1, kind: "emoji", name: "shrug", url: "/attachments/ffffffffffffffffffffffffffffffff/shrug.png", animated: false, size: "4096", creatorId: admin.id, createdAt: nowSeconds }],
      [2, { id: 2, kind: "sticker", name: "wave", url: "/attachments/gggggggggggggggggggggggggggggggg/wave.png", animated: false, size: "8192", creatorId: admin.id, createdAt: nowSeconds }],
    ]),
  });
  render(
    "the expressions page, with one emoji and one sticker",
    <ServerSettingsDialog initialTab="emojis" onClose={noop} />,
    ["expression-grid", ":shrug:", ":wave:"],
  );

  const sounds = new Map([
    [1, { id: 1, name: "Airhorn", emoji: "", url: "/attachments/hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh/airhorn.wav", durationMs: 2000, volume: 100, size: "192044", creatorId: admin.id, createdAt: nowSeconds }],
  ]);

  seed({ sounds });
  render(
    "the soundboard's management page",
    <ServerSettingsDialog initialTab="sounds" onClose={noop} />,
    ["sound-list", "Airhorn", "2.0s"],
  );

  // The panel in a call, which reads the connection carrying it rather than
  // the one on screen.
  seed({ sounds });
  render("the soundboard panel in a call", <SoundboardPanel onClose={noop} />, [
    "soundboard__grid",
    "Airhorn",
  ]);

  // A message written with a custom emoji resolves it to a picture; one that
  // names nothing stays the text somebody typed.
  const directory = emojiDirectory([
    { id: 1, kind: "emoji", name: "shrug", url: "/attachments/ffffffffffffffffffffffffffffffff/shrug.png", animated: false, size: "4096", creatorId: null, createdAt: nowSeconds },
  ]);
  render(
    "a custom emoji renders where it was written",
    <MessageContent
      content="well :shrug: and :nothing: too"
      editedAt={null}
      emojis={directory}
      onOpenLink={noop}
    />,
    ["emoji--custom", "shrug.png", ":nothing:"],
  );
}

console.log("\nunread notifications and the taskbar count");
{
  const { shouldNotifyHere, setChannelOverride, setServerOverride, MUTED_FOREVER } =
    await import("@/lib/muting");
  const { startUnreadBadgeSync, totalUnread } = await import("@/lib/unreadBadge");
  const { DEFAULT_NOTIFICATIONS } = await import("@/lib/storage");

  const settings = (patch: Partial<typeof DEFAULT_NOTIFICATIONS>) => ({
    ...DEFAULT_NOTIFICATIONS,
    ...patch,
  });

  const here = "notify.example:7000";
  const at = (patch: Partial<Parameters<typeof shouldNotifyHere>[0]> = {}) => ({
    serverId: here,
    channelId: 4 as number | null,
    reach: "none" as const,
    direct: false,
    ...patch,
  });

  const plain = at();
  const named = at({ reach: "direct" });
  const privately = at({ channelId: null, direct: true, reach: "direct" });

  checkThat(
    "every message notifies when the scope is all",
    shouldNotifyHere(plain, settings({ scope: "all" })),
  );
  checkThat(
    "an unnamed message is silent when the scope is mentions",
    !shouldNotifyHere(plain, settings({ scope: "mentions" })),
  );
  checkThat(
    "a mention still notifies when the scope is mentions",
    shouldNotifyHere(named, settings({ scope: "mentions" })),
  );
  checkThat(
    "nothing notifies when the scope is none",
    !shouldNotifyHere(named, settings({ scope: "none" })),
  );
  checkThat(
    "a direct message notifies past a scope of mentions",
    shouldNotifyHere(privately, settings({ scope: "mentions" })),
  );
  checkThat(
    "a direct message notifies past a scope of none",
    shouldNotifyHere(privately, settings({ scope: "none" })),
  );
  checkThat(
    "direct messages can be turned off on their own",
    !shouldNotifyHere(privately, settings({ directMessages: false })),
  );

  // The overrides: a channel disagrees with its server, a server disagrees with
  // the client, and a mute outranks all three.
  setServerOverride(here, { scope: "mentions" });
  checkThat(
    "a server narrows what the client would have allowed",
    !shouldNotifyHere(plain, settings({ scope: "all" })),
  );
  setChannelOverride(here, 4, { scope: "all" });
  checkThat(
    "a channel widens what its server narrowed",
    shouldNotifyHere(plain, settings({ scope: "all" })),
  );
  setChannelOverride(here, 4, { mutedUntil: MUTED_FOREVER });
  checkThat("a muted channel is silent whatever its scope says", !shouldNotifyHere(named));
  setChannelOverride(here, 4, { mutedUntil: Date.now() - 1 });
  checkThat("a mute that has run out is no mute at all", shouldNotifyHere(plain));

  // The keyword and role switches are about being one of many, so somebody's
  // own name goes through both of them.
  setChannelOverride(here, 4, { suppressEveryone: true, suppressRoles: true });
  checkThat("@everyone can be suppressed on its own", !shouldNotifyHere(at({ reach: "keyword" })));
  checkThat("role mentions can be suppressed on their own", !shouldNotifyHere(at({ reach: "role" })));
  checkThat("your own name is not suppressed by either", shouldNotifyHere(named));

  setServerOverride(here, { mutedUntil: MUTED_FOREVER });
  checkThat("a muted server silences a channel that was not muted", !shouldNotifyHere(named));
  checkThat("and silences private messages with it", !shouldNotifyHere(privately));

  setServerOverride(here, { scope: null, mutedUntil: 0 });
  setChannelOverride(here, 4, {
    scope: null,
    mutedUntil: 0,
    suppressEveryone: false,
    suppressRoles: false,
  });

  // A message in a channel nobody has open, on the connection in front. The
  // rest of the client counts it; this is about what the taskbar then says.
  // No conversations: the seed carries a direct message with a badge on it,
  // and this is about what one arriving channel message does to the total.
  seed({ activeChannelId: 2, conversations: new Map() });
  const stop = startUnreadBadgeSync();
  const session = useSession.getState();

  session.handleEvent(Ev.MessageCreated, {
    message: {
      id: 9001,
      channelId: 4,
      userId: guest.id,
      author: guest.nickname,
      content: "anybody there",
      createdAt: Math.floor(Date.now() / 1000),
      editedAt: null,
    },
  });

  checkThat("a message in another channel counts as unread", totalUnread().count === 1);
  checkThat("an ordinary message is not counted as a mention", totalUnread().mentions === 0);

  session.handleEvent(Ev.MessageCreated, {
    message: {
      id: 9002,
      channelId: 4,
      userId: guest.id,
      author: guest.nickname,
      content: `hey <@${admin.id}> look at this`,
      createdAt: Math.floor(Date.now() / 1000),
      editedAt: null,
    },
  });

  checkThat("a second message adds to the count", totalUnread().count === 2);
  checkThat("a message naming you counts as a mention", totalUnread().mentions === 1);

  // The sync coalesces into a microtask, so the title is written after one.
  await Promise.resolve();
  await Promise.resolve();
  checkThat("the window title carries the count", document.title === "(2) Aural");

  session.setActiveChannel(4);
  await Promise.resolve();
  await Promise.resolve();
  checkThat("reading the channel clears the count", totalUnread().count === 0);
  checkThat("and takes the count back out of the title", document.title === "Aural");

  stop();
}

console.log("\nthe generated notification sounds");
{
  const { readFileSync } = await import("node:fs");
  const { NOTIFICATION_SOUNDS } = await import("@/lib/notificationSounds");

  for (const sound of NOTIFICATION_SOUNDS) {
    if (!sound.file) continue;
    // Decoding is the engine's job; what is checked here is that the committed
    // file is a RIFF wave with audio in it, because the bug that produced the
    // first five was an envelope that silenced every one of them.
    const wav = readFileSync(`public/sounds/${sound.file}`);
    const samples = wav.readUInt32LE(40) / 2;
    let peak = 0;
    for (let i = 0; i < samples; i += 1) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + i * 2) / 32768));
    }
    checkThat(
      `${sound.file} is a wave file that is not silent`,
      wav.toString("ascii", 0, 4) === "RIFF" && samples > 1000 && peak > 0.5,
    );
  }
}

console.log("\nthe generated voice sounds");
{
  const { readFileSync } = await import("node:fs");
  const { VOICE_SOUND_FILES } = await import("@/lib/voiceSounds");

  for (const [key, file] of Object.entries(VOICE_SOUND_FILES)) {
    const wav = readFileSync(`public/sounds/${file}`);
    const samples = wav.readUInt32LE(40) / 2;
    let peak = 0;
    for (let i = 0; i < samples; i += 1) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + i * 2) / 32768));
    }
    checkThat(
      `${file} (${key}) is a wave file that is not silent`,
      wav.toString("ascii", 0, 4) === "RIFF" && samples > 1000 && peak > 0.5,
    );
  }
}

console.log("\nanimated media background pause and accessibility");
{
  const { isPotentiallyAnimated, AnimatedImage } = await import("@/components/AnimatedImage");
  const { readAccessibility, writeAccessibility } = await import("@/lib/storage");
  const { AccessibilityPage } = await import("@/components/dialogs/user-settings/AccessibilityPage");
  const { AppearancePage } = await import("@/components/dialogs/user-settings/AppearancePage");

  checkThat("detects .gif as animated", isPotentiallyAnimated("https://example.com/cat.gif"));
  checkThat("detects .webp as animated", isPotentiallyAnimated("https://example.com/sticker.webp"));
  checkThat("detects .apng as animated", isPotentiallyAnimated("https://example.com/anim.apng"));
  checkThat("detects klipy gif as animated", isPotentiallyAnimated("https://cdn.klipy.com/gifs/123"));
  checkThat("identifies static png as not animated", !isPotentiallyAnimated("https://example.com/photo.png"));
  checkThat("identifies static jpg as not animated", !isPotentiallyAnimated("https://example.com/photo.jpg"));

  const initialAcc = readAccessibility();
  checkThat("pauseAnimatedImagesOnBlur is enabled by default", initialAcc.pauseAnimatedImagesOnBlur === true);

  writeAccessibility({ pauseAnimatedImagesOnBlur: false });
  checkThat("can disable pauseAnimatedImagesOnBlur", readAccessibility().pauseAnimatedImagesOnBlur === false);
  checkThat("updates document attribute data-pause-animated-blur", document.documentElement.getAttribute("data-pause-animated-blur") === "false");

  writeAccessibility({ pauseAnimatedImagesOnBlur: true });
  checkThat("can re-enable pauseAnimatedImagesOnBlur", readAccessibility().pauseAnimatedImagesOnBlur === true);
  checkThat("restores document attribute data-pause-animated-blur", document.documentElement.getAttribute("data-pause-animated-blur") === "true");

  const expectedTitle = t("dialogs.userSettings.accessibility.pauseAnimatedOnBlurTitle");
  render("AccessibilityPage renders with pause animated toggle", <AccessibilityPage />, [expectedTitle]);
  render("AppearancePage renders with pause animated toggle", <AppearancePage />, [expectedTitle]);
  render("AnimatedImage renders a static image", <AnimatedImage src="https://example.com/photo.jpg" alt="test" />);
  render("AnimatedImage renders an animated gif", <AnimatedImage src="https://example.com/cat.gif" alt="test gif" />);
}

console.log("\nthe protocol range");
{
  const { protocolFit, PROTOCOL_VERSION, MIN_PROTOCOL_VERSION } = await import("@/lib/protocol");

  const fit = (protocolVersion: number, minProtocolVersion?: number) =>
    protocolFit({ protocolVersion, minProtocolVersion });

  checkThat("a server on this exact revision fits", fit(PROTOCOL_VERSION) === "ok");
  checkThat(
    "a server older than the range, which sends no minimum, fits when it speaks ours",
    fit(PROTOCOL_VERSION, undefined) === "ok",
  );

  // The case the range exists for: a server whose operator has not pulled yet,
  // reached by a client that already updated itself past it. Under the strict
  // equality this replaced, this was a client that could not connect to
  // anything until every server it used had been updated too.
  checkThat(
    "a server one revision behind still fits when it accepts ours",
    fit(PROTOCOL_VERSION, PROTOCOL_VERSION - 1) === "ok" ||
      // Only reachable once the client's own range is wider than one revision;
      // until then there is no "behind" for a server to be that we can accept.
      MIN_PROTOCOL_VERSION === PROTOCOL_VERSION,
  );
  checkThat(
    "a server that also speaks the next revision fits",
    fit(PROTOCOL_VERSION + 1, PROTOCOL_VERSION) === "ok",
  );

  checkThat(
    "a server that speaks only a newer revision is refused",
    fit(PROTOCOL_VERSION + 1, PROTOCOL_VERSION + 1) === "server_too_new",
  );
  checkThat(
    "a newer server sending no minimum is refused",
    fit(PROTOCOL_VERSION + 1) === "server_too_new",
  );
  checkThat(
    "a server too old for anything this client speaks is refused",
    fit(MIN_PROTOCOL_VERSION - 1) === "server_too_old",
  );

  checkThat("the range is not inverted", MIN_PROTOCOL_VERSION <= PROTOCOL_VERSION);
}

console.log("\nupdating in place");
{
  const { updaterSupported, getUpdateState, startUpdateWatch, checkForUpdate } = await import(
    "@/lib/updater"
  );
  const { UpdateBanner } = await import("@/components/UpdateBanner");

  // Everything below is the browser build, which is what this harness is. The
  // point of these is that nothing about the updater reaches for a shell that
  // is not there: the web client has no installer to replace.
  checkThat("a browser build cannot update itself", !updaterSupported());
  checkThat("nothing is pending before anything has looked", getUpdateState().phase === "idle");

  const stop = startUpdateWatch();
  checkThat("the startup watch hands back a way to stop it", typeof stop === "function");
  stop();

  await checkForUpdate(true);
  checkThat(
    "a check in a browser leaves the state alone rather than failing",
    getUpdateState().phase === "idle",
  );

  // Idle is the state the banner must be invisible in, because it is the state
  // the client spends all of its time in.
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<UpdateBanner />);
  });
  checkThat("the banner draws nothing while there is no update", container.innerHTML === "");
  act(() => {
    root.unmount();
  });
  container.remove();
}

console.log("\nnavigation history and mouse/keyboard navigation");
{
  const { useNavigation, startNavigationListener } = await import("@/store/navigation");

  useNavigation.getState().clear();
  checkThat("initially stack is empty", useNavigation.getState().stack.length === 0);
  checkThat("cannot go back when empty", !useNavigation.getState().canGoBack());
  checkThat("cannot go forward when empty", !useNavigation.getState().canGoForward());

  // Record first location
  useNavigation.getState().recordLocation({
    section: "server",
    serverId: "srv1",
    channelId: 10,
    userId: null,
  });
  checkThat("first location pushed", useNavigation.getState().stack.length === 1);
  checkThat("index is 0", useNavigation.getState().index === 0);
  checkThat("cannot go back with 1 entry", !useNavigation.getState().canGoBack());

  // Duplicate record is ignored
  useNavigation.getState().recordLocation({
    section: "server",
    serverId: "srv1",
    channelId: 10,
    userId: null,
  });
  checkThat("duplicate location ignored", useNavigation.getState().stack.length === 1);

  // Record second location
  useNavigation.getState().recordLocation({
    section: "server",
    serverId: "srv1",
    channelId: 20,
    userId: null,
  });
  checkThat("second location pushed", useNavigation.getState().stack.length === 2);
  checkThat("index is 1", useNavigation.getState().index === 1);

  // Record third location (DM)
  useNavigation.getState().recordLocation({
    section: "dms",
    serverId: "srv1",
    channelId: null,
    userId: 55,
  });
  checkThat("third location pushed", useNavigation.getState().stack.length === 3);
  checkThat("index is 2", useNavigation.getState().index === 2);

  // Truncation on divergence test:
  // Set index to 1 (as if user went back to second entry)
  useNavigation.setState({ index: 1 });
  checkThat("index moved to 1", useNavigation.getState().index === 1);
  // Now navigate to a new channel
  useNavigation.getState().recordLocation({
    section: "server",
    serverId: "srv1",
    channelId: 30,
    userId: null,
  });
  checkThat("forward history truncated", useNavigation.getState().stack.length === 3);
  checkThat("stack contains new destination", useNavigation.getState().stack[2]?.channelId === 30);
  checkThat("index points to new destination", useNavigation.getState().index === 2);

  // Test startNavigationListener
  const stopNav = startNavigationListener();
  checkThat("navigation listener returns unregister function", typeof stopNav === "function");
  stopNav();

  useNavigation.getState().clear();
}

console.log("\nopening a channel, and going back to the one before it");
{
  const { useNavigation } = await import("@/store/navigation");

  useNavigation.getState().clear();
  seed();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });

  checkThat("the seeded channel is the one open", useSession.getState().activeChannelId === 2);

  const row = container.querySelector<HTMLElement>('[title="announcements"]');
  checkThat("the other text channel has a row to click", row !== null);

  // The channel used to be held twice, here and on the connection, with an
  // effect on each side answering the other's write. One click set the two
  // trading it back and forth until React tore the tree down, which is what a
  // window gone blank on a click looks like from the outside.
  let clickError: string | null = null;
  try {
    act(() => {
      row?.click();
    });
  } catch (error) {
    clickError = error instanceof Error ? error.message : String(error);
  }
  checkThat(`clicking a channel does not loop the render${clickError ? `: ${clickError}` : ""}`, clickError === null);
  checkThat("the channel clicked is the one open", useSession.getState().activeChannelId === 5);
  checkThat("the view is still on screen", container.innerHTML.length > 0);
  checkThat("both channels are in the history", useNavigation.getState().stack.length === 2);

  // Back is the mouse's side button, and it moves the channel by writing to the
  // connection: what the view has selected has to follow that write.
  let backError: string | null = null;
  try {
    await act(async () => {
      await useNavigation.getState().goBack();
    });
  } catch (error) {
    backError = error instanceof Error ? error.message : String(error);
  }
  checkThat(`going back does not loop the render${backError ? `: ${backError}` : ""}`, backError === null);
  checkThat("going back reopens the channel before it", useSession.getState().activeChannelId === 2);
  checkThat("going back is not recorded as a new place", useNavigation.getState().stack.length === 2);

  act(() => {
    root.unmount();
  });
  container.remove();
  useNavigation.getState().clear();
}

console.log("\na conversation read beside the channel list, and a trail that refuses to move");
{
  const { useNavigation } = await import("@/store/navigation");

  useNavigation.getState().clear();
  seed();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });

  act(() => {
    useSession.getState().setActiveConversation(guest.id);
  });

  // A conversation read without leaving the server is still the server's
  // screen. Recorded as the DM section it would come back with the wrong
  // sidebar, on a remount the reader never asked for.
  const recorded = useNavigation.getState().stack.at(-1);
  checkThat("a conversation read in a server keeps the server section", recorded?.section === "server");
  checkThat(
    "the conversation is what was recorded",
    recorded?.userId === guest.id && recorded?.channelId === null,
  );
  checkThat("nothing is left held once the view reports where it landed", !useNavigation.getState().isNavigating);

  act(() => {
    root.unmount();
  });
  container.remove();

  // A channel list that has not arrived is not somewhere to land: the trail
  // stays put rather than stepping onto an entry nothing was drawn for.
  const before = useNavigation.getState().index;
  useSession.setState({ channels: new Map(), activeChannelId: null });
  let moved = true;
  await act(async () => {
    moved = await useNavigation.getState().goBack();
  });
  checkThat("going back to a server with no channels is refused", !moved);
  checkThat("a refused move leaves the trail where it was", useNavigation.getState().index === before);
  checkThat("a refused move does not leave the trail held", !useNavigation.getState().isNavigating);

  useNavigation.getState().clear();
  seed();
}

console.log("\nwhat the mouse's Back button reaches");
{
  const { useMouseBack } = await import("@/store/navigation");

  const answered: string[] = [];
  function Overlays({ over }: { over: boolean }) {
    useMouseBack(true, () => answered.push("under"));
    useMouseBack(over, () => answered.push("over"));
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Overlays over />);
  });

  let reachedTheWindow = 0;
  function countBubbled() {
    reachedTheWindow += 1;
  }
  window.addEventListener("mouseup", countBubbled);

  function pressBack(): void {
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 3 }));
  }

  pressBack();
  checkThat("only the topmost overlay answers Back", answered.length === 1 && answered[0] === "over");
  checkThat("Back stops at the overlay rather than reaching the history", reachedTheWindow === 0);

  act(() => {
    root.render(<Overlays over={false} />);
  });
  pressBack();
  checkThat("the one underneath answers once the top one is gone", answered.length === 2 && answered[1] === "under");

  act(() => {
    root.unmount();
  });
  container.remove();
  pressBack();
  checkThat("nothing answers once every overlay is closed", answered.length === 2);
  checkThat("Back reaches the history again with nothing over the view", reachedTheWindow === 1);

  window.removeEventListener("mouseup", countBubbled);
}

console.log("\nshowing away by itself, and coming back from it");
{
  const { startIdleWatch } = await import("@/lib/idle");
  const { readAutoAway, writeAutoAway } = await import("@/lib/storage");
  const { Op } = await import("@/lib/protocol");
  type UserStatus = import("@/lib/protocol").UserStatus;

  /** Answers a status change the way the server does: the echo, then the reply. */
  const asked: string[] = [];
  function connectFakeGateway(status: UserStatus): void {
    seed();
    useSession.setState({
      self: { ...admin, status },
      gateway: {
        isOpen: true,
        request: (op: string, payload: unknown) => {
          if (op === Op.UserUpdate) {
            const next = (payload as { status?: UserStatus }).status ?? "online";
            asked.push(next);
            useSession.setState({ self: { ...admin, status: next } });
          }
          return Promise.resolve({});
        },
      } as never,
    });
  }

  /** Lets the microtask the watcher schedules, and the request it makes, run. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // The status belongs to the server, not to the connection, so a client that
  // quit or dropped while away signs back in still away. The note left on disk
  // is the only thing that knows the away was ever a guess.
  connectFakeGateway("idle");
  writeAutoAway([testServerId]);
  let stopIdle = startIdleWatch();
  await tick();
  checkThat("an away left over from a previous session is taken back", asked.includes("online"));
  checkThat("the connection reads as online again", useSession.getState().self?.status === "online");
  checkThat("the marker is dropped once it has been taken back", readAutoAway().length === 0);
  stopIdle();

  // A guess does not overrule a statement. Do-not-disturb was chosen on
  // purpose, so all that is left to do with the marker is forget it.
  asked.length = 0;
  connectFakeGateway("dnd");
  writeAutoAway([testServerId]);
  stopIdle = startIdleWatch();
  await tick();
  checkThat("a status chosen by hand is not overruled", asked.length === 0);
  checkThat("but its marker is not kept either", readAutoAway().length === 0);
  stopIdle();

  // Nothing to take it back on yet. The marker has to outlive the attempt, or
  // a client that opens before its server answers would forget for good.
  asked.length = 0;
  seedDisconnected();
  writeAutoAway(["203.0.113.9:9871"]);
  stopIdle = startIdleWatch();
  await tick();
  checkThat("a marker for a server that is not connected is kept", readAutoAway().length === 1);
  checkThat("and nothing is asked of a server that is not there", asked.length === 0);
  stopIdle();

  writeAutoAway([]);
  seed();
}

console.log(`\n${checks} checks${failed ? ", with failures" : ""}.\n`);

await GlobalRegistrator.unregister();
process.exit(failed ? 1 : 0);

