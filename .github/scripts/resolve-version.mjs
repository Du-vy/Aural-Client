/**
 * Resolves the version a release is built from, and refuses to continue if the
 * three files that carry it disagree.
 *
 * They are separate files, and nothing keeps them in step on its own: shipping
 * an installer whose window says 0.5.0 while the tag says 0.6.0 is the kind of
 * mistake that is invisible until somebody reports a bug against the wrong
 * version. So this is a gate, not a convenience.
 *
 * Writes `version` and `tag` in GITHUB_OUTPUT form to stdout.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

const sources = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri", "tauri.conf.json")).version,
  // Only the first `version = ` in the manifest is the package's own; anything
  // after a `[dependencies]` header belongs to a dependency.
  "src-tauri/Cargo.toml": read("src-tauri", "Cargo.toml")
    .split(/^\[/m)[1]
    ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
};

const missing = Object.entries(sources).filter(([, v]) => !v);
if (missing.length) {
  console.error(`No version found in: ${missing.map(([f]) => f).join(", ")}`);
  process.exit(1);
}

const distinct = [...new Set(Object.values(sources))];
if (distinct.length > 1) {
  console.error("The version is not the same in every file:");
  for (const [file, version] of Object.entries(sources)) {
    console.error(`  ${version.padEnd(12)} ${file}`);
  }
  console.error("\nBump all three, commit, then run the release again.");
  process.exit(1);
}

const version = distinct[0];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`"${version}" is not a version this can tag. Want MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

console.log(`version=${version}`);
console.log(`tag=v${version}`);
