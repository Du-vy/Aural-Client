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
const { ConfirmDialog } = await import("@/components/dialogs/ConfirmDialog");
const { DeleteMessageDialog } = await import("@/components/dialogs/DeleteMessageDialog");
const { MemberDialog } = await import("@/components/dialogs/MemberDialog");
const { NicknameDialog } = await import("@/components/dialogs/NicknameDialog");
const { ContextMenu } = await import("@/components/ContextMenu");
const { EmojiPicker } = await import("@/components/EmojiPicker");
const { MessageList } = await import("@/components/MessageList");
const { SearchResults } = await import("@/components/SearchResults");
const { insertAtCaret } = await import("@/components/MessageComposer");
const { ServerSettingsDialog } = await import("@/components/dialogs/ServerSettingsDialog");
const { ExternalLinkDialog } = await import("@/components/dialogs/ExternalLinkDialog");
const { MessageContent } = await import("@/components/MessageContent");
const { MessageAttachments } = await import("@/components/attachments/MessageAttachments");
const { AttachmentTray } = await import("@/components/AttachmentTray");
const { Markdown } = await import("@/components/attachments/Markdown");
const { TextAttachment } = await import("@/components/attachments/TextAttachment");
const { parseMarkdown, parseInline } = await import("@/lib/markdown");
const { attachmentKind, formatBytes, extensionOf, attachmentUrl } = await import("@/lib/uploads");
const { parseAddress } = await import("@/lib/address");
const { extractUrls, classifyUrl, isOnlyMediaUrls, tokenizeMessageText } = await import("@/lib/links");
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
const { useSession, EMPTY_SEARCH } = await import("@/store/session");
const { setLanguage, getLanguage, t, SUPPORTED_LANGUAGES } = await import("@/lib/i18n");

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

function seed(overrides: Partial<Parameters<typeof useSession.setState>[0]> = {}) {
  useSession.setState({
    status: "connected",
    server,
    self: admin,
    users: new Map([
      [admin.id, admin],
      [guest.id, guest],
      [absent.id, absent],
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
// The offline group is what says the member list is a roster rather than a
// list of who is connected.
render("server view", <App />, ["Offline — 1", "Carla"]);
render("account dialog", <AccountDialog onClose={noop} />);
render("channel dialog", <ChannelDialog parentId={1} onClose={noop} />);
render("channel dialog in edit mode", <ChannelDialog editChannelId={2} onClose={noop} />, ["Edit Channel", "Save Changes"]);
render("nickname dialog", <NicknameDialog userId={guest.id} onClose={noop} />, ["Change Nickname"]);
render("member dialog", <MemberDialog userId={guest.id} onClose={noop} />);
render("server settings dialog", <ServerSettingsDialog onClose={noop} />);
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
    selfId={admin.id}
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
        selfId={admin.id}
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
useSession.setState({ status: "idle", server: null, self: null, saved: [] });
for (const lang of SUPPORTED_LANGUAGES) {
  setLanguage(lang.code);
  checkThat(`language can be set to ${lang.name} (${lang.code})`, getLanguage() === lang.code);
  checkThat(`translation key 'common.cancel' exists in ${lang.code}`, t("common.cancel").length > 0);
  checkThat(`translation key 'connect.title' exists in ${lang.code}`, t("connect.title").length > 0);
  render(`connect screen in ${lang.name}`, <App />, [t("connect.connectButton")]);
}
// Reset back to English
setLanguage("en");


console.log(`\n${checks} checks${failed ? ", with failures" : ""}.\n`);

await GlobalRegistrator.unregister();
process.exit(failed ? 1 : 0);

