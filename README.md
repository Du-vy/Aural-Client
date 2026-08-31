# Aural Client

The client for [Aural](https://github.com/Du-vy?tab=repositories&q=Aural), an open source voice and
chat platform that pairs a Discord-like interface with TeamSpeak-like servers:
people run their own, and you reach them by address.

React and TypeScript on Vite, wrapped by Tauri v2 so the same codebase ships as
a desktop app and an Android app.

> **Status: v0.1.** Connecting, identity, the channel tree, roles, permissions
> and presence all work against a real server. Voice and text messaging are the
> next two milestones.

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
| `npm run tauri:dev` | Runs the desktop shell. Needs Rust. |
| `npm run tauri:build` | Builds desktop installers. Needs Rust. |
| `npm run tauri:android` | Runs the Android app. Needs Rust and the Android SDK/NDK. |

## Testing

Two checks cover the two ways this client can break.

**`npm run render-check`** mounts every screen and dialog in a real DOM against
seeded state, as an administrator, as a plain guest, and with empty state. A
type check proves the props line up; this proves the components actually render.

**`npm run smoke`** is the one that matters most. It drives the real address
parser, the real gateway and the real permission resolver against a running
server, and asserts among other things that **the client resolves the same
permission mask the server sent**. It is what catches the two repositories
drifting apart.

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

## Layout

```
src/lib/protocol.ts      the wire format, mirroring the Go package
src/lib/permissions.ts   the bitmask and its resolution rules
src/lib/gateway.ts       the WebSocket client: promised replies, pushed events
src/lib/address.ts       parsing what people type into an endpoint
src/lib/storage.ts       saved servers and their session tokens
src/store/session.ts     one connection and everything known about it
src/store/selectors.ts   derived views: the channel tree, member groups, access
src/views/               the two screens: connect, and a connected server
src/components/          the panels and dialogs
src/styles/theme.css     design tokens, all of them
src/styles/app.css       layout and components
src-tauri/               the desktop and mobile shell
scripts/                 the two checks and the icon generator
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

The shell is deliberately almost empty. It exists to package the web app, and to
be where native capabilities land later: a global push-to-talk hotkey, a tray
icon, and pinning self-signed certificates so a server reached by address can
still be served over TLS. That last one is the reason a native shell is worth
having at all — a browser refuses `wss://` to a self-signed certificate without
the user accepting it by hand, which is an awkward thing to ask of everyone
joining a home server.

Content Security Policy is disabled (`"csp": null`) because the client connects
to WebSocket endpoints the user types in, which no fixed policy can enumerate.

## Roadmap

**v0.1 (here)** — connecting by address, identity and registration, the channel
tree, roles and permissions, presence, responsive layout.

**v0.2** — voice. The server already advertises which of the two hosting models
it runs, and the client shows it on the connect screen:

- `client_host` — the first user to enter a voice channel relays its audio for
  everyone in it, handing off when they leave.
- `server_host` — the server relays all audio.

**Later** — text channels and history, screen sharing, multiple simultaneous
server connections, and Aural Hub for finding public servers.

## License

[GNU AGPL-3.0-or-later](LICENSE), the same as the server.

The network clause matters most on the server side, but the two halves are one
product and a split licence would only invite confusion about where the boundary
falls.
