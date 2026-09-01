/**
 * End-to-end check between this client and a live Aural server.
 *
 * It drives the real client modules — the address parser, the gateway and the
 * permission resolver — against a running server, which is the only way to
 * catch the two repositories drifting apart. Node has a global WebSocket, so
 * the gateway runs unmodified outside a browser.
 *
 *   node --run smoke -- --address 127.0.0.1:9871 --owner-token XXXX-XXXX
 */

import { parseAddress, fetchServerInfo } from "../src/lib/address";
import { Gateway } from "../src/lib/gateway";
import { Perm, has, resolve, resolveChannelPermissions } from "../src/lib/permissions";
import { buildDirectory, buildSearchRequest, parseSearchInput } from "../src/lib/search";
import { attachmentKind, attachmentUrl, downloadUrl, formatBytes } from "../src/lib/uploads";
import {
  Ev,
  Op,
  PROTOCOL_VERSION,
  type AuthRegisterResult,
  type Channel,
  type ChannelEvent,
  type MessageDeletedEvent,
  type MessageEvent,
  type MessageHistoryResult,
  type MessageSearchResult,
  type Ready,
  type Role,
  type ServerInfo,
  type UserMovedEvent,
} from "../src/lib/protocol";
import { useSession } from "../src/store/session";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

let checks = 0;
function check(condition: unknown, description: string): asserts condition {
  checks += 1;
  if (!condition) {
    console.error(`  FAIL  ${description}`);
    process.exitCode = 1;
    throw new Error(description);
  }
  console.log(`  ok    ${description}`);
}

/** Collects events so a test can wait for one that may already have arrived. */
class EventLog {
  private readonly seen: Array<{ op: string; payload: unknown }> = [];
  private readonly waiters = new Map<string, (payload: unknown) => void>();

  record(op: string, payload: unknown): void {
    const waiter = this.waiters.get(op);
    if (waiter) {
      this.waiters.delete(op);
      waiter(payload);
      return;
    }
    this.seen.push({ op, payload });
  }

  wait<T>(op: string, timeoutMs = 5000): Promise<T> {
    const index = this.seen.findIndex((entry) => entry.op === op);
    if (index !== -1) {
      const [entry] = this.seen.splice(index, 1);
      return Promise.resolve(entry!.payload as T);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(op);
        reject(new Error(`event ${op} never arrived`));
      }, timeoutMs);
      this.waiters.set(op, (payload) => {
        clearTimeout(timer);
        resolve(payload as T);
      });
    });
  }
}

async function open(addressInput: string) {
  const address = parseAddress(addressInput);
  const log = new EventLog();
  let onClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    onClosed = resolve;
  });
  const gateway = await Gateway.open(address, {
    onEvent: (op, payload) => log.record(op, payload),
    onClose: () => onClosed(),
  });
  return { address, gateway, log, closed };
}

/**
 * Waits for the events caused by a request to arrive and be applied.
 *
 * An action sends its request and ignores the reply, so the state it produces
 * lands one round trip later, when the broadcast event comes back.
 */
function settle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves true when a connection closes within the timeout. */
function closesWithin(closed: Promise<void>, ms: number): Promise<boolean> {
  return Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

async function main() {
  const addressInput = arg("address") ?? "127.0.0.1:9871";
  const ownerToken = arg("owner-token");

  console.log(`\nAural client smoke test against ${addressInput}\n`);

  console.log("address parsing");
  const parsed = parseAddress(addressInput);
  check(parsed.wsUrl.endsWith("/ws"), "builds a /ws endpoint");
  check(parsed.infoUrl.endsWith("/info"), "builds an /info endpoint");
  check(parseAddress("example.com").port === 9871, "defaults to port 9871");
  check(parseAddress("wss://example.com").port === 443, "defaults wss to port 443");
  check(parseAddress("[::1]:9871").wsUrl === "ws://[::1]:9871/ws", "keeps IPv6 brackets");

  console.log("\nserver preview");
  const info = (await fetchServerInfo(parsed)) as ServerInfo;
  check(info.protocolVersion === PROTOCOL_VERSION, `speaks protocol v${PROTOCOL_VERSION}`);
  check(typeof info.name === "string" && info.name.length > 0, "reports a name");

  console.log("\nguest identity");
  const alice = await open(addressInput);
  check(alice.gateway.hello.server.protocolVersion === PROTOCOL_VERSION, "hello carries the protocol version");

  const ready = await alice.gateway.request<Ready>(Op.AuthGuest, { nickname: "Alice" });
  check(typeof ready.sessionToken === "string" && ready.sessionToken.length > 20, "a guest is given a session token");
  check(ready.user.registered === false, "a fresh guest is not registered");
  check(ready.channels.length >= 3, "the seeded channel tree arrives");
  check(ready.roles.length >= 3, "the seeded roles arrive");

  console.log("\npermission resolution agrees with the server");
  const roles = new Map<number, Role>(ready.roles.map((role) => [role.id, role]));
  const channels = new Map<number, Channel>(ready.channels.map((channel) => [channel.id, channel]));
  const held = ready.user.roles.map((id) => roles.get(id)!).filter(Boolean);
  const clientMask = resolve(held);
  check(clientMask === BigInt(ready.permissions), "the client resolves the same mask the server sent");
  check(has(clientMask, Perm.Connect | Perm.Speak), "a default guest may connect and speak");
  check(!has(clientMask, Perm.ManageChannels), "a default guest may not manage channels");

  const everyoneId = ready.roles.find((role) => role.managed === "everyone")!.id;
  const voice = ready.channels.find((channel) => channel.type === "voice")!;
  const inVoice = resolveChannelPermissions(clientMask, everyoneId, ready.user.roles, voice.id, channels);
  check(has(inVoice, Perm.Connect), "the guest may connect to the seeded voice channel");

  console.log("\nresuming an identity");
  const resumed = await open(addressInput);
  const back = await resumed.gateway.request<Ready>(Op.AuthToken, { token: ready.sessionToken });
  check(back.user.id === ready.user.id, "the stored token resumes the same identity");
  check(!back.sessionToken, "resuming does not mint a second token");
  // One connection per identity: the session just resumed takes the slot.
  check(await closesWithin(alice.closed, 5000), "the displaced connection is closed");

  console.log("\nclaiming the identity");
  const suffix = Date.now().toString(36).slice(-6);
  const claimed = await resumed.gateway.request<AuthRegisterResult>(Op.AuthRegister, {
    username: `alice_${suffix}`,
    password: "correct-horse-battery",
  });
  check(claimed.user.id === ready.user.id, "claiming keeps the same identity");
  check(claimed.user.registered, "the identity is now an account");
  check(claimed.user.roles.length === ready.user.roles.length + 1, "claiming grants the managed member role");

  console.log("\nsigning in from another device");
  const other = await open(addressInput);
  const signedIn = await other.gateway.request<Ready>(Op.AuthLogin, {
    username: `alice_${suffix}`,
    password: "correct-horse-battery",
  });
  check(signedIn.user.id === ready.user.id, "the credentials reach the same identity");
  check(!!signedIn.sessionToken, "signing in mints a token for this device");
  check(await closesWithin(resumed.closed, 5000), "signing in elsewhere closes the earlier session");

  console.log("\npresence");
  const bob = await open(addressInput);
  const bobReady = await bob.gateway.request<Ready>(Op.AuthGuest, { nickname: "Bob" });
  await other.log.wait(Ev.UserConnected);
  check(true, "the other client is told Bob connected");

  await bob.gateway.request(Op.UserMove, { channelId: voice.id });
  const moved = await other.log.wait<UserMovedEvent>(Ev.UserMoved);
  check(moved.userId === bobReady.user.id, "the move event names Bob");
  check(moved.to === voice.id, "the move event names the destination");
  check(moved.from === null, "Bob came from no channel");

  console.log("\ntext channels");
  const text = ready.channels.find((channel) => channel.type === "text");
  check(text !== undefined, "the seeded tree has a text channel");

  const before = await bob.gateway.request<MessageHistoryResult>(Op.MessageHistory, {
    channelId: text!.id,
  });
  check(Array.isArray(before.messages), "history reads back as a list");

  const body = `smoke test ${Date.now()}`;
  const posted = await bob.gateway.request<MessageEvent>(Op.MessageSend, {
    channelId: text!.id,
    content: body,
  });
  check(posted.message.content === body, "a message posts and comes back");
  check(posted.message.author === bobReady.user.nickname, "the message names its author");
  check(posted.message.userId === bobReady.user.id, "the message is attributed to the sender");
  check(posted.message.editedAt === null, "a new message is not marked edited");

  // The other connection never asked for it: this is the event fan-out.
  const seen = await other.log.wait<MessageEvent>(Ev.MessageCreated);
  check(seen.message.id === posted.message.id, "the message is announced to everyone");

  const edited = await bob.gateway.request<MessageEvent>(Op.MessageEdit, {
    messageId: posted.message.id,
    content: `${body} (edited)`,
  });
  check(edited.message.id === posted.message.id, "editing keeps the same message");
  check(edited.message.editedAt !== null, "an edited message is stamped");

  const after = await bob.gateway.request<MessageHistoryResult>(Op.MessageHistory, {
    channelId: text!.id,
  });
  check(
    after.messages.some((message) => message.id === posted.message.id),
    "the message is in the history",
  );
  check(
    after.messages.every((message, index) =>
      index === 0 ? true : message.id > after.messages[index - 1]!.id,
    ),
    "history comes back oldest first",
  );

  let emptyRefused = false;
  try {
    await bob.gateway.request(Op.MessageSend, { channelId: text!.id, content: "   " });
  } catch (error) {
    emptyRefused = (error as { code?: string }).code === "bad_request";
  }
  check(emptyRefused, "an empty message is refused");

  await bob.gateway.request(Op.MessageDelete, { messageId: posted.message.id });
  const removed = await other.log.wait<MessageDeletedEvent>(Ev.MessageDeleted);
  check(removed.messageId === posted.message.id, "the deletion is announced to everyone");
  check(removed.channelId === text!.id, "the deletion names its channel");

  console.log("\nsearch");
  // The needle is unique to this run, so the counts below are exact however
  // many times the smoke test has been run against this server before.
  const needle = `photosynthesis${Date.now()}`;
  const asked = await bob.gateway.request<MessageEvent>(Op.MessageSend, {
    channelId: text!.id,
    content: `what is ${needle}?`,
  });
  const answered = await other.gateway.request<MessageEvent>(Op.MessageSend, {
    channelId: text!.id,
    content: `${needle} is how a leaf eats`,
  });

  const found = await bob.gateway.request<MessageSearchResult>(Op.MessageSearch, { query: needle });
  check(found.total === 2, "both messages match the query");
  check(found.hits[0]?.message.id === answered.message.id, "results come back newest first");
  check(found.hits[0]?.before?.id === asked.message.id, "a hit carries the line before it");

  const byAuthor = await bob.gateway.request<MessageSearchResult>(Op.MessageSearch, {
    query: needle,
    authorIds: [bobReady.user.id],
  });
  check(byAuthor.total === 1, "an author filter narrows to one of them");

  // A voice channel carries no messages, and the server drops it rather than
  // refusing the search, exactly as it drops one the caller may not read.
  const elsewhere = await bob.gateway.request<MessageSearchResult>(Op.MessageSearch, {
    query: needle,
    channelIds: [voice.id],
  });
  check(elsewhere.total === 0, "a channel that carries no messages finds nothing");

  const oldestFirst = await bob.gateway.request<MessageSearchResult>(Op.MessageSearch, {
    query: needle,
    sort: "oldest",
  });
  check(oldestFirst.hits[0]?.message.id === asked.message.id, "the oldest sort reverses them");

  // The client's own query language, end to end: one typed line resolves to the
  // request this server answers.
  const directory = buildDirectory(
    new Map(ready.channels.map((channel) => [channel.id, channel])),
    new Map([[bobReady.user.id, bobReady.user]]),
    new Map(),
  );
  const typed = buildSearchRequest(
    parseSearchInput(`in:${text!.name} from:${bobReady.user.nickname} ${needle}`),
    directory,
    { sort: "newest" },
  );
  check(typed.unresolved.length === 0, "a typed line resolves against what the client knows");
  const byLine = await bob.gateway.request<MessageSearchResult>(Op.MessageSearch, typed.request);
  check(byLine.total === 1, "and finds the one message it names");

  const around = await bob.gateway.request<MessageHistoryResult>(Op.MessageHistory, {
    channelId: text!.id,
    around: asked.message.id,
  });
  check(
    around.messages.some((message) => message.id === asked.message.id),
    "jumping to a result loads the page around it",
  );
  check(!around.hasMoreAfter, "the last page of a channel says it is the present");

  await bob.gateway.request(Op.MessageDelete, { messageId: asked.message.id });
  await other.gateway.request(Op.MessageDelete, { messageId: answered.message.id });

  console.log("\npermission enforcement");
  let refused = false;
  try {
    await bob.gateway.request(Op.ChannelCreate, { name: "Nope", type: "voice" });
  } catch (error) {
    refused = (error as { code?: string }).code === "forbidden";
  }
  check(refused, "a guest is refused channel creation");

  // Editing somebody else's words is refused for everyone, ranks included.
  const fromOther = await other.gateway.request<MessageEvent>(Op.MessageSend, {
    channelId: text!.id,
    content: "written by somebody else",
  });
  let editRefused = false;
  try {
    await bob.gateway.request(Op.MessageEdit, {
      messageId: fromOther.message.id,
      content: "rewritten",
    });
  } catch (error) {
    editRefused = (error as { code?: string }).code === "forbidden";
  }
  check(editRefused, "nobody may edit another member's message");
  await other.gateway.request(Op.MessageDelete, { messageId: fromOther.message.id });

  // The owner token is one-time, so a second run against the same server finds
  // it spent. That is the server behaving correctly, not a failure worth
  // aborting the run for.
  let admin = false;
  if (ownerToken) {
    try {
      await other.gateway.request(Op.ServerClaimAdmin, { token: ownerToken });
      admin = true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "forbidden") throw error;
      console.log("\nownership: skipped, that owner token has already been redeemed");
      console.log("           run the server with -new-owner-token to get another");
    }
  }

  if (admin) {
    console.log("\nownership and administration");
    check(true, "the owner token is redeemed");

    const created = await other.gateway.request<ChannelEvent>(Op.ChannelCreate, {
      name: "Smoke Test",
      type: "voice",
      userLimit: 4,
    });
    check(created.channel.name === "Smoke Test", "an administrator can create a channel");

    const announced = await bob.log.wait<ChannelEvent>(Ev.ChannelCreated);
    check(announced.channel.id === created.channel.id, "the new channel is announced to everyone");

    await other.gateway.request(Op.ChannelDelete, { channelId: created.channel.id });
    check(true, "an administrator can delete a channel");
  } else if (!ownerToken) {
    console.log("\nownership: skipped, pass --owner-token to include it");
  }

  bob.gateway.close();
  other.gateway.close();

  // Everything above drives the gateway directly. This drives the store the
  // interface actually binds to, which is the only way to catch a wiring
  // mistake between an arriving event and the state a component reads.
  console.log("\nthe store, end to end");
  const store = useSession.getState();
  await store.connect({ address: addressInput, nickname: "Store", asNewGuest: true });
  check(useSession.getState().status === "connected", "the store connects");

  const live = useSession.getState();
  check(live.self !== null, "the store knows who it is");
  check(live.channels.size >= 3, "the store holds the channel tree");

  const storeText = [...live.channels.values()].find((channel) => channel.type === "text")!;
  await live.openChannel(storeText.id);
  check(
    useSession.getState().history.has(storeText.id),
    "opening a channel fetches its history",
  );

  const line = `store check ${Date.now()}`;
  await live.sendMessage(storeText.id, line);
  // The reply is deliberately ignored by the action: the message reaches state
  // through the broadcast event, like everybody else's.
  await settle();
  const inStore = useSession.getState().history.get(storeText.id);
  check(
    inStore?.messages.some((message) => message.content === line),
    "a sent message reaches the store through its event",
  );

  // Emoji are plain text on the wire, but the sequences that build a family or
  // a flag are held together by joiners a careless filter would eat. The
  // server has its own test for this; here it is checked through real client
  // modules, which is where a mangling would actually be noticed.
  const withEmoji = `\u{1F389} \u{1F468}‍\u{1F469}‍\u{1F467} \u{1F44D}\u{1F3FD} \u{1F1E6}\u{1F1F7} ${Date.now()}`;
  await live.sendMessage(storeText.id, withEmoji);
  await settle();
  const emojiHeld = useSession.getState().history.get(storeText.id);
  check(
    emojiHeld?.messages.some((message) => message.content === withEmoji),
    "emoji survive the round trip byte for byte",
  );

  const mine = inStore!.messages.find((message) => message.content === line)!;
  await live.deleteMessage(mine.id);
  await settle();
  check(
    !useSession.getState().history.get(storeText.id)?.messages.some((m) => m.id === mine.id),
    "a deleted message leaves the store through its event",
  );

  // --- search ---------------------------------------------------------------
  //
  // The panel reads everything it shows from the store, so this is the path
  // that matters: a line as it would be typed, resolved against what this
  // client knows, answered by the server, and then jumped into.

  const needleWord = `sarsaparilla${Date.now()}`;
  await live.sendMessage(storeText.id, `first mention of ${needleWord}`);
  await settle();
  await live.sendMessage(storeText.id, `second mention of ${needleWord}`);
  await settle();

  await useSession.getState().runSearch({ input: `in:${storeText.name} ${needleWord}` });
  const searched = useSession.getState().search;
  check(!searched.loading && searched.error === null, "the store runs a search");
  check(searched.total === 2, "and holds every match");
  check(searched.unresolved.length === 0, "the channel named in the line resolved");
  check(
    searched.hits[0]?.before?.id === searched.hits[1]?.message.id,
    "a hit is read together with the line before it",
  );

  const target = searched.hits[1]!.message;
  await useSession.getState().jumpToMessage(target.channelId, target.id);
  check(
    useSession.getState().jump?.messageId === target.id,
    "a jump names the message the view has to move to",
  );

  // Dropping what is held forces the jump to fetch, which is what happens when
  // a result turns up in a channel this client has never opened.
  useSession.setState({ history: new Map() });
  await useSession.getState().jumpToMessage(target.channelId, target.id);
  const reloaded = useSession.getState().history.get(storeText.id);
  check(
    reloaded?.messages.some((message) => message.id === target.id),
    "jumping into a channel that is not held fetches the page around the result",
  );

  useSession.getState().closeSearch();
  check(!useSession.getState().search.open, "closing the panel puts the search away");

  for (const message of reloaded!.messages.filter((m) => m.content.includes(needleWord))) {
    await useSession.getState().deleteMessage(message.id);
  }
  await settle();

  // --- attachments ----------------------------------------------------------
  //
  // A file is the one thing that lives outside both the socket and the
  // database, so it is the one thing neither side's own tests can prove works
  // end to end: upload over HTTP, name over the socket, read back over HTTP.

  const limits = useSession.getState().server?.uploads;
  if (!limits?.enabled) {
    console.log("\nattachments: skipped, this server has uploads switched off");
  } else {
    console.log("\nattachments");
    check(Number(limits.maxFileBytes) > 0, `the server advertises a file limit of ${formatBytes(Number(limits.maxFileBytes))}`);
    check(limits.maxPerMessage > 0, `a message may carry ${limits.maxPerMessage} files`);

    const body = `# Smoke\n\nWritten at ${new Date().toISOString()}.\n`;
    const upload = useSession
      .getState()
      .uploadAttachment(storeText.id, new File([body], "smoke.md", { type: "text/markdown" }));
    const attachment = await upload.done;

    check(attachment.id > 0, "the server accepts a file and gives it an id");
    check(attachment.filename === "smoke.md", "the filename survives the upload");
    // The type is settled by the server from the extension, never taken from
    // what the uploader claimed.
    check(attachment.contentType === "text/plain", "the server decides the content type itself");
    check(Number(attachment.size) === new TextEncoder().encode(body).length, "the recorded size is the real one");
    check(attachmentKind(attachment) === "text", "a markdown file is classified as previewable text");

    const withFile = `here is a file ${Date.now()}`;
    await useSession.getState().sendMessage(storeText.id, withFile, [attachment.id]);
    await settle();

    const carried = useSession
      .getState()
      .history.get(storeText.id)
      ?.messages.find((message) => message.content === withFile);
    check(carried !== undefined, "the message carrying a file reaches the store");
    check(carried?.attachments?.length === 1, "the message carries exactly one file");
    check(carried?.attachments?.[0]?.id === attachment.id, "it carries the file that was uploaded");

    // The URL the server advertises has to work as handed over, since it is
    // what an <img> or <video> tag is given verbatim.
    const address = useSession.getState().address;
    const fileUrl = attachmentUrl(address, carried!.attachments![0]!);
    const fetched = await fetch(fileUrl);
    check(fetched.status === 200, "the advertised URL serves the file");
    check(await fetched.text() === body, "the file comes back byte for byte");
    check(
      (fetched.headers.get("content-disposition") ?? "").startsWith("inline"),
      "a previewable file is served inline",
    );

    const saved = await fetch(downloadUrl(address, carried!.attachments![0]!));
    check(
      (saved.headers.get("content-disposition") ?? "").startsWith("attachment"),
      "the download URL forces a save instead",
    );
    void saved.body?.cancel();

    // Only the head of a file is pulled in for a preview, which needs the
    // server to answer range requests.
    const ranged = await fetch(fileUrl, { headers: { Range: "bytes=0-7" } });
    check(ranged.status === 206, "the server answers range requests");
    check((await ranged.text()).length === 8, "a range request returns only what was asked for");

    // Deleting the message is what deletes the file. This is the whole of the
    // moderation story for attachments, so it is worth proving rather than
    // assuming.
    await useSession.getState().deleteMessage(carried!.id);
    await settle();
    const gone = await fetch(fileUrl);
    check(gone.status === 404, "deleting the message deletes the file it carried");
    void gone.body?.cancel();

    // A message may be nothing but a file.
    const second = useSession
      .getState()
      .uploadAttachment(storeText.id, new File(["second"], "note.txt", { type: "text/plain" }));
    const bare = await second.done;
    await useSession.getState().sendMessage(storeText.id, "", [bare.id]);
    await settle();
    const wordless = useSession
      .getState()
      .history.get(storeText.id)
      ?.messages.find((message) => message.attachments?.some((a) => a.id === bare.id));
    check(wordless !== undefined, "a message can be a file and nothing else");
    check(wordless?.content === "", "such a message carries no text at all");
    await useSession.getState().deleteMessage(wordless!.id);
    await settle();

    // An upload belongs to whoever made it, and to one message only.
    const orphan = useSession
      .getState()
      .uploadAttachment(storeText.id, new File(["once"], "once.txt", { type: "text/plain" }));
    const onceOnly = await orphan.done;
    await useSession.getState().sendMessage(storeText.id, "first and only", [onceOnly.id]);
    await settle();
    let refused = false;
    try {
      await useSession.getState().sendMessage(storeText.id, "again", [onceOnly.id]);
    } catch {
      refused = true;
    }
    check(refused, "an upload cannot be posted to a second message");

    const posted = useSession
      .getState()
      .history.get(storeText.id)
      ?.messages.find((message) => message.content === "first and only");
    if (posted) {
      await useSession.getState().deleteMessage(posted.id);
      await settle();
    }
  }

  useSession.getState().disconnect();

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((error: unknown) => {
  console.error("\nsmoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
