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
import {
  Ev,
  Op,
  PROTOCOL_VERSION,
  type AuthRegisterResult,
  type Channel,
  type ChannelEvent,
  type Ready,
  type Role,
  type ServerInfo,
  type UserMovedEvent,
} from "../src/lib/protocol";

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

  console.log("\npermission enforcement");
  let refused = false;
  try {
    await bob.gateway.request(Op.ChannelCreate, { name: "Nope", type: "voice" });
  } catch (error) {
    refused = (error as { code?: string }).code === "forbidden";
  }
  check(refused, "a guest is refused channel creation");

  if (ownerToken) {
    console.log("\nownership and administration");
    await other.gateway.request(Op.ServerClaimAdmin, { token: ownerToken });
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
  } else {
    console.log("\nownership: skipped, pass --owner-token to include it");
  }

  bob.gateway.close();
  other.gateway.close();

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((error: unknown) => {
  console.error("\nsmoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
