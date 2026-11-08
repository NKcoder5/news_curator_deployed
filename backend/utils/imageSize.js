// backend/utils/imageSize.js
//
// How many pixels an image declares, read from its header without decoding it.
//
// The screenshot check refused files over 8 MB, but bytes are not what reading an image costs: the OCR
// engine decodes the whole picture into memory at four bytes a pixel before it reads a word. A plain
// PNG compresses so well that a 165 kB file declaring 12,000 × 12,000 pixels took the server to 519 MB,
// past the 512 MB a Render free instance has, and a 429 kB one to 1.25 GB (measured 8 Nov 2026 against
// utils/ocr.js). One such upload from any account stopped the server for every reader. The header says
// how large the picture is before anything is decoded, so services/contentCheck.js asks here first.
//
// Covers the formats contentCheck accepts: PNG, JPEG, GIF, BMP, WebP and TIFF. Returns null when the
// header cannot be read, which the caller treats as an image it cannot decode.

const png = (b) => (b.length >= 24 && b.toString('ascii', 12, 16) === 'IHDR'
  ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  : null);

const gif = (b) => (b.length >= 10 ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null);

const bmp = (b) => {
  if (b.length < 26) return null;
  const headerSize = b.readUInt32LE(14);
  if (headerSize === 12) return { width: b.readUInt16LE(18), height: b.readUInt16LE(20) };
  // A negative height is a top-down bitmap; the size is the same.
  return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
};

const webp = (b) => {
  if (b.length < 30) return null;
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  return null;
};

// Start-of-frame markers carry the size: baseline, progressive, lossless and arithmetic-coded variants.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const jpeg = (b) => {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }                               // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;                      // image data before any frame
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) return i + 9 <= b.length ? { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) } : null;
    i += 2 + length;
  }
  return null;
};

const tiff = (b) => {
  if (b.length < 8) return null;
  const le = b[0] === 0x49;
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > b.length) return null;
  const count = u16(ifd);
  let width = null, height = null;
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e);
    const value = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);              // SHORT or LONG
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  return width && height ? { width, height } : null;
};

/**
 * @param {Buffer} buffer - the image file
 * @returns {{width: number, height: number}|null}
 */
const imageSize = (buffer) => {
  const b = buffer;
  try {
    if (!Buffer.isBuffer(b) || b.length < 4) return null;
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return png(b);
    if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    if (b.toString('ascii', 0, 3) === 'GIF') return gif(b);
    if (b[0] === 0x42 && b[1] === 0x4d) return bmp(b);
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return webp(b);
    if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return tiff(b);
    return null;
  } catch (_) {
    return null;   // a header cut short reads past the end of the buffer
  }
};

// About 80 MB once decoded. A phone screenshot is 2.5 to 3.5 megapixels and a long scrolling one
// (1,080 × 15,000) about 16; measured, 6,000 × 6,000 (36 MP) added 146 MB to the process.
const MAX_PIXELS = 20 * 1000 * 1000;

module.exports = { imageSize, MAX_PIXELS };
