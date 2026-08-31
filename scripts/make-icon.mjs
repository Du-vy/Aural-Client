/**
 * Draws the Aural app icon and writes the PNG sizes Tauri needs.
 *
 * The icon is generated rather than committed as an opaque binary so it can be
 * re-derived, and so changing the mark is a one-line edit here. Run it with:
 *
 *   node scripts/make-icon.mjs
 *
 * A release build additionally needs the .ico and .icns bundles, which come
 * from `npm run tauri icon src-tauri/app-icon.png` once Rust is installed.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Aural teal, and the white the level bars are drawn in. */
const BACKGROUND = [0x0f, 0x15, 0x1a, 0xff];
const MARK = [0x12, 0xb8, 0xa0, 0xff];

/** The four level bars of the wordmark, as fractions of the canvas. */
const BARS = [
  { x: 0.17, halfHeight: 0.1 },
  { x: 0.39, halfHeight: 0.25 },
  { x: 0.61, halfHeight: 0.36 },
  { x: 0.83, halfHeight: 0.17 },
];

const BAR_HALF_WIDTH = 0.052;
const CORNER_RADIUS = 0.22;

/** Renders the icon at one size as raw RGBA pixels. */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = CORNER_RADIUS * size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inside = insideRoundedSquare(x + 0.5, y + 0.5, size, radius);
      if (!inside) {
        pixels.writeUInt32BE(0, offset); // transparent outside the squircle
        continue;
      }

      const color = onBar(x + 0.5, y + 0.5, size) ? MARK : BACKGROUND;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
  return pixels;
}

function insideRoundedSquare(x, y, size, radius) {
  const nearestX = Math.min(Math.max(x, radius), size - radius);
  const nearestY = Math.min(Math.max(y, radius), size - radius);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function onBar(x, y, size) {
  const halfWidth = BAR_HALF_WIDTH * size;
  const centreY = size / 2;
  for (const bar of BARS) {
    const centreX = bar.x * size;
    if (Math.abs(x - centreX) > halfWidth) continue;
    if (Math.abs(y - centreY) > bar.halfHeight * size) continue;
    return true;
  }
  return false;
}

/** Wraps raw RGBA pixels in a minimal PNG container. */
function encodePng(size, pixels) {
  // Each scanline is prefixed with a filter byte; 0 means no filtering.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const targets = [
  ["src-tauri/app-icon.png", 512],
  ["src-tauri/icons/32x32.png", 32],
  ["src-tauri/icons/128x128.png", 128],
  ["src-tauri/icons/128x128@2x.png", 256],
  ["src-tauri/icons/icon.png", 512],
  ["public/icon.png", 256],
];

for (const [relative, size] of targets) {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, draw(size)));
  console.log(`wrote ${relative} (${size}x${size})`);
}
