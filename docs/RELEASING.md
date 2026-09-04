# Releasing

Installers are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml),
and that workflow only ever runs because somebody pressed a button. There is no
`push:` trigger and there should not be one: a release tags the repository and
puts binaries in front of people, so it is a decision, not a side effect of a
commit.

## What comes out

One run produces installers for three platforms:

| Platform | Runner | Files |
| --- | --- | --- |
| Windows x64 | `windows-latest` | `.exe` (NSIS), `.msi` |
| macOS universal | `macos-14` | `.dmg`, `.app` — one download for Intel and Apple Silicon |
| Linux x64 | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |

Which bundles get built is `bundle.targets: "all"` in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json), not anything in the
workflow. Change it there and the release follows.

Ubuntu **22.04** is pinned rather than `latest` on purpose. The glibc a Tauri
build links against sets the oldest distribution the `.deb` and `.AppImage` will
run on, so building on 24.04 would silently drop everyone still on 22.04.

## Cutting a release

1. **Bump the version in all three files.** They have to agree:

   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`

   The workflow reads the version from the repo rather than from an input, so
   the tag can never name something other than what the installers contain.
   [`.github/scripts/resolve-version.mjs`](../.github/scripts/resolve-version.mjs)
   fails the run if the three disagree, and it can be run locally first:

   ```sh
   node .github/scripts/resolve-version.mjs
   ```

2. **Commit and push.** The tag is placed on the commit the run starts from.

3. **Actions → Release → Run workflow.** Two inputs:

   - **release_type** — `draft` (default), `prerelease`, or `published`. This
     is also what decides who auto-updates: only `published` reaches installed
     clients. See [Auto-update](#auto-update).
   - **dry_run** — build everything, attach the installers to the run, create no
     tag and no release. Use it when the workflow itself is what changed.

4. **Check the draft, then publish.** `draft` is the default because it is the
   one that lets you download the installers and actually launch one before
   anybody else can.

## What it does in order

```
checks ──▶ prepare ──▶ build (windows | macos | linux) ──▶ finalise
                            └── any failure ───────────▶ cleanup
```

- **checks** — `npm run typecheck`, `npm run render-check`, and
  `cargo test` for the shell. `npm run smoke` is not here: it drives a live
  server, so it belongs to a person with one running.
- **prepare** — refuses a tag that already exists, then creates the release as a
  draft so the three build jobs have one place to upload to instead of racing to
  create it.
- **build** — `fail-fast: false`, so a Windows-only failure does not cost the
  macOS and Linux builds.
- **finalise** — only reached when all three platforms built. A release goes
  public with a full set of installers or it does not go public at all. It also
  reads `latest.json` back and refuses to publish one that does not cover every
  platform; see [Auto-update](#auto-update).
- **cleanup** — deletes the draft if a platform failed, so a half-filled release
  is not left lying around for somebody to publish by accident a week later.

## Code signing

The builds are **unsigned today**. Windows SmartScreen and macOS Gatekeeper both
warn on first launch; on macOS the way past it is opening the app once from the
right-click menu. The release notes say so.

The workflow is already wired for signing — it passes the Apple variables
through to `tauri-action`, and when the secrets are unset they are empty and
Tauri simply produces unsigned bundles. Adding these repository secrets starts
signing with no edit to the workflow:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | its password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarisation |

Windows signing is configured in `tauri.conf.json` rather than by environment,
so it needs a `bundle.windows.certificateThumbprint` (or an Azure Trusted
Signing setup) before it will do anything. Both cost money per year, which is
why neither is set up while this is going to friends.

## Auto-update

Installed clients check for a new release at startup and offer to install it.
The manifest they read is `latest.json`, published as an asset on the release
and reached at:

```
https://github.com/Du-vy/Aural-Client/releases/latest/download/latest.json
```

That URL only ever resolves to a release that is **published and marked
latest**, which is what turns `release_type` into the rollout control:

| `release_type` | Who gets it |
| --- | --- |
| `draft` | nobody — the release is not public |
| `prerelease` | anybody who downloads it by hand; **no client auto-updates** |
| `published` | every installed client, at its next start |

So the kill switch for a bad release is un-marking it as latest on GitHub. That
takes effect immediately and needs no new build.

### The signing key

The updater will not install anything that is not signed with the key whose
public half is in `plugins.updater.pubkey` in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json). This is **not**
code signing: it is what proves an update came from this workflow, and it works
whether or not the installers are signed for Windows or macOS.

One repository secret drives it:

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the private key file's contents — one base64 line, from `npm run tauri signer generate` |

**`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is deliberately not a secret**, because
the key was generated without a password and GitHub will not store an empty
secret value. The workflow still passes the variable, and `${{ secrets.X }}` for
a secret that does not exist expands to the empty string — which is what the
signer wants. The distinction that matters is between *set to empty* and *not
set at all*: with the variable absent entirely the signer stops and asks for a
password at the terminal, which in CI is a job that hangs rather than fails.
The same rule the Apple signing step above turns on, seen from the other side.

So: do not create that secret, and do not "fix" its absence by creating it with
a placeholder. If a key with a real password is ever wanted, generate it, put
the new public half in `tauri.conf.json`, and add the secret then — and read the
warning below first, because replacing the key is not a free action once
installers are out.

**Keep a backup of the private key somewhere other than GitHub.** The public
half is compiled into every installer that has already been handed out, and
nothing can change that after the fact. Losing the private key means no build
signed with a replacement will be accepted by anything already installed, and
every existing install has to be replaced by hand. Rotating the key has the
same effect and is a decision to make deliberately, not a recovery step.

### The manifest covers every platform, or the release does not go out

Each build job publishes its own half of `latest.json` and the action merges
them. A merge that loses a platform still produces a valid manifest, and the
platform it lost simply stops seeing updates without saying so. `finalise`
therefore reads the finished manifest back and fails the run unless all four
targets — `windows-x86_64`, `darwin-x86_64`, `darwin-aarch64`, `linux-x86_64` —
are present with a URL and a signature, and unless its version matches the one
being released.

A failure there leaves the release as a draft rather than deleting it: the
installers are fine, it is the manifest that is not, and the draft is there to
fix and publish by hand.

### What cannot update itself

- **`.deb` and `.rpm` installs.** One Linux build produces an AppImage, a `.deb`
  and an `.rpm` from the same binary, and only the AppImage can be replaced by
  the process running it — the other two belong to a package manager. The check
  still runs on those installs and still reports honestly; the install step
  falls back to opening the releases page.
- **Android and iOS.** The updater and process plugins are not compiled for
  mobile at all, which is why they sit in their own capability
  (`src-tauri/capabilities/desktop.json`) rather than in `default`.

## Not built here

- **Android and iOS.** `src-tauri/gen/` is generated and not committed, so a
  mobile job would have to run `tauri android init` and then patch
  `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` into a manifest it just generated —
  and then sign with a keystore. Worth doing when the Android build has been run
  by hand at least once, which it has not.
- **Linux arm64.** Cross-compiling a WebKitGTK application is enough work to
  deserve its own decision rather than being folded in here.
- **Linux arm64 auto-update.** Follows the arm64 build above; there is nothing
  to update to until there is something to install.
