# Development setup

Everything you need installed to work on the Aural client, why each piece is
needed, and how to tell whether it is working. Written to be followed from a
clean machine without remembering anything.

The client is a React web app that Tauri wraps into a desktop and an Android
app. That means there are three tiers of setup, and **you only need the tier you
are actually working in**:

| Tier | What you can do | What it costs |
| --- | --- | --- |
| 1. Web | The whole UI, the protocol, permissions, all tests | Node only |
| 2. Desktop | Everything above, plus the native window | Node + Rust + a C toolchain |
| 3. Android | Everything above, plus the phone build | Node + Rust + JDK + Android SDK/NDK |

Most work happens in tier 1. Do not install tier 3 until you need it.

---

## Tier 1 — Web (required)

### Node.js 20.19+ / 22.12+ / 24+

Vite 7 requires one of those. Anything older fails at startup with a message
about the Node version.

Download: <https://nodejs.org> (LTS build).

```sh
node --version      # v24.20.0 known good
npm --version       # 11.19.0 known good
```

### Install the dependencies

```sh
cd Aural-Client
npm install
```

### Verify tier 1 works

```sh
npm run dev
```

Open <http://localhost:5173>. You should get the connect screen. That is the
whole tier 1 setup — if this works, you can do UI, protocol and permission work
without installing anything else.

---

## Tier 2 — Desktop (Tauri)

Needed only for `npm run tauri:dev` and `npm run tauri:build`.

### Rust

Install via rustup: <https://rustup.rs>

```sh
rustc --version     # 1.98.0 known good
cargo --version
```

Tauri needs the **MSVC** toolchain on Windows, which is rustup's default there:

```sh
rustup show active-toolchain    # want: stable-x86_64-pc-windows-msvc
```

### A C toolchain, per platform

Rust links against system libraries, so each OS needs its native build tools.

**Windows** — Visual Studio Build Tools with the **"Desktop development with
C++"** workload. That workload is what brings MSVC and the Windows SDK; the
installer's other workloads do not.

Download: <https://visualstudio.microsoft.com/visual-studio-build-tools/>

Known good here: Build Tools 2022, 17.14.39. Check what you have:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
    -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property displayName
```

Silence means the C++ workload is missing even if Visual Studio is installed.

**Linux** — `webkit2gtk` and `libappindicator` development packages. On Debian
or Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS** — `xcode-select --install`.

### Generate the icons before the first build

```sh
npm run icons
```

A Windows build **fails without `src-tauri/icons/icon.ico`** even in debug,
because the icon goes into the executable's resource file. The error is a blunt
`icons/icon.ico not found; required for generating a Windows Resource file`
after every crate has already compiled, which is a long way to walk for a
missing file. Run this once after cloning.

The generated icons are not committed, so this is a per-clone step.

### Verify tier 2 works

```sh
npm run tauri info      # audits the whole toolchain and names what is missing
npm run tauri:dev
```

The first `cargo` build compiles 400+ crates and takes several minutes. Later
builds are incremental and fast.

### Windows: build from PowerShell, not Git Bash

> Git for Windows ships a GNU coreutils `link.exe` in `/usr/bin`, which shadows
> the MSVC linker of the same name on `PATH`. The symptom is a baffling
> `link: extra operand '….rcgu.o'` at the end of an otherwise clean build.

Confirm you are hitting it:

```sh
link --version      # "link (GNU coreutils)" means the wrong link is first
```

Fix: run `cargo` and `npm run tauri:*` from **PowerShell** or a Developer
Command Prompt. Everything else in this repository is fine from Git Bash.

---

## Tier 3 — Android

Not yet built or verified for this project. The Tauri project is configured for
it, but no Android build has been run, so treat this section as the documented
starting point rather than a proven path.

Needed:

1. **JDK 17+** — Temurin is the usual choice: <https://adoptium.net>
2. **Android Studio**, which is the sanest way to get the SDK:
   <https://developer.android.com/studio>
   Through its SDK Manager, install the **SDK Platform**, **Platform-Tools**,
   and the **NDK (Side by side)**.
3. **Environment variables** — Tauri reads these to find the SDK:

   ```powershell
   $env:JAVA_HOME    = "C:\Program Files\Eclipse Adoptium\jdk-17"
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:NDK_HOME     = "$env:ANDROID_HOME\ndk\<version>"
   ```

   Set them permanently in System Properties → Environment Variables, otherwise
   they vanish with the shell.

4. **The Rust Android targets:**

   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi \
       i686-linux-android x86_64-linux-android
   ```

5. **Initialise the Android project** (once per clone; `src-tauri/gen/` is
   ignored by git):

   ```sh
   npm run tauri android init
   npm run tauri:android
   ```

Check where you stand:

```sh
npm run tauri info
```

---

## Working against a server

The client is not much use without one. See
[`docs/DEVELOPMENT.md`](https://github.com/Du-vy/Aural-Server/blob/main/docs/DEVELOPMENT.md)
in the server repository — the short version is that it needs **Go 1.26+** and
nothing else, then:

```sh
cd Aural-Server
go run ./cmd/aural-server
```

It creates `config.json` and `aural.db` on first run and prints a one-time owner
token. Connect the client to `127.0.0.1:9871`.

Keep that token: it is what makes you an administrator, it is shown once, and it
is stored only as a hash. If you lose it, `-new-owner-token` issues another.

---

## The checks

Run these before pushing. Neither needs Rust.

```sh
npm run typecheck       # tsc, no emit
npm run render-check    # mounts every screen and dialog in a real DOM
npm run smoke           # drives the real modules against a live server
```

`npm run smoke` needs a server actually running, and takes its address and
optionally the owner token:

```sh
npm run smoke -- --address 127.0.0.1:9871 --owner-token PASTE-TOKEN-HERE
```

Without the token it still runs, but skips the administration checks.

This is the check that matters most: it asserts that **the client resolves the
same permission mask the server sent**, which is what catches the two
repositories drifting apart. If you change `src/lib/protocol.ts` or
`src/lib/permissions.ts`, run it.

---

## Editor

VS Code with:

- **ESLint** and **Prettier** — not enforced by CI yet, but the codebase is
  Prettier-formatted with its defaults.
- **rust-analyzer** — only if you touch `src-tauri/`. Point it at
  `src-tauri/Cargo.toml`, or it will not find the crate.
- **Tauri** (`tauri-apps.tauri-vscode`) — optional.

`.vscode/` is gitignored, so these are personal settings.

---

## Troubleshooting

**`EBUSY: resource busy or locked, watch '…aural_client_lib.dll'`**
Vite's file watcher tripping over cargo's build artefacts. Already fixed in
[`vite.config.ts`](../vite.config.ts) by excluding `src-tauri/**` from the
watcher — if you see it again, that exclusion has been lost.

**`link: extra operand '….rcgu.o'`**
The Git Bash `link.exe` problem. Build from PowerShell. See tier 2 above.

**`icons/icon.ico not found`**
Run `npm run icons`.

**`npm run dev` says the port is taken**
`strictPort` is deliberate: the Tauri config expects port 5173 exactly, so
failing is better than silently moving and leaving the desktop shell pointing at
nothing. Free the port rather than changing it.

**Connecting from a phone on the same network**
The dev server binds every interface, so `http://YOUR-LAN-IP:5173` works from a
phone for checking the responsive layout without an Android build. You may need
to allow Node through the Windows firewall the first time.

**A very slow first `cargo` build**
Expected. 400+ crates. It is cached afterwards.

---

## Versions known to work

Recorded from a working machine on 2026-08-31. Not minimums — just what has
actually been verified here.

| | |
| --- | --- |
| Node | 24.20.0 |
| npm | 11.19.0 |
| Rust | 1.98.0 (`stable-x86_64-pc-windows-msvc`) |
| Go (server) | 1.26.6 |
| Git | 2.55.0 |
| VS Build Tools | 2022, 17.14.39 |
| OS | Windows 10 IoT Enterprise LTSC 2021 |
