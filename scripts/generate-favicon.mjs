/**
 * Render the STOCKX brand mark to `src/app/favicon.ico`.
 *
 *   node scripts/generate-favicon.mjs
 *
 * ── Why a script rather than a checked-in binary nobody can regenerate ─────
 *
 * The mark is defined once, in `src/components/layout/wordmark.tsx`, as three
 * rounded bars at unequal heights. An `.ico` is a rasterised copy of that — so
 * if it is produced by hand in an image editor, the tab icon silently stops
 * matching the logo the moment the logo changes. This script keeps the two in
 * step: the geometry below is the same viewBox and the same three rects, and
 * re-running it is the whole update procedure.
 *
 * It has no dependencies. An ICO is a container of BMP images, and writing one
 * by hand is a few dozen lines — cheaper than adding an image toolchain to a
 * trading app for one 15 KB file.
 *
 * The SVG at `src/app/icon.svg` is the primary icon and is what modern
 * browsers use; this `.ico` is the fallback for the bare `/favicon.ico`
 * request that older browsers make without being asked.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTPUT = path.join(ROOT, "src/app/favicon.ico");

/** The mark's own coordinate space — `viewBox="0 0 20 20"` in the component. */
const VIEWBOX = 20;

/**
 * The three bars, verbatim from `BrandMark`.
 *
 * `alpha` is the component's `opacity` attribute. The ramp is what makes the
 * shape read as a price column rather than as a bar chart, so it is preserved
 * rather than flattened for legibility at 16px.
 */
const BARS = [
  { x: 2, y: 4, width: 3, height: 12, radius: 1.5, alpha: 1 },
  { x: 8, y: 1, width: 3, height: 18, radius: 1.5, alpha: 0.45 },
  { x: 14, y: 7, width: 3, height: 9, radius: 1.5, alpha: 0.7 },
];

/**
 * Ink for the raster icon.
 *
 * The in-app mark is `currentColor`, which resolves to near-black on the light
 * theme and near-white on the dark one. A `.ico` cannot follow the browser's
 * theme — it is one static image sitting on a tab strip that may be either —
 * so it uses the brand's accent instead, midway between the light theme's
 * `--accent` (#8E6330) and the dark theme's (#D4A65E). That reads on a white
 * tab strip and on a black one, where either ink colour would disappear into
 * one of them. `icon.svg` does follow the theme, and is what most browsers
 * will actually show.
 */
const INK = { r: 0xb8, g: 0x86, b: 0x3f };

/** Icon sizes to pack. 16 for the tab, 32 for HiDPI, 48 for Windows shortcuts. */
const SIZES = [16, 32, 48];

/** Samples per axis when rasterising. 4x4 = 16 coverage samples per pixel. */
const SUPERSAMPLE = 4;

/** True when a point falls inside a rounded rectangle. */
function insideRoundedRect(px, py, bar) {
  const { x, y, width, height, radius } = bar;
  if (px < x || px > x + width || py < y || py > y + height) return false;

  // Corner regions are the only places the radius matters; everywhere else the
  // point is already inside the straight edges.
  const cornerX = px < x + radius ? x + radius : px > x + width - radius ? x + width - radius : null;
  const cornerY =
    py < y + radius ? y + radius : py > y + height - radius ? y + height - radius : null;

  if (cornerX === null || cornerY === null) return true;
  return Math.hypot(px - cornerX, py - cornerY) <= radius;
}

/**
 * Rasterise the mark at one size, as straight (non-premultiplied) RGBA.
 *
 * Coverage is supersampled rather than analytic: at these sizes the difference
 * is invisible and the arithmetic is obvious, which matters more in a file
 * nobody will look at again for a year.
 */
function rasterise(size) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = VIEWBOX / size;
  const step = 1 / SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let alpha = 0;

      for (const bar of BARS) {
        let hits = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
            const x = (px + (sx + 0.5) * step) * scale;
            const y = (py + (sy + 0.5) * step) * scale;
            if (insideRoundedRect(x, y, bar)) hits += 1;
          }
        }
        if (hits === 0) continue;

        // The bars do not overlap horizontally, so coverage simply adds.
        alpha += (hits / (SUPERSAMPLE * SUPERSAMPLE)) * bar.alpha;
      }

      const offset = (py * size + px) * 4;
      pixels[offset] = INK.r;
      pixels[offset + 1] = INK.g;
      pixels[offset + 2] = INK.b;
      pixels[offset + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }

  return pixels;
}

/**
 * One 32-bit BMP image, as an ICO expects it.
 *
 * Two quirks of the format, both of which produce a silently broken icon
 * rather than an error: the header's height is *doubled* because it counts a
 * colour mask plus an AND mask, and the rows run bottom-up.
 */
function toBmp(pixels, size) {
  const header = Buffer.alloc(40);
  const rowSize = size * 4;
  const xorSize = rowSize * size;
  // Even with a 32-bit alpha channel, the AND mask must be present. Zeroed:
  // "no pixel is masked", leaving the alpha channel in charge.
  const andSize = Math.ceil(size / 32) * 4 * size;

  header.writeUInt32LE(40, 0); // header size
  header.writeInt32LE(size, 4); // width
  header.writeInt32LE(size * 2, 8); // height: colour + mask
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(0, 16); // BI_RGB, uncompressed
  header.writeUInt32LE(xorSize + andSize, 20);

  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * rowSize; // bottom-up
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = y * rowSize + x * 4;
      // BGRA, not RGBA.
      xor[to] = pixels[from + 2];
      xor[to + 1] = pixels[from + 1];
      xor[to + 2] = pixels[from];
      xor[to + 3] = pixels[from + 3];
    }
  }

  return Buffer.concat([header, xor, Buffer.alloc(andSize)]);
}

const images = SIZES.map((size) => ({ size, data: toBmp(rasterise(size), size) }));

const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(0, 0); // reserved
directory.writeUInt16LE(1, 2); // type: icon
directory.writeUInt16LE(images.length, 4);

let offset = directory.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  // 256 is written as 0 in this field; none of our sizes reach it.
  directory.writeUInt8(image.size === 256 ? 0 : image.size, entry);
  directory.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
  directory.writeUInt8(0, entry + 2); // palette size: none
  directory.writeUInt8(0, entry + 3); // reserved
  directory.writeUInt16LE(1, entry + 4); // planes
  directory.writeUInt16LE(32, entry + 6); // bits per pixel
  directory.writeUInt32LE(image.data.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.data.length;
});

const ico = Buffer.concat([directory, ...images.map((image) => image.data)]);
fs.writeFileSync(OUTPUT, ico);

console.log(`Wrote ${path.relative(ROOT, OUTPUT)} — ${SIZES.join(", ")}px, ${ico.length} bytes`);
