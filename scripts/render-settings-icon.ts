#!/usr/bin/env node
/**
 * One-shot icon generator for the account/settings tab.
 *
 * Writes a 24×24 white silhouette of a gear onto a transparent background
 * to `apps/mobile/assets/images/tabIcons/settings.png`, plus 2× and 3×
 * variants. Pure Node — no `pngjs`, no ImageMagick, no native tools.
 *
 * Why: the existing tab icons are 24×24 white PNGs with `renderingMode:
 * "template"`, so a monochrome silhouette is what the system needs. This
 * file is idempotent and only needs to be re-run when the icon changes.
 */
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(
  __dirname,
  "..",
  "apps",
  "mobile",
  "assets",
  "images",
  "tabIcons",
);

const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

interface Glyph {
  readonly cx: number;
  readonly cy: number;
  readonly innerR: number;
  readonly outerR: number;
  readonly teethCount: number;
  readonly toothFraction: number;
  readonly toothDepth: number;
  readonly antialias: number;
}

const gear = (size: number): readonly [number, number, number, number][] => {
  const glyph: Glyph = {
    cx: (size - 1) / 2,
    cy: (size - 1) / 2,
    innerR: size * 0.21,
    outerR: size * 0.42,
    teethCount: 6,
    toothFraction: 0.45,
    toothDepth: size * 0.08,
    antialias: 1,
  };

  const pixels: [number, number, number, number][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - glyph.cx;
      const dy = y - glyph.cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const sector =
        ((angle + Math.PI * 2) % ((Math.PI * 2) / glyph.teethCount)) /
        ((Math.PI * 2) / glyph.teethCount);
      const radial =
        sector < glyph.toothFraction
          ? glyph.outerR + glyph.toothDepth
          : glyph.outerR;
      const distance = r - radial;
      const innerDistance = glyph.innerR - r;

      let alpha = 0;
      if (distance > glyph.antialias) alpha = 0;
      else if (distance > 0)
        alpha = Math.round((1 - distance / glyph.antialias) * 255);
      else if (innerDistance > glyph.antialias) alpha = 255;
      else if (innerDistance > 0)
        alpha = Math.round((innerDistance / glyph.antialias) * 255);
      else alpha = 0;

      pixels.push(
        alpha > 0
          ? [WHITE[0], WHITE[1], WHITE[2], alpha]
          : [TRANSPARENT[0], TRANSPARENT[1], TRANSPARENT[2], TRANSPARENT[3]],
      );
    }
  }
  return pixels;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
};

const renderPng = (
  size: number,
  pixels: readonly [number, number, number, number][],
): Buffer => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // PNG scanlines: 0x00 filter byte then RGBA bytes per row.
  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[offset++] = p[0];
      raw[offset++] = p[1];
      raw[offset++] = p[2];
      raw[offset++] = p[3];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const writeVariant = (size: number, suffix: "" | "@2x" | "@3x"): void => {
  const filename = `settings${suffix}.png`;
  const buf = renderPng(size, gear(size));
  writeFileSync(join(OUT_DIR, filename), buf);
  console.log(`wrote ${filename} (${size}x${size}, ${buf.length} bytes)`);
};

writeVariant(24, "");
writeVariant(48, "@2x");
writeVariant(72, "@3x");
