// backend/utils/ocr.js
//
// Reading the text out of a screenshot.
//
// This is the only route into Instagram, WhatsApp and most of Facebook. Those
// platforms serve nothing useful to an unauthenticated reader, but the thing
// people actually forward is a screenshot, and a screenshot is readable. The
// claim in a viral post is usually typed over the image rather than in the
// caption, so OCR is not a convenience here — it is where the claim lives.
//
// tesseract.js is loaded lazily and the whole feature is optional: if the
// package is not installed the rest of the system runs exactly as before and
// this path returns a clear message. No analysis silently degrades because an
// optional dependency is missing.
let worker = null;
let loadFailed = false;

const LANGUAGE_PACKS = {
  eng: 'English', tam: 'Tamil', hin: 'Hindi', tel: 'Telugu', kan: 'Kannada',
  mal: 'Malayalam', ben: 'Bengali', guj: 'Gujarati', pan: 'Punjabi',
  mar: 'Marathi', urd: 'Urdu', ara: 'Arabic'
};

/** Is screenshot reading available in this deployment? */
// A screenshot of a chat carries the app's own text around the message: a
// "Forwarded many times" label and a timestamp such as "10 Oct 2026, 7:03 am".
// Read as part of the message, the timestamp's date and time counted as the
// specific detail a checkable claim needs, so "Wake up, share this before it
// is deleted" got a verdict instead of being refused. Lines that are nothing
// but such labels or a time are dropped.
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const TIME = '\\d{1,2}[:.]\\d{2}\\s*(?:am|pm)?';
const CHROME_LINES = [
  /^forwarded(?: many times)?$/i,
  new RegExp(`^(?:today|yesterday)?,?\\s*${TIME}(?:\\s*[✓✔vV/]{1,2})?$`, 'i'),
  new RegExp(`^\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?,?\\s*(?:${TIME})?$`, 'i'),
  new RegExp(`^${MONTH}\\s+\\d{1,2}(?:,?\\s+\\d{4})?,?\\s*(?:${TIME})?$`, 'i'),
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4},?\s*(?:\d{1,2}[:.]\d{2}\s*(?:am|pm)?)?$/i
];

const stripMessageChrome = (text) => text
  .split('\n')
  .filter(line => !CHROME_LINES.some(re => re.test(line.trim())))
  .join('\n')
  .trim();

const isAvailable = () => {
  if (loadFailed) return false;
  try {
    require.resolve('tesseract.js');
    return true;
  } catch (_) {
    return false;
  }
};

/**
 * Read text from an image.
 *
 * @param {Buffer} buffer - the image bytes
 * @param {string[]} [languages] - tesseract language packs to load, e.g. ['eng','tam'].
 *        Loading several costs a one-off download each; English plus the
 *        expected script is the sensible default for a screenshot.
 * @returns {Promise<{text: string, confidence: number, languages: string[]}>}
 */
const readImageText = async (buffer, languages = ['eng']) => {
  if (!isAvailable()) {
    const error = new Error(
      'Screenshot reading is not installed on this server. Run "npm install tesseract.js" in the backend, or paste the text of the post instead.'
    );
    error.code = 'OCR_UNAVAILABLE';
    throw error;
  }

  const packs = languages.filter(code => LANGUAGE_PACKS[code]);
  const langString = (packs.length ? packs : ['eng']).join('+');

  // One image at a time. The worker is shared and replaced when the languages change, so a second
  // screenshot in another language could terminate the worker the first was still reading with.
  const run = queue.then(() => recognise(buffer, langString, packs));
  queue = run.catch(() => {});
  return run;
};

let queue = Promise.resolve();

const recognise = async (buffer, langString, packs) => {
  let instance;
  try {
    const { createWorker } = require('tesseract.js');
    // One worker per language combination, reused across requests: creating a
    // worker re-downloads and re-initialises the model, which dominates the
    // cost of a small image.
    if (!worker || worker.langString !== langString) {
      if (worker?.instance) await worker.instance.terminate().catch(() => {});
      worker = null;
      worker = { instance: await createWorker(langString), langString };
    }
    instance = worker.instance;
  } catch (err) {
    // The engine itself could not start (missing package, no language data): screenshot reading is
    // unavailable on this server, and later requests are told so at once.
    loadFailed = true;
    const error = new Error('Screenshot reading could not start on this server. Paste the text of the post instead.');
    error.code = 'OCR_UNAVAILABLE';
    error.cause = err;
    throw error;
  }

  try {
    const { data } = await instance.recognize(buffer);
    const text = stripMessageChrome(String(data.text || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());

    return {
      text,
      // Tesseract reports 0-100; a low value on a screenshot usually means the
      // image is a photo of a screen rather than a screenshot of one.
      confidence: Math.round(Number(data.confidence) || 0),
      languages: packs.length ? packs : ['eng']
    };
  } catch (err) {
    // One image that could not be read is about that image. It used to mark the whole engine as failed,
    // and every later screenshot was refused as "not installed" until the server restarted. The worker
    // is replaced, in case the failure left it unusable.
    await instance.terminate().catch(() => {});
    if (worker?.instance === instance) worker = null;
    const error = new Error('We could not read text from that image. Try a clearer screenshot, or paste the text instead.');
    error.code = 'OCR_FAILED';
    error.cause = err;
    throw error;
  }
};

/** Tesseract pack for a detected language code, so a Tamil screenshot is read in Tamil. */
const packForLanguage = (code) => ({
  ta: 'tam', hi: 'hin', te: 'tel', kn: 'kan', ml: 'mal', bn: 'ben',
  gu: 'guj', pa: 'pan', mr: 'mar', ur: 'urd', ar: 'ara', en: 'eng'
}[String(code || '').toLowerCase()] || null);

const shutdown = async () => {
  if (worker?.instance) await worker.instance.terminate().catch(() => {});
  worker = null;
};

module.exports = { readImageText, isAvailable, packForLanguage, shutdown, LANGUAGE_PACKS , __test: { stripMessageChrome } };
