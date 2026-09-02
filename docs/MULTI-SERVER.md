# Multiple simultaneous servers

Aural connects to one server at a time. The rail down the left of
[`ServerView`](../src/views/ServerView.tsx) looks like Discord's, but clicking
another entry does not switch between live connections — it drops the one that
is open and dials the new one. This note records why that is, what already
generalises, and what the shape of the change would be, because the decision
that matters is not the plumbing but how much memory a server in the background
is allowed to hold.

Written alongside the per-channel window in
[`src/store/session.ts`](../src/store/session.ts), which is the half of the
problem that could be solved without any of this.

---

## Where it stands

`useSession` is one store holding one `Gateway`, and `connect()` closes the
previous socket before opening the next:

```ts
const previous = get().gateway;
previous?.close("switching servers");
```

Everything the connection knew goes with it — `users`, `channels`, `roles`,
`history`, `search`, `jump` are all replaced with empty ones. So the cost of a
background server today is zero, and the cost of coming back to one is a full
handshake plus a fresh page of whichever channel is opened. On a local server
that is imperceptible. Over the internet, on a server with many channels, it is
the whole reason this is worth doing.

## What already generalises

More than expected, because the identity model never assumed one server:

- **Bookmarks are per server and carry their own credentials.**
  `SavedServer` in [`src/lib/storage.ts`](../src/lib/storage.ts) is keyed by
  `host:port` and holds its own `token`, `nickname` and `username`. Two live
  connections would need no new storage, and because the key is the address, a
  client cannot accidentally hold two connections to one server and displace
  itself — the server allows one session per identity, and that rule bites
  per server, not across them.
- **Permission resolution is pure.**
  [`src/lib/permissions.ts`](../src/lib/permissions.ts) takes roles and a user
  and returns a mask. It reads no global state, so it works against as many
  servers as it is handed.
- **The voice store is already told which server it is on.** `VoiceLink` in
  [`src/store/voice.ts`](../src/store/voice.ts) carries `serverId`, and
  per-person volumes are keyed by it, because volumes had to survive a
  reconnection. That key is exactly the one a second connection would need.

## What is singular and would have to move

- **The store itself.** `useSession` would become a store per connection, with
  a small registry above it naming which is in the foreground. Every component
  reads `useSession(...)` directly, so the mechanical part of the change is
  routing those reads through the foreground connection.
- **The reconnection state lives in module scope**, not in the store:
  `reconnectTimer`, `reconnectAttempt`, `lastOptions`, `resumeChannelId`,
  `connectionEpoch`, `scheduledEpoch`, `jumpNonce`. One backoff for one
  connection. These move inside the per-connection closure; nothing about them
  is hard, but they are silent — two connections would share one timer and one
  epoch counter and misbehave in ways that look like a server problem.
- **Voice stays singular on purpose.** One microphone, one media session. A
  second connection should be able to be in a text channel and not in a voice
  one; entering voice on a background server means leaving it on the
  foreground one. That is a product decision, not a technical limit, and it
  should be made deliberately rather than discovered.

## The memory budget

This is the part worth settling first, because it decides everything else.

The per-channel window bounds one connection: `CHANNEL_WINDOW` messages per
channel, trimmed at whichever end the reader is furthest from. What it does not
bound is the number of channels, or the number of connections. A client holding
five servers of thirty channels each, all filled, would be holding a hundred and
fifty windows.

The rule that follows from that, and the one Discord settled on:

- **The foreground server** keeps the full window on the channel being read,
  and the last page on channels recently left, so going back is instant.
- **Background servers keep no messages at all.** They hold what the unread
  badge needs — the last read message id, a count, whether anything mentioned
  you — and fetch history when they come to the front. A background connection
  is worth having for presence, for notifications and for skipping the
  handshake; it is not worth having for the messages, which are one request
  away and stale by the time you look.

That asymmetry is what keeps N connections from costing N times one connection.
Without it, the window is a bound on a number that is still multiplied by
however many servers somebody has bookmarked.

A **least-recently-used cut of the channels themselves** is the remaining gap
even for one connection: a history entry is created when a channel is first
opened and is dropped only when the channel is deleted, when it stops being
visible, or when the connection ends. Bounded per channel, unbounded in
channels. It has not been done because the window made it much less urgent —
thirty channels at a full window is a few thousand messages, not a few hundred
thousand — but it is the honest completion of this, and it is a prerequisite
for background servers rather than a separate task.

## Order of work

1. LRU cut of channel histories in one connection, keyed on when a channel was
   last read. Small, testable now, and needed by everything below.
2. Move the module-scope reconnection state into the store's closure. No
   behaviour change; makes a second instance possible at all.
3. A registry of connections with one in the foreground, and component reads
   routed through it.
4. Unread state for background connections, which is the only thing they hold.
5. Decide voice: one media session, and what entering it on a second server
   does to the first.

Steps 1 and 2 are worth doing whether or not the rest ever happens.
