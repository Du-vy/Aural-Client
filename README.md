# Aural Client

The client for [Aural](https://github.com/Du-vy?tab=repositories&q=Aural), an open source voice and
chat platform that pairs a Discord-like interface with TeamSpeak-like servers:
people run their own, and you reach them by address.

React and TypeScript on Vite, wrapped by Tauri v2 so the same codebase ships as
a desktop app and an Android app.

> **Status: v0.5.** Connecting, identity, the channel tree, roles, permissions,
> presence, text messaging, file attachments, search and voice all work against
> a real server.

## Quick start

Node 20.19+ is all you need for the web app; the desktop and Android builds add
Rust and a per-platform toolchain on top. [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
lists every prerequisite, what each one is actually for, and how to verify it.

```sh
npm install
npm run dev
```

On Windows, `run.bat` does both in one double-click, and `run-desktop.bat` does
the same for the Tauri app.

Open http://localhost:5173 and enter the address of an
[Aural server](https://github.com/Du-vy/Aural-Server), for example
`127.0.0.1:9871`. Port 9871 is assumed when you leave it out.

The dev server binds every interface, so a phone on the same network can load
the client at `http://YOUR-IP:5173` while the responsive layout is being worked
on.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173. |
| `npm run build` | Type check, then build to `dist/`. |
| `npm run typecheck` | Type check only. |
| `npm run render-check` | Mounts every screen and dialog in a DOM against seeded state. |
| `npm run smoke` | Drives the real client modules against a live server. |
| `npm run icons` | Redraws the app icon and derives every platform variant. |
| `npm run emoji` | Regenerates the emoji catalogue from the Unicode list. |
| `npm run tauri:dev` | Runs the desktop shell. Needs Rust. |
| `npm run tauri:build` | Builds desktop installers. Needs Rust. |
| `npm run tauri:android` | Runs the Android app. Needs Rust and the Android SDK/NDK. |

## Testing

Two checks cover the two ways this client can break.

**`npm run render-check`** mounts every screen and dialog in a real DOM against
seeded state, as an administrator, as a plain guest, and with empty state, then
asserts the rendered HTML actually contains what it should. A type check proves
the props line up; this proves the components render the state they are given.

**`npm run smoke`** is the one that matters most. It drives the real address
parser, the real gateway, the real permission resolver and the real store
against a running server, and asserts among other things that **the client
resolves the same permission mask the server sent**. It is what catches the two
repositories drifting apart.

Its last section drives the store rather than the gateway, which is the only
way to catch a wiring mistake between an event arriving and the state a
component reads.

```sh
# in the server repository
./aural-server                       # note the owner token it prints

# here
npm run smoke -- --address 127.0.0.1:9871 --owner-token PASTE-TOKEN-HERE
```

The owner token is optional; without it the administration checks are skipped.

## How this talks to a server

The canonical protocol specification lives in the server repository at
[`docs/PROTOCOL.md`](https://github.com/Du-vy/Aural-Server/blob/main/docs/PROTOCOL.md).
`src/lib/protocol.ts` mirrors the Go definitions in `internal/protocol`, and
`src/lib/permissions.ts` mirrors `internal/permissions`. When the server's
protocol package changes, those two files change with it.

A single WebSocket carries everything. Requests get promised replies; events
arrive unprompted and drive nearly all state, because an action sends its
request and then does nothing with the reply — the server broadcasts the
resulting change back to everyone, the caller included. That keeps one code path
for "something changed" instead of two that can disagree.

### Identity

There is no Aural account. Each server issues its own identity, and the client
stores the session token that server minted in `localStorage`:

```
connect ──► auth.guest   ──► identity + session token, stored here
                              │
reconnect ► auth.token   ─────┘  same person, not a new one
                              │
            auth.register ────┴─► the same identity, now with a username
                              │
            auth.login    ────┴─► that identity, from any device
```

A guest who clears this client's storage loses that identity for good. Claiming
it with a username and password is what makes it recoverable, and the client
says so plainly in the account dialog rather than letting people find out later.

The stored token is a credential. Anyone who can read the browser profile can
resume the identity, which is the same exposure a desktop client has in its
configuration file.

### Permissions

The client resolves permissions itself so the interface can disable what you
cannot do instead of letting you try and be refused. The server checks
everything again regardless — the client-side copy is for the interface, never
for enforcement.

Masks are 64-bit and travel as decimal strings, so they are `bigint` here: a
JavaScript number loses precision above 2^53.

### Mentions

Typing `@` opens a list of who can be named: the members of the server, the
roles on it, and the two keywords `@everyone` and `@here`. Arrow keys move it,
Enter or Tab writes the name, Escape dismisses it.

**A mention is text.** The protocol has no field for one — a message is words,
and words are all the server stores — so `src/lib/mentions.ts` is a convention
over them rather than a wire format. That has one real consequence and one real
benefit. The consequence is that a client cannot enforce anything about them:
`@everyone` lights a badge on the clients that see it and claims no authority
the person typing did not already have. The benefit is that a mention is
resolved when it is *read*, against whoever this client knows right now, so
renaming somebody renames them through the whole history — the same reason a
message carries its author's name live rather than frozen.

A name resolves against every spelling its owner answers to, nickname and
username alike, longest match first so a nickname holding a space survives the
round trip. A name nobody answers to is left exactly as it was typed: an `@`
in front of a stranger is characters, not a person, and drawing it as a
mention would be the client inventing one.

Being named marks the whole row, not just the pill inside it, and lights the
channel and server badges through the same `mentionsSelf` the unread counters
already used — now aware of roles as well as names.

### Attachments

The `+` beside the message box picks files; dropping them on the composer or
pasting a screenshot does the same thing. Each one starts uploading the moment
it is added rather than when the message is sent, so by the time a sentence is
typed the file is usually already there and pressing Enter is instant. Uploads
run independently and each shows its own progress, because a video and a
screenshot picked together finish at very different times.

Files go over HTTP, not over the WebSocket — that is what makes a progress bar
and a seekable video possible. `src/lib/uploads.ts` posts them and turns a
failure into the same `AuralError` the socket raises, so one table of error
codes covers both halves of the protocol.

Each file is rendered by what it is: images open into a lightbox, video and
audio play in place, text and Markdown open into a collapsible preview that
fetches only the head of the file, and anything else is a card with a download
button. Right-clicking any of them offers download, open and copy link.

Markdown is rendered by `src/lib/markdown.ts`, which parses a subset into a tree
of nodes rather than into HTML. A `.md` file in a channel was written by whoever
uploaded it, and a renderer that cannot produce markup cannot be made to inject
any. It is about 300 lines and takes no dependency.

A file's life is its message's life: deleting the message deletes the file on
the server. The size limits are the server's, advertised before anything is
sent, so a file that is too large is refused in the picker rather than after a
long transfer.

### Voice

Audio is Opus over WebRTC. The WebSocket carries only signalling — offers,
answers and ICE candidates — and the audio itself goes peer to peer or through
the server's relay, depending on which of the two hosting models the server
runs. That choice is the server's and is shown on the connect screen.

The two modes share every line of this client except who the peers are. In
`server_host` there is one connection, to the server, carrying everybody's audio
on its own track. In `client_host` the first person in a channel relays: they
hold one connection per participant, play what arrives and forward it on. Both
end up in the same playback, the same meter and the same mute button.

WebRTC is what makes this worth building on rather than sending Opus frames over
the socket by hand. The browser's stack brings a jitter buffer, packet loss
concealment, forward error correction, echo cancellation, noise suppression and
gain control, all of which would otherwise be this client's to write and get
wrong. `src/lib/voice/` is about 2,200 lines because of what it does not have to
do.

**Recovery is one path.** A host that left, a transport that gave up, a server
whose audio plane an administrator reconfigured and a laptop that came back from
sleep all end in the same place: tear the media down and call `voice.connect`
again. That is the path every ordinary call takes, so it is a path that works,
rather than one only reached when something has already gone wrong.

**The microphone is not the track that is sent.** `src/lib/voice/audio.ts` puts
a small audio graph in between, which buys two things: the gate fades rather
than switches, so opening the microphone does not click, and changing input
device rewires the graph instead of replacing the track, so it needs no
renegotiation and cannot interrupt a call. Where that graph cannot be built the
raw track is used and both become slightly worse, which beats not working.

**Noise suppression is a choice of one, not a stack.** Off, the browser's own,
or RNNoise. They are alternatives because two suppressors in series fight: the
first has already flattened the bands the second reads its noise floor from, and
the result is a metallic voice. So choosing RNNoise turns the browser's off —
and turns off nothing else, because echo cancellation is a separate module and
RNNoise cannot do it, having no reference of what the speakers are playing.

RNNoise is by the author of Opus, which is why it already works in 10 ms frames
at 48 kHz. It is a small recurrent network deciding band gains on top of classic
DSP, not a network end to end, which is how a model this useful stays under
200 KB. It is much better than the browser's suppressor on noise that comes and
goes — a door, keys, a dog — and it does not remove other people's voices,
because a voice is what it was trained to keep. It is not Krisp and the client
does not imply it is.

It is fetched only when somebody selects it, and if it cannot be had — the
model would not load, or the platform would not give the graph 48 kHz — the
browser's suppressor is asked for instead and the settings page says so. Being
quietly given something other than what you picked is the failure worth
avoiding here.

**Playback is one `<audio>` element per person**, not one mixed graph. An
element gives per-person volume, output device selection and the browser's own
buffering for nothing; a graph would give the same result with more that can go
wrong. Volumes are stored per server and per person, because an identity belongs
to one server and turning down user 4 on one must not turn down user 4 on
another.

Push-to-talk listens on this window only. A global hotkey needs the native shell
and is not there yet.

### Emoji

The catalogue in `src/lib/emoji-data.ts` is generated, not written:

```sh
npm run emoji
```

[`scripts/make-emoji.mjs`](scripts/make-emoji.mjs) derives it from the official
Unicode emoji list — 1,894 emoji in nine groups. The alternative was committing
an opaque blob nobody can audit, or taking a dependency several times the size
of this whole client. The generated file *is* committed, so this runs only to
move to a new Unicode release.

Skin tones are not stored. They are applied by inserting the modifier after the
first codepoint, and the generator marks an emoji as tonable only when that rule
reproduces all five of Unicode's own toned sequences for it — which is why the
34 multi-person emoji, where each person takes a tone separately, correctly
offer none.

The catalogue is 19 KB gzipped, so the picker is loaded on demand and the data
never reaches a session that does not open it. That is the reason for the split
between `emoji.ts`, which only decides whether a message is emoji enough to
render large, and `emoji-catalogue.ts`, which the picker uses.

Emoji render in the system font rather than as images: no sprite sheet to ship,
and they match the rest of the operating system.

## Layout

```
src/lib/protocol.ts      the wire format, mirroring the Go package
src/lib/permissions.ts   the bitmask and its resolution rules
src/lib/gateway.ts       the WebSocket client: promised replies, pushed events
src/lib/address.ts       parsing what people type into an endpoint
src/lib/time.ts          message timestamps, day separators and grouping
src/lib/emoji.ts         whether a message is emoji enough to render large
src/lib/emoji-catalogue.ts  searching, recents and skin tones for the picker
src/lib/emoji-data.ts    the catalogue itself, generated from Unicode
src/lib/uploads.ts       sending files, addressing them, and sizing them
src/lib/voice/audio.ts   the microphone, the gate, the meter, and playback
src/lib/voice/denoise.ts  RNNoise, fetched only if somebody turns it on
src/lib/voice/engine.ts  peer connections, both hosting modes, and recovery
src/lib/voice/sdp.ts     the one place this client edits SDP
src/lib/voice/settings.ts  voice preferences, kept on this machine
src/store/voice.ts       one media session and what the interface draws of it
src/lib/markdown.ts      a Markdown subset, parsed to nodes and never to markup
src/lib/storage.ts       saved servers and their session tokens
src/store/connection.ts  one connection and everything known about it
src/store/servers.ts     every connection held, and which one is on screen
src/store/session.ts     the connection in the foreground, as components read it
src/store/selectors.ts   derived views: the channel tree, member groups, access
src/views/               the two screens: connect, and a connected server
src/components/          the panels, the chat, and the dialogs
src/styles/theme.css     design tokens, all of them
src/styles/app.css       layout and components
src-tauri/               the desktop and mobile shell
src-tauri/src/media.rs   the webview's microphone prompt, answered off screen
scripts/                 the two checks, and the icon and emoji generators
```

## The Tauri shell

`src-tauri/` is scaffolded and configured. The **desktop build works and has been
run** on Windows; the Android build is configured but has not been attempted yet.

```sh
npm run tauri info      # audits the toolchain and names what is missing
npm run tauri:dev
```

Both need Rust and a per-platform C toolchain.
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) has the setup, including the two
things that reliably go wrong on Windows: the Git Bash `link.exe` collision, and
needing `npm run icons` before the very first build.

### Icons

```sh
npm run icons
```

[`scripts/make-icon.mjs`](scripts/make-icon.mjs) draws `src-tauri/app-icon.png`
from a handful of constants rather than committing an opaque binary, then hands
it to `tauri icon` to produce the Windows `.ico`, the macOS `.icns`, the Store
logos and the Android and iOS sets. The results are not committed, so this is a
prerequisite of the first build on a fresh clone — on Windows even a debug build
needs `icon.ico`, because it goes into the executable's resource file.

### Microphone access

There are two permissions in the way of a microphone, and confusing them makes
this look harder than it is. The operating system has one, and it is real: it is
the prompt macOS shows through TCC, and the privacy setting Windows keeps. The
browser engine embedded in the window has another, about the page it is showing
— and that page is our own application, in our own window, opened by somebody
who just clicked a voice channel.

`src-tauri/src/media.rs` answers the second one and never shows it. It is why
joining a call in the desktop client is one click rather than two, and it is
what every desktop chat application does. It grants nothing but the microphone,
and only to the client's own page: the client embeds third-party frames, and
none of them get a microphone by sitting inside our window.

Per platform:

- **Windows** — handled, through `ICoreWebView2::add_PermissionRequested`. Without
  it WebView2 drops a grey bar over the top of the window, mid-join.
- **Linux** — handled, through WebKitGTK's `permission-request` signal. WebKitGTK
  does not say which frame asked, only what the view is showing, so the check
  there is on the page rather than on the frame.
- **macOS** — left to WKWebView, which answers with a dialog of its own.
  Silencing that one means installing a `WKUIDelegate` method onto a class wry
  owns and shares, for a prompt that is already a real system dialog rather than
  a bar wedged into the page. What is not optional there is
  `NSMicrophoneUsageDescription`: macOS terminates a process that asks for a
  microphone without one. `src-tauri/Info.plist` carries it.
- **Android** — a separate mechanism, and not handled here. It needs
  `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` in the manifest; `src-tauri/gen/`
  is generated and not committed, so they have to be added there after
  `tauri android init`.

None of this takes anything the operating system is holding back. A refusal at
that level, a device already in use, and a missing device all still fail, and
all of them still reach the voice panel — which says which of the three it was,
what to do about it, and offers a button to try again, because whatever was in
the way was fixed outside this window and nothing inside it can notice on its
own. In a browser the browser's own prompt is left alone; it belongs to the
person reading it.

A page served over plain HTTP from anything but `localhost` gets no microphone
at all, whatever the user says: that is a rule of the platform, and no
permission handler changes it. It is the same reason the shell is where
certificate pinning belongs.

The shell is otherwise deliberately almost empty. It exists to package the web
app, and to be where native capabilities land later: a global push-to-talk
hotkey, a tray icon, and pinning self-signed certificates so a server reached by
address can still be served over TLS. That last one is the reason a native shell is worth
having at all — a browser refuses `wss://` to a self-signed certificate without
the user accepting it by hand, which is an awkward thing to ask of everyone
joining a home server.

Content Security Policy is disabled (`"csp": null`) because the client connects
to WebSocket endpoints the user types in, which no fixed policy can enumerate.

## Releases

Installers for Windows, macOS and Linux are built by
[`.github/workflows/release.yml`](.github/workflows/release.yml). It is manual —
Actions → Release → Run workflow — because a release tags the repository and
puts binaries in front of people, which is a decision rather than a side effect
of a commit. [`docs/RELEASING.md`](docs/RELEASING.md) covers cutting one, what
each job does, and where code signing would go.

## Roadmap

**v0.1** — connecting by address, identity and registration, the channel tree,
roles and permissions, presence, responsive layout.

**v0.2** — text channels: reading, posting, paged history, editing and
deleting, with messages grouped by author and separated by day, and an emoji
picker with search, categories, recents and skin tones.

**v0.3** — file attachments: picking, dropping and pasting files, with per-file
progress; images, video and audio played in place; Markdown and text previewed
inline; and a right-click menu to download any of them.

**v0.4** — search: a query written as one line, with `from:`, `in:`,
`has:`, `before:`, `during:` and `after:` filters suggested as they are typed;
results shown with the message either side of each hit, sorted by date or
relevance and paged; and a jump that opens any result where it was written,
with the way back to the present.

**v0.5 (here)** — voice: Opus over WebRTC in both of the server's hosting
models, with input device and gain, push-to-talk or voice activity with a
threshold set against a live meter, echo cancellation, noise suppression and
gain control, a bitrate chosen within what the server allows, per-person volume,
mute and deafen for yourself and for others, speaking indicators in the channel
tree, and a voice page in server settings for administrators.

**v0.6 (in this tree, unreleased)** — several servers at once: the rail switches between live
connections instead of dropping one to dial the next, the server in front keeps
its messages while the rest keep presence and an unread badge, channel histories
are cut back on a least-recently-read basis, and the one media session moves
between servers only after being asked about.
[`docs/MULTI-SERVER.md`](docs/MULTI-SERVER.md) has the memory budget behind all
of that.

**Later** — screen sharing, a global push-to-talk hotkey in the native shell,
and Aural Hub for finding public servers.

## License

[GNU AGPL-3.0-or-later](LICENSE), the same as the server.

The network clause matters most on the server side, but the two halves are one
product and a split licence would only invite confusion about where the boundary
falls.
