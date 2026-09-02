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

   - **release_type** — `draft` (default), `prerelease`, or `published`.
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
  public with a full set of installers or it does not go public at all.
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

## Not built here

- **Android and iOS.** `src-tauri/gen/` is generated and not committed, so a
  mobile job would have to run `tauri android init` and then patch
  `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` into a manifest it just generated —
  and then sign with a keystore. Worth doing when the Android build has been run
  by hand at least once, which it has not.
- **Linux arm64.** Cross-compiling a WebKitGTK application is enough work to
  deserve its own decision rather than being folded in here.
- **Auto-update.** Tauri's updater needs a signing key and a JSON endpoint. Not
  configured, so people update by downloading the next release.
