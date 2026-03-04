/**
 * generate-icons.js
 *
 * Generates PNG icon files for the VORTEX game without any external dependencies.
 * Creates valid PNG files programmatically using raw buffers and the zlib deflate
 * built into Node.js.
 *
 * Output:
 *   public/icons/icon-192.png  (192x192)
 *   public/icons/icon-512.png  (512x512)
 *
 * Design:
 *   - Dark navy/purple background (#0a0a2e)
 *   - Bright cyan-to-magenta radial orb in the center
 *   - Subtle outer glow
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Colour helpers ──────────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Mix two [r,g,b] colours by factor t (0 = colour a, 1 = colour b). */
function mixColour(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

/** Clamp a value between 0 and 255. */
function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ── Pixel generation ────────────────────────────────────────────────────────

/**
 * Generate raw RGBA pixel data for a VORTEX icon of the given size.
 *
 * The design has three layers painted back-to-front:
 *   1. Solid dark background (#0a0a2e)
 *   2. Soft outer glow (purple / indigo, ~60% radius)
 *   3. Central orb with a cyan-to-magenta gradient (~30% radius)
 */
function generatePixels(size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2;

  // Colour palette
  const bg        = [10, 10, 46];      // #0a0a2e
  const glowInner = [90, 40, 180];     // purple glow
  const glowOuter = [20, 15, 60];      // fade-out glow
  const orbCyan   = [0, 240, 255];     // bright cyan
  const orbMagenta= [200, 50, 255];    // magenta
  const orbCore   = [255, 255, 255];   // white-hot centre

  const orbRadius  = maxR * 0.30;
  const glowRadius = maxR * 0.65;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r, g, b, a;
      a = 255;

      // --- Layer 1: background ---
      [r, g, b] = bg;

      // --- Layer 2: outer glow ---
      if (dist < glowRadius) {
        const t = dist / glowRadius;                  // 0 at centre, 1 at edge
        const glowAlpha = Math.pow(1 - t, 2.0) * 0.6; // quadratic fall-off
        const glowCol = mixColour(glowInner, glowOuter, t);
        // Alpha-blend glow over background
        r = clamp(r * (1 - glowAlpha) + glowCol[0] * glowAlpha);
        g = clamp(g * (1 - glowAlpha) + glowCol[1] * glowAlpha);
        b = clamp(b * (1 - glowAlpha) + glowCol[2] * glowAlpha);
      }

      // --- Layer 3: central orb ---
      if (dist < orbRadius) {
        const t = dist / orbRadius;                    // 0 at dead-centre, 1 at edge

        // Gradient from white core -> cyan -> magenta at the edge
        let orbCol;
        if (t < 0.3) {
          // core: white -> cyan
          orbCol = mixColour(orbCore, orbCyan, t / 0.3);
        } else {
          // outer orb: cyan -> magenta
          orbCol = mixColour(orbCyan, orbMagenta, (t - 0.3) / 0.7);
        }

        // Soft edge (anti-alias the orb boundary)
        const edgeSoftness = 0.05;
        let orbAlpha = 1;
        if (t > 1 - edgeSoftness) {
          orbAlpha = (1 - t) / edgeSoftness;
        }

        r = clamp(r * (1 - orbAlpha) + orbCol[0] * orbAlpha);
        g = clamp(g * (1 - orbAlpha) + orbCol[1] * orbAlpha);
        b = clamp(b * (1 - orbAlpha) + orbCol[2] * orbAlpha);
      }

      // Tiny specular highlight (upper-left of the orb)
      const hlDx = x - (cx - orbRadius * 0.30);
      const hlDy = y - (cy - orbRadius * 0.35);
      const hlDist = Math.sqrt(hlDx * hlDx + hlDy * hlDy);
      const hlRadius = orbRadius * 0.22;
      if (hlDist < hlRadius && dist < orbRadius * 0.85) {
        const hlT = 1 - (hlDist / hlRadius);
        const hlAlpha = Math.pow(hlT, 3) * 0.7;
        r = clamp(r + 255 * hlAlpha);
        g = clamp(g + 255 * hlAlpha);
        b = clamp(b + 255 * hlAlpha);
      }

      const offset = (y * size + x) * 4;
      buf[offset]     = r;
      buf[offset + 1] = g;
      buf[offset + 2] = b;
      buf[offset + 3] = a;
    }
  }

  return buf;
}

// ── PNG encoder (minimal, dependency-free) ──────────────────────────────────

/**
 * Encode raw RGBA pixels into a valid PNG buffer.
 *
 * This is a minimal encoder that writes:
 *   - PNG signature
 *   - IHDR chunk  (image header)
 *   - IDAT chunk  (deflate-compressed image data)
 *   - IEND chunk  (image end)
 *
 * The image data uses filter type 0 (None) on every row for simplicity.
 */
function encodePNG(pixels, width, height) {
  // ---- Prepare filtered scanlines ----
  // Each row: 1 filter byte (0x00 = None) + width * 4 bytes (RGBA)
  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLen);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLen;
    raw[rowOffset] = 0; // filter: None
    pixels.copy(raw, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  // ---- Deflate ----
  const compressed = zlib.deflateSync(raw, { level: 9 });

  // ---- Assemble PNG ----
  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // colour type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  chunks.push(pngChunk('IHDR', ihdr));

  // IDAT
  chunks.push(pngChunk('IDAT', compressed));

  // IEND
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

/** Build a single PNG chunk: length(4) + type(4) + data + crc(4). */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  // CRC-32 over type + data
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

// ── CRC-32 (used by the PNG spec) ──────────────────────────────────────────

let crcTable = null;

function buildCrcTable() {
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
}

function crc32(buf) {
  if (!crcTable) buildCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const outDir = path.resolve(__dirname, '..', 'public', 'icons');

  // Ensure the output directory exists
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [192, 512];

  for (const size of sizes) {
    console.log(`Generating ${size}x${size} icon...`);
    const pixels = generatePixels(size);
    const png = encodePNG(pixels, size, size);
    const outPath = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`  -> ${outPath} (${png.length} bytes)`);
  }

  // Also generate placeholder screenshots (solid dark background with text-like pattern)
  generateScreenshot(outDir, 'screenshot-wide.png', 1280, 720);
  generateScreenshot(outDir, 'screenshot-narrow.png', 720, 1280);

  console.log('\nDone! All icons and screenshots generated.');
}

/**
 * Generate a simple placeholder screenshot with the VORTEX background colour
 * and a centered orb, similar to the icon but wider.
 */
function generateScreenshot(outDir, filename, width, height) {
  console.log(`Generating ${width}x${height} screenshot (${filename})...`);

  const buf = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const maxDim = Math.min(width, height);

  const bg        = [10, 10, 46];
  const glowInner = [90, 40, 180];
  const glowOuter = [20, 15, 60];
  const orbCyan   = [0, 240, 255];
  const orbMagenta= [200, 50, 255];
  const orbCore   = [255, 255, 255];

  const orbRadius  = maxDim * 0.15;
  const glowRadius = maxDim * 0.40;

  // Add a few small "star" positions for visual interest
  const stars = [];
  const rng = mulberry32(42); // deterministic seed
  for (let i = 0; i < 120; i++) {
    stars.push({
      x: rng() * width,
      y: rng() * height,
      brightness: 80 + rng() * 175,
      size: 0.5 + rng() * 1.5,
    });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r, g, b;
      [r, g, b] = bg;

      // Stars
      for (const star of stars) {
        const sdx = x - star.x;
        const sdy = y - star.y;
        const sDist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sDist < star.size) {
          const sAlpha = (1 - sDist / star.size) * 0.8;
          r = clamp(r + star.brightness * sAlpha);
          g = clamp(g + star.brightness * sAlpha);
          b = clamp(b + star.brightness * sAlpha);
        }
      }

      // Glow
      if (dist < glowRadius) {
        const t = dist / glowRadius;
        const glowAlpha = Math.pow(1 - t, 2.0) * 0.5;
        const glowCol = mixColour(glowInner, glowOuter, t);
        r = clamp(r * (1 - glowAlpha) + glowCol[0] * glowAlpha);
        g = clamp(g * (1 - glowAlpha) + glowCol[1] * glowAlpha);
        b = clamp(b * (1 - glowAlpha) + glowCol[2] * glowAlpha);
      }

      // Orb
      if (dist < orbRadius) {
        const t = dist / orbRadius;
        let orbCol;
        if (t < 0.3) {
          orbCol = mixColour(orbCore, orbCyan, t / 0.3);
        } else {
          orbCol = mixColour(orbCyan, orbMagenta, (t - 0.3) / 0.7);
        }
        const edgeSoftness = 0.05;
        let orbAlpha = 1;
        if (t > 1 - edgeSoftness) {
          orbAlpha = (1 - t) / edgeSoftness;
        }
        r = clamp(r * (1 - orbAlpha) + orbCol[0] * orbAlpha);
        g = clamp(g * (1 - orbAlpha) + orbCol[1] * orbAlpha);
        b = clamp(b * (1 - orbAlpha) + orbCol[2] * orbAlpha);
      }

      const offset = (y * width + x) * 4;
      buf[offset]     = r;
      buf[offset + 1] = g;
      buf[offset + 2] = b;
      buf[offset + 3] = 255;
    }
  }

  const png = encodePNG(buf, width, height);
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, png);
  console.log(`  -> ${outPath} (${png.length} bytes)`);
}

/** Simple deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main();
