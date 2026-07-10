// Dependency-free PNG generator for the Flowlog icon set.
// Draws the rising-waveform mark (5 rounded bars) with 2x2 supersampled
// anti-aliasing, then encodes RGBA PNGs using only node's zlib.
const zlib = require('zlib');
const fs = require('fs');

const BARS = [
  { x: 214, y: 402, w: 84, h: 220, c: [0x5b, 0x8d, 0xef] },
  { x: 342, y: 322, w: 84, h: 380, c: [0x5b, 0x8d, 0xef] },
  { x: 470, y: 362, w: 84, h: 300, c: [0x5b, 0x8d, 0xef] },
  { x: 598, y: 252, w: 84, h: 520, c: [0x5b, 0x8d, 0xef] },
  { x: 726, y: 172, w: 84, h: 680, c: [0x8f, 0xb5, 0xff] },
];
const DARK = [0x0b, 0x0b, 0x0f];

// Signed distance to a rounded rect centered at (cx,cy) with half-extents
// (hx,hy) and corner radius r. Negative inside.
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size, scale, bg) {
  const out = Buffer.alloc(size * size * 4);
  const toArt = (v) => ((v * 1024) / size - 512) / scale + 512;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      let color = null;
      // 2x2 supersample
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const ax = toArt(x + ox);
        const ay = toArt(y + oy);
        for (const b of BARS) {
          const r = b.w / 2;
          const d = sdRoundRect(
            ax,
            ay,
            b.x + b.w / 2,
            b.y + b.h / 2,
            b.w / 2,
            b.h / 2,
            r,
          );
          // Anti-alias band scaled to art-space pixel footprint.
          const aa = 1024 / size / scale;
          const a = Math.min(1, Math.max(0, 0.5 - d / aa));
          if (a > 0) {
            cov += a / 4;
            color = b.c;
            break; // bars don't overlap
          }
        }
      }
      cov = Math.min(1, cov);
      const i = (y * size + x) * 4;
      if (bg) {
        const c = color ?? bg;
        out[i] = Math.round(
          (color ? color[0] : bg[0]) * cov + bg[0] * (1 - cov),
        );
        out[i + 1] = Math.round(
          (color ? color[1] : bg[1]) * cov + bg[1] * (1 - cov),
        );
        out[i + 2] = Math.round(
          (color ? color[2] : bg[2]) * cov + bg[2] * (1 - cov),
        );
        out[i + 3] = 255;
        void c;
      } else {
        out[i] = color ? color[0] : 0;
        out[i + 1] = color ? color[1] : 0;
        out[i + 2] = color ? color[2] : 0;
        out[i + 3] = Math.round(cov * 255);
      }
    }
  }
  return out;
}

// ── Minimal PNG encoder (RGBA8, filter 0) ────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const jobs = [
  ['icon.png', 1024, 1.0, DARK],
  ['adaptive-icon.png', 1024, 0.62, null],
  ['splash-icon.png', 1024, 0.35, null],
  ['favicon.png', 48, 1.0, DARK],
];
for (const [name, size, scale, bg] of jobs) {
  const rgba = render(size, scale, bg);
  fs.writeFileSync(
    require('path').join(__dirname, '..', 'assets', name),
    encodePng(rgba, size),
  );
  console.log(
    'wrote',
    name,
    size,
    'scale',
    scale,
    bg ? 'opaque' : 'transparent',
  );
}
