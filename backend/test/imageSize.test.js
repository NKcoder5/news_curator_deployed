// The pixel budget for screenshots (utils/imageSize.js, services/contentCheck.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { imageSize, MAX_PIXELS } = require('../utils/imageSize');
const { runContentCheck } = require('../services/contentCheck');

const u16be = (n) => [n >> 8, n & 255];
const u16le = (n) => [n & 255, n >> 8];
const u24le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return [...b]; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return [...b]; };
const i32le = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return [...b]; };

const pngHeader = (w, h) => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...Buffer.from('IHDR'), ...u32be(w), ...u32be(h), 8, 0, 0, 0, 0]);
const jpegHeader = (w, h, sof = 0xc0) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14),          // APP0, skipped by its length
  0xff, 0xff,                                           // a fill byte before the next marker
  0xff, sof, 0x00, 0x11, 0x08, ...u16be(h), ...u16be(w), 0x03, ...Buffer.alloc(9)
]);
const riff = (kind, body) => Buffer.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(kind), ...body, ...Buffer.alloc(16)]);

test('imageSize reads every accepted format from its header', () => {
  assert.deepEqual(imageSize(pngHeader(1080, 2400)), { width: 1080, height: 2400 });
  assert.deepEqual(imageSize(jpegHeader(1170, 2532)), { width: 1170, height: 2532 });
  assert.deepEqual(imageSize(jpegHeader(800, 600, 0xc2)), { width: 800, height: 600 }, 'progressive JPEG');
  assert.deepEqual(imageSize(Buffer.from([...Buffer.from('GIF89a'), ...u16le(640), ...u16le(480)])), { width: 640, height: 480 });
  assert.deepEqual(imageSize(Buffer.from([0x42, 0x4d, ...Buffer.alloc(12), ...u32le(40), ...i32le(1024), ...i32le(-768), ...Buffer.alloc(8)])), { width: 1024, height: 768 }, 'top-down BMP');
  assert.deepEqual(imageSize(riff('VP8X', [...u32le(10), 0, 0, 0, 0, ...u24le(1919), ...u24le(1079)])), { width: 1920, height: 1080 });
  assert.deepEqual(imageSize(riff('VP8L', [...u32le(10), 0x2f, ...u32le((1599) | (899 << 14))])), { width: 1600, height: 900 });
  assert.deepEqual(imageSize(riff('VP8 ', [...u32le(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(720), ...u16le(1280)])), { width: 720, height: 1280 });
  const tiffLe = Buffer.from([0x49, 0x49, 42, 0, ...u32le(8), ...u16le(2),
    ...u16le(256), ...u16le(3), ...u32le(1), ...u16le(3000), 0, 0,
    ...u16le(257), ...u16le(4), ...u32le(1), ...u32le(4000)]);
  assert.deepEqual(imageSize(tiffLe), { width: 3000, height: 4000 });
  const tiffBe = Buffer.from([0x4d, 0x4d, 0, 42, ...u32be(8), ...u16be(2),
    ...u16be(256), ...u16be(4), ...u32be(1), ...u32be(5000),
    ...u16be(257), ...u16be(3), ...u32be(1), ...u16be(6000), 0, 0]);
  assert.deepEqual(imageSize(tiffBe), { width: 5000, height: 6000 });
});

test('imageSize returns null for anything it cannot read, and never throws', () => {
  assert.equal(imageSize(Buffer.from('not an image')), null);
  assert.equal(imageSize(pngHeader(10, 10).subarray(0, 20)), null, 'PNG cut before its size');
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])), null, 'JPEG with image data before a frame header');
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])), null, 'JPEG segment running past the end');
  assert.equal(imageSize(null), null);
});

test('a screenshot declaring more than the pixel budget is refused before it is decoded', async () => {
  // 165 kB of PNG declaring 12,000 x 12,000 took the server to 519 MB when it was read; the header alone
  // is enough to refuse it now.
  const bomb = pngHeader(12000, 12000).toString('base64');
  await assert.rejects(runContentCheck({ imageBase64: bomb }), (err) => {
    assert.equal(err.status, 413);
    assert.equal(err.payload.code, 'IMAGE_TOO_LARGE');
    assert.match(err.payload.error, /12,000 × 12,000 pixels/);
    return true;
  });
  assert.ok(12000 * 12000 > MAX_PIXELS);
  assert.ok(1080 * 15000 < MAX_PIXELS, 'a long scrolling phone screenshot still fits');
});

test('a screenshot whose header cannot be read is refused as undecodable', async () => {
  const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]).toString('base64');
  await assert.rejects(runContentCheck({ imageBase64: truncated }), (err) => err.status === 400 && err.payload.code === 'INVALID_IMAGE');
});
