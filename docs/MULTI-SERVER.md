# Multiple simultaneous servers

Aural holds as many server connections as somebody opens, and renders one of
them. The rail down the left of [`ServerView`](../src/views/ServerView.tsx)
switches between live connections rather than dropping one to dial the next.

The decision that mattered was never the plumbing. It was how much memory a
server in the background is allowed to hold, because that is what decides
whether holding five of them costs five times one. This note records the answer
and where each part of it lives.

---

## The shape

Three files, in the order a read should take them:

- **[`src/store/connection.ts`](../src/store/connection.ts)** — one connection:
  the socket, the roster, the channels, the roles, the messages, the search, and
  the reconnection backoff. It is a store per connection built by
  `createConnection`, not a slice of a global one. Everything that used to sit in
  module scope — the retry timer, the attempt count, the epoch counter, the
  channel to walk back into after a drop — lives in that closure. Two
  connections sharing one timer and one epoch counter misbehave in ways that
  look like a server problem.
- **[`src/store/servers.ts`](../src/store/servers.ts)** — the registry: every
  connection held, which one is in the foreground, which one has the microphone,
  and the bookmarks. It owns the three decisions no single connection can make
  for itself, and hands each one a small `ConnectionHost` to ask them through.
  That is what keeps the two files from importing each other.
- **[`src/store/session.ts`](../src/store/session.ts)** — `useSession`, which is
  now a view of whichever connection is in front. Every component that reads
  `useSession(...)` means "the server I am looking at", so none of them had to
  change. Anything that has to reach past the foreground — the rail, the call
  strip, a badge on a server nobody is looking at — reads the registry directly
  through `useConnection`, `useCall` or `useServerRegistry`.

## The memory budget

This is the part that decides everything else.

- **The foreground server** keeps the full window on the channel being read
  (`CHANNEL_WINDOW`, four pages), and the page under the composer on channels
  recently left (`IDLE_CHANNEL_WINDOW`). Coming back to one of those is instant;
  going further back is a request, which is what it was before it was read.
- **A cut of the channels themselves.** The window bounds one channel;
  `OPEN_CHANNEL_LIMIT` bounds how many of them hold anything at all. The cut
  falls on whichever were read longest ago, and never on the one on screen or
  one with a request in flight. Without it, somebody who walks through fifty
  channels holds fifty windows and is reading one of them.
- **Background servers keep no messages.** Going behind another server drops the
  history, the search and the jump on the way out — at the moment the reason for
  holding them goes, not the next time they are asked for. What they keep is what
  a badge needs: a count per channel and whether any of it named you. The
  messages behind that badge are one request away and stale by the time somebody
  looks at them.

That asymmetry is what keeps N connections from costing N times one. Everything
else a background connection holds — the roster, the channel tree, the voice
states — is bounded by the server rather than by how long the client has been
running.

## Unread

The protocol has no unread of its own, and no mentions either: a message is
text. So the client counts what it can honestly count. A message is *read* only
where somebody could have read it — the channel open on the connection in the
foreground, in a window that is actually visible — and a *mention* is an `@`
followed by a nickname or username with nothing wordlike after it, matched
case-insensitively and never on a substring. `mentionsSelf` is deliberately mean
about substrings, because a badge that lights up for somebody else's name is
worse than one that misses.

Coming back to a hidden window clears the channel that is open, which is what
`visibilitychange` in `ServerView` is for.

## Voice stays singular

One microphone, one media session, however many servers are open. What is *not*
singular is who is in which voice channel: user ids are per server, so
`voiceStates` and `speaking` live in each connection, and a client looking at
server A never draws the mute icon of whoever happens to share an id on server
B. [`src/store/voice.ts`](../src/store/voice.ts) keeps the engine, the
preferences, the devices and this client's own state on the server carrying the
call.

Entering a voice channel takes the microphone from whichever connection had it,
and the registry leaves that server's channel on the way — nobody is left
sitting in a channel this client stopped listening to. That is a product
decision rather than a technical limit, so the interface asks first: joining
voice while a call runs on another server opens a confirmation naming both.
The store does what it is told either way, which is what keeps a moderator
moving somebody into a channel working through the same path.

The one place that guard is not enough is a reconnection. A server coming back
walks into the channel it was dropped from, and doing that would take the
microphone from a call that started meanwhile. `restoreChannel` declines when
another connection is in one: whoever is in a call now chose to be, and more
recently.

## What the interface shows

- Each rail entry reads its own connection: a ring when it is connected, a
  faded state while it is dialling or coming back, an unread badge (red when
  something named you), and a dot on the server carrying the call.
- Right-clicking a rail entry opens it, copies its address, disconnects it
  without forgetting it, or forgets it entirely.
- The call strip reads the connection carrying the call rather than the one on
  screen, and names that server when they differ, with a click to go there.
- A connection that ends while others are open reports it as a notice naming the
  server, because it is read from wherever the reader happens to be by then.
- The connect screen is the registry's screen: it marks the servers already
  open, dials the rest, and shows what went wrong with the last attempt.

## What is checked

- `scripts/render-check.tsx` mounts the rail with badges and a call running,
  and drives the least-recently-read cut and the idle trim directly.
- `scripts/smoke.ts` takes `--second-address` and runs the two-server half
  against two live servers: that a background connection holds presence and no
  messages, that a message arriving on it becomes a badge and a mention, that
  coming back fetches the channel and clears it, and that entering voice on one
  server moves the media session off the other and leaves its channel.
