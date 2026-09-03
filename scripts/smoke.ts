/**
 * End-to-end check between this client and a live Aural server.
 *
 * It drives the real client modules — the address parser, the gateway and the
 * permission resolver — against a running server, which is the only way to
 * catch the two repositories drifting apart. Node has a global WebSocket, so
 * the gateway runs unmodified outside a browser.
 *
 *   node --run smoke -- --address 127.0.0.1:9871 --owner-token XXXX-XXXX
 *
 * Pass `--second-address` as well to include the checks that need two servers
 * at once: what a connection in the background holds, and where the one media
 * session goes.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseAddress, fetchServerInfo } from "../src/lib/address";
import { Gateway } from "../src/lib/gateway";
import { Perm, has, resolve, resolveChannelPermissions } from "../src/lib/permissions";
import { buildDirectory, buildSearchRequest, parseSearchInput } from "../src/lib/search";
import {
  attachmentKind,
  attachmentUrl,
  downloadUrl,
  formatBytes,
  serverOrigin,
} from "../src/lib/uploads";
import { applyOpusPreferences, opusPreferences } from "../src/lib/voice/sdp";
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
  type RoleEvent,
  type ServerInfo,
  type UserEvent,
  type UserMovedEvent,
  type VoiceConnectResult,
  type VoiceStateEvent,
  type WebhookEvent,
  type WebhookListResult,
} from "../src/lib/protocol";
import { useServers } from "../src/store/servers";
import { useSession } from "../src/store/session";

/** The rates Opus encodes at. 44100 is deliberately not one of them. */
const OPUS_SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

/**
 * A minimal audio description, used to check the one place this client edits
 * SDP without needing a WebRTC stack to produce one.
 */
const SAMPLE_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "",
].join("\r\n");

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

/**
 * Runs the vendored RNNoise model over synthetic signals and checks it works.
 *
 * The model is a binary this repository ships but did not build, and the
 * pipeline around it — a worklet, an audio graph — cannot run outside a
 * browser. What runs anywhere is the model, and that is the part worth
 * checking: if the vendored file is ever replaced by something that is not
 * RNNoise, or is RNNoise built for another frame size, this says so rather
 * than a call quietly sounding wrong.
 *
 * What it asserts is the discrimination and not the attenuation, because that
 * is what RNNoise actually does. It suppresses by band gain and never nulls a
 * band, so even pure noise comes out only about fifteen percent quieter — an
 * assertion on loudness would be asserting something the model does not
 * promise. Its voice detector, on the other hand, separates these signals
 * completely: harmonics read as 1.0, noise below 0.6, digital silence exactly
 * 0. That gap is the model working.
 */
async function checkDenoiser(): Promise<void> {
  // Resolved from the working directory rather than from this module: the
  // check runs from a bundle in node_modules/.cache, where a relative path
  // would climb out of the wrong place.
  const wasm = await readFile(
    join(process.cwd(), "node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm"),
  );

  let memory: WebAssembly.Memory;
  // Emscripten's three imports. Nothing here grows the heap — one state and
  // one frame sit far inside the initial sixteen megabytes — so refusing to
  // resize is the honest answer rather than a stub that pretends to.
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
    env: {
      emscripten_memcpy_big: (dest: number, src: number, size: number) => {
        new Uint8Array(memory.buffer).copyWithin(dest, src, src + size);
        return dest;
      },
      emscripten_resize_heap: () => 0,
      __assert_fail: () => {
        throw new Error("rnnoise assertion failed");
      },
    },
  });
  const api = instance.exports as unknown as {
    memory: WebAssembly.Memory;
    __wasm_call_ctors(): void;
    rnnoise_get_frame_size(): number;
    rnnoise_create(model: number): number;
    rnnoise_destroy(state: number): void;
    rnnoise_process_frame(state: number, out: number, input: number): number;
    malloc(size: number): number;
  };
  memory = api.memory;
  api.__wasm_call_ctors();

  const frame = api.rnnoise_get_frame_size();
  check(frame === 480, `a frame is 10 ms at 48 kHz (${frame} samples)`);

  const probe = api.rnnoise_create(0);
  check(probe !== 0, "a denoise state can be created");
  api.rnnoise_destroy(probe);

  const buffer = api.malloc(frame * 4);
  const rms = (values: Float32Array) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

  /** A pseudo-random source that stays sane in doubles, unlike a plain LCG. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };

  /** A crude voiced sound: one pitch with its harmonics rolling off. */
  const voiced = (t: number) => {
    let value = 0;
    for (let h = 1; h <= 24; h += 1) value += Math.sin(2 * Math.PI * 130 * h * t) / h;
    return value / 2.5;
  };

  // RNNoise works in the int16 range rather than the -1..1 the Web Audio API
  // hands out, which is the detail that makes a wrong integration sound quiet
  // rather than broken.
  const SCALE = 32768;

  const measure = (sample: (t: number) => number) => {
    const state = api.rnnoise_create(0);
    let kept = 0;
    let lowest = 1;
    let highest = 0;
    let counted = 0;
    let index = 0;
    for (let i = 0; i < 90; i += 1) {
      const input = new Float32Array(memory.buffer, buffer, frame);
      for (let n = 0; n < frame; n += 1, index += 1) input[n] = sample(index / 48000) * SCALE;
      const before = rms(input.slice());
      const probability = api.rnnoise_process_frame(state, buffer, buffer);
      const after = rms(new Float32Array(memory.buffer, buffer, frame));
      // The network's recurrent state needs a moment; the opening frames are
      // the ones it knows least about and say least about whether it works.
      if (i >= 40) {
        if (before > 0) kept += after / before;
        lowest = Math.min(lowest, probability);
        highest = Math.max(highest, probability);
        counted += 1;
      }
    }
    api.rnnoise_destroy(state);
    return { kept: kept / counted, lowest, highest };
  };

  const noise = random(12345);
  const grain = random(999);
  const speech = measure((t) => voiced(t) * 0.5);
  const hiss = measure(() => noise() * 0.3);
  const both = measure((t) => voiced(t) * 0.5 + grain() * 0.15);
  const silence = measure(() => 0);

  check(speech.lowest > 0.9, `harmonics read as speech (${speech.lowest.toFixed(3)})`);
  check(both.lowest > 0.9, `harmonics under noise still read as speech (${both.lowest.toFixed(3)})`);
  check(hiss.highest < 0.8, `noise never reads as speech (${hiss.highest.toFixed(3)})`);
  check(silence.highest === 0, "digital silence reads as no speech at all");
  check(
    hiss.kept < speech.kept * 0.95,
    `noise is attenuated more than voice (${hiss.kept.toFixed(3)} against ${speech.kept.toFixed(3)})`,
  );
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

  console.log("\nvoice: what the server advertises");
  const voiceConfig = ready.server.voice;
  check(voiceConfig !== undefined, "the server advertises an audio plane");
  check(
    voiceConfig!.mode === "server_host" || voiceConfig!.mode === "client_host",
    `hosting mode is one this client knows (${voiceConfig!.mode})`,
  );
  check(
    OPUS_SAMPLE_RATES.includes(voiceConfig!.sampleRate),
    `sample rate is one Opus encodes at (${voiceConfig!.sampleRate})`,
  );
  check(
    voiceConfig!.minBitrate <= voiceConfig!.bitrate && voiceConfig!.bitrate <= voiceConfig!.maxBitrate,
    "the default bitrate sits inside the range the server allows",
  );
  check(Array.isArray(ready.iceServers), "the snapshot carries an ICE server list");
  check(Array.isArray(ready.voiceStates), "the snapshot carries voice states");

  // A TURN credential must never reach the unauthenticated preview.
  check(
    !("iceServers" in (info as unknown as Record<string, unknown>)),
    "the public preview carries no ICE servers",
  );

  console.log("\nvoice: opus parameters this client asks for");
  const munged = applyOpusPreferences(
    SAMPLE_SDP,
    opusPreferences(voiceConfig!, voiceConfig!.bitrate),
  );
  check(munged.includes("useinbandfec=1"), "forward error correction is requested");
  check(
    munged.includes(`maxaveragebitrate=${voiceConfig!.bitrate}`),
    "the bitrate ceiling reaches the description",
  );
  check(munged.includes("minptime=10"), "the packet time this client wants survives");
  check(
    munged.includes("a=rtpmap:111 opus/48000/2"),
    "everything that is not an opus fmtp line is left alone",
  );
  check(
    applyOpusPreferences("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n", opusPreferences(voiceConfig!, 64000)) ===
      "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n",
    "a description with no opus in it comes back untouched",
  );

  console.log("\nvoice: the noise suppressor");
  await checkDenoiser();

  console.log("\nvoice: opening a session");
  let refusedOutside = false;
  try {
    await alice.gateway.request(Op.VoiceConnect, { channelId: voice.id });
  } catch {
    refusedOutside = true;
  }
  check(refusedOutside, "audio cannot be opened in a channel you are not in");

  await alice.gateway.request(Op.UserMove, { channelId: voice.id });
  await alice.log.wait<UserMovedEvent>(Ev.UserMoved);

  if (voiceConfig!.mode === "client_host") {
    const session = await alice.gateway.request<VoiceConnectResult>(Op.VoiceConnect, {
      channelId: voice.id,
    });
    check(session.mode === "client_host", "the session reports the mode it opened in");
    check(session.sdp === undefined || session.sdp === "", "a client-hosted session is not answered by the server");
    check(session.hostUserId === ready.user.id, "the first arrival is elected host");
    check(
      session.participants.some((state) => state.userId === ready.user.id && state.connected),
      "the caller is listed as a connected participant",
    );

    const hosting = await alice.log.wait<VoiceStateEvent>(Ev.VoiceState);
    check(hosting.state.userId === ready.user.id, "the channel is told who joined its audio");
    check(hosting.state.host, "and that they are hosting it");
  } else {
    // A server-hosted session needs a real offer, which needs a WebRTC stack
    // Node does not have. What can be checked here is that the server refuses
    // to open one without it rather than half-building anything.
    let refusedWithoutOffer = false;
    try {
      await alice.gateway.request(Op.VoiceConnect, { channelId: voice.id });
    } catch {
      refusedWithoutOffer = true;
    }
    check(refusedWithoutOffer, "a server-hosted session is refused without an offer");
  }

  console.log("\nvoice: mute and deafen");
  const deafened = await alice.gateway.request<VoiceStateEvent>(Op.VoiceState, { selfDeaf: true });
  check(deafened.state.selfDeaf, "deafening yourself takes");
  check(deafened.state.selfMute, "deafening yourself mutes you too");

  const heard = await alice.gateway.request<VoiceStateEvent>(Op.VoiceState, { selfDeaf: false });
  check(!heard.state.selfDeaf, "un-deafening takes");
  check(heard.state.selfMute, "un-deafening leaves the mute where it was");

  await alice.gateway.request(Op.VoiceState, { selfMute: false });
  await alice.gateway.request(Op.VoiceLeave, {});
  await alice.gateway.request(Op.UserMove, { channelId: null });
  await settle();

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

  // The member list is a roster: everybody with an account is in it, connected
  // or not, and a guest is in it only while their connection is. Both halves
  // have to hold across the two repositories, so both are checked here against
  // the real server.
  const carol = await open(addressInput);
  await carol.gateway.request<Ready>(Op.AuthGuest, { nickname: "Carol" });
  const carolAccount = await carol.gateway.request<AuthRegisterResult>(Op.AuthRegister, {
    username: `carol_${suffix}`,
    password: "correct-horse-battery",
  });
  await other.log.wait(Ev.UserConnected);
  carol.gateway.close();
  await other.log.wait(Ev.UserDisconnected);
  await settle();

  const late = await open(addressInput);
  const lateReady = await late.gateway.request<Ready>(Op.AuthGuest, { nickname: "Late" });
  const listedCarol = lateReady.users.find((user) => user.id === carolAccount.user.id);
  check(listedCarol !== undefined, "a member who is not connected is still listed");
  check(listedCarol?.online === false, "an absent member is listed as offline");
  check(listedCarol?.status === "offline", "an absent member carries the offline status");
  check(listedCarol?.channelId === null, "an absent member is in no channel");
  check(
    lateReady.users.some((user) => user.id === bobReady.user.id),
    "a connected guest is listed",
  );
  late.gateway.close();

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
  let owner: UserEvent["user"] | null = null;
  if (ownerToken) {
    try {
      owner = (await other.gateway.request<UserEvent>(Op.ServerClaimAdmin, { token: ownerToken })).user;
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
    check(owner?.owner === true, "redeeming it marks the claimer as the owner");
    // Ownership is not a role: the claimer is left holding exactly the roles
    // they signed in with, and every authority all the same.
    check(owner?.roles.length === signedIn.user.roles.length, "and grants no role to carry it");
    const adminRole = ready.roles.find((role) => role.managed === "admin");
    check(
      adminRole !== undefined && !(owner?.roles ?? []).includes(adminRole.id),
      "least of all the admin role, which is the one role only the owner may edit",
    );
    if (adminRole) {
      const renamed = await other.gateway.request<RoleEvent>(Op.RoleUpdate, {
        roleId: adminRole.id,
        name: adminRole.name,
      });
      check(renamed.role.id === adminRole.id, "and the owner can edit it");
    }

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

    // Webhooks: the one surface where a service that has never heard of Aural
    // posts into it. The round trip is worth driving from here rather than only
    // from the server's own tests, because what it proves is that the URL this
    // client builds from the path the server hands back is a URL that works.
    console.log("\nwebhooks");
    const webhookChannel = ready.channels.find((channel) => channel.type === "text")!;
    const minted = await other.gateway.request<WebhookEvent>(Op.WebhookCreate, {
      channelId: webhookChannel.id,
      name: "Smoke Webhook",
    });
    check(minted.webhook.token.length > 20, "a webhook is given a token");
    check(
      minted.webhook.url === `/api/webhooks/${minted.webhook.id}/${minted.webhook.token}`,
      "and a URL in the shape Discord uses",
    );

    const deliveryUrl = serverOrigin(parsed) + minted.webhook.url;
    const delivered = await fetch(`${deliveryUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "posted by something that has never heard of Aural",
        username: "Smoke Bot",
        embeds: [{ title: "A card", description: "with a body", color: 0x12b8a0 }],
      }),
    });
    check(delivered.status === 200, `a Discord-shaped delivery is accepted (${delivered.status})`);
    const deliveredBody = (await delivered.json()) as { id: string; webhook_id: string };
    check(typeof deliveredBody.id === "string", "and answers with the message id, as Discord does");

    // The message reached the channel, with the card and the per-delivery name.
    // Bob's log still holds the messages posted earlier in this run, so the
    // events are drained until the one this delivery caused turns up.
    let arrived = await bob.log.wait<MessageEvent>(Ev.MessageCreated);
    for (let drained = 0; drained < 16 && !arrived.message.webhook; drained += 1) {
      arrived = await bob.log.wait<MessageEvent>(Ev.MessageCreated);
    }
    check(arrived.message.author === "Smoke Bot", "the delivery's username is what the message says");
    check(arrived.message.userId === null, "and it is attributed to no identity");
    check(arrived.message.webhook?.id === minted.webhook.id, "the message names the webhook that posted it");
    check((arrived.message.embeds ?? []).length === 1, "the card travelled with it");

    const listed = await other.gateway.request<WebhookListResult>(Op.WebhookList, {});
    check(
      listed.webhooks.some((hook) => hook.id === minted.webhook.id && hook.lastUsedAt > 0),
      "and the webhook records that it was used",
    );

    await other.gateway.request(Op.WebhookDelete, { webhookId: minted.webhook.id });
    const revoked = await fetch(deliveryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "should not arrive" }),
    });
    check(revoked.status === 404, "deleting a webhook revokes its URL");
  } else if (!ownerToken) {
    console.log("\nownership: skipped, pass --owner-token to include it");
  }

  bob.gateway.close();
  other.gateway.close();

  // Everything above drives the gateway directly. This drives the store the
  // interface actually binds to, which is the only way to catch a wiring
  // mistake between an arriving event and the state a component reads.
  console.log("\nthe store, end to end");
  // Dialling goes through the registry, which is what creates the connection
  // and puts it in the foreground; `useSession` is the view of whichever one
  // that is, exactly as every component sees it.
  await useServers
    .getState()
    .connect({ address: addressInput, nickname: "Store", asNewGuest: true });
  check(useSession.getState().status === "connected", "the store connects");
  check(useServers.getState().foregroundId !== null, "and is the connection on screen");

  const live = useSession.getState();
  check(live.self !== null, "the store knows who it is");
  check(live.channels.size >= 3, "the store holds the channel tree");

  // The roster the store holds outlives a connection: a member who leaves drops
  // to offline where they stand, and a guest leaves the list altogether. This
  // is the reducer the member list reads, so it is driven with real departures.
  const visitor = await open(addressInput);
  await visitor.gateway.request<Ready>(Op.AuthGuest, { nickname: "Visitor" });
  const visitorAccount = await visitor.gateway.request<AuthRegisterResult>(Op.AuthRegister, {
    username: `visitor_${suffix}`,
    password: "correct-horse-battery",
  });
  const passing = await open(addressInput);
  const passingReady = await passing.gateway.request<Ready>(Op.AuthGuest, { nickname: "Passing" });
  await settle();
  check(
    useSession.getState().users.has(visitorAccount.user.id),
    "an arriving member reaches the store",
  );
  check(useSession.getState().users.has(passingReady.user.id), "so does an arriving guest");

  visitor.gateway.close();
  passing.gateway.close();
  await settle();
  const afterLeaving = useSession.getState().users;
  const stayed = afterLeaving.get(visitorAccount.user.id);
  check(stayed !== undefined, "a member who leaves stays in the store");
  check(
    stayed?.online === false && stayed?.status === "offline",
    "and is held there as offline",
  );
  check(stayed?.channelId === null, "and in no channel");
  check(!afterLeaving.has(passingReady.user.id), "a guest who leaves is dropped from the store");

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

  // Two connections at once, which is the whole of what a registry above the
  // store is for: one server on screen holding its messages, the rest holding
  // presence and a badge.
  const secondInput = arg("second-address");
  if (!secondInput) {
    console.log("\nseveral servers: skipped, pass --second-address to include it");
  } else {
    console.log("\nseveral servers");
    const firstId = useServers.getState().foregroundId!;
    const first = useServers.getState().connections.get(firstId)!;

    await useServers
      .getState()
      .connect({ address: secondInput, nickname: "Store", asNewGuest: true });
    const secondId = useServers.getState().foregroundId!;
    check(secondId !== firstId, "a second server opens beside the first");
    check(useServers.getState().connections.size === 2, "and both connections are held");
    check(useSession.getState().serverId === secondId, "the one just opened is the one on screen");

    check(first.getState().status === "connected", "the first server stays connected");
    check(first.getState().users.size > 0, "and still knows who is there");
    check(first.getState().history.size === 0, "but holds no messages while it is behind");

    // What a connection in the background is for: a message arriving on it is
    // a badge, not a page.
    const heckler = await open(addressInput);
    await heckler.gateway.request<Ready>(Op.AuthGuest, { nickname: "Heckler" });
    await heckler.gateway.request(Op.MessageSend, {
      channelId: storeText.id,
      content: "anybody there?",
    });
    await settle();
    check(
      first.getState().unread.get(storeText.id)?.count === 1,
      "a message on a server in the background counts as unread",
    );
    check(first.getState().history.size === 0, "and is not held as a message");

    await heckler.gateway.request(Op.MessageSend, {
      channelId: storeText.id,
      content: "@Store are you about?",
    });
    await settle();
    const waiting = first.getState().unread.get(storeText.id);
    check(waiting?.count === 2, "a second message adds to the badge");
    check(waiting?.mention === true, "and one that names you sets the mention flag");

    // Coming back to it costs one request, which is the trade the asymmetry
    // was made for.
    useServers.getState().focus(firstId);
    check(useServers.getState().foregroundId === firstId, "the first server comes back to the front");
    check(useSession.getState().serverId === firstId, "and is what the session reads again");
    first.getState().setActiveChannel(storeText.id);
    await first.getState().openChannel(storeText.id);
    check(
      (first.getState().history.get(storeText.id)?.messages.length ?? 0) > 0,
      "its messages are fetched again on the way in",
    );
    check(!first.getState().unread.has(storeText.id), "and reading the channel clears its badge");

    heckler.gateway.close();
    await settle();

    // One microphone: entering a voice channel anywhere ends the call running
    // anywhere else, and the server that had it is left rather than abandoned.
    const voiceOn = (state: typeof first extends { getState(): infer S } ? S : never) =>
      [...state.channels.values()].find((channel) => channel.type === "voice");
    const firstVoice = voiceOn(first.getState());
    const second = useServers.getState().connections.get(secondId)!;
    const secondVoice = voiceOn(second.getState());
    if (firstVoice && secondVoice) {
      await first.getState().joinChannel(firstVoice.id);
      await settle();
      check(useServers.getState().voiceId === firstId, "joining voice takes the one media session");

      await second.getState().joinChannel(secondVoice.id);
      await settle();
      check(useServers.getState().voiceId === secondId, "joining voice elsewhere moves it");
      check(
        first.getState().self?.channelId === null,
        "and leaves the channel on the server that had it",
      );
      await second.getState().leaveChannel();
      await settle();
      check(useServers.getState().voiceId === null, "leaving voice gives the media session up");
    }

    useServers.getState().close(secondId);
    check(useServers.getState().connections.size === 1, "closing one server leaves the other alone");
    check(useServers.getState().foregroundId === firstId, "with the remaining one on screen");
  }

  const openId = useServers.getState().foregroundId!;
  useServers.getState().close(openId);
  check(!useServers.getState().connections.has(openId), "leaving a server takes it off the rail");

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((error: unknown) => {
  console.error("\nsmoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
