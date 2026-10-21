// backend/eval/readerData.js
//
// Training data for our own message reader: Gemini's reading of each message, as the reading step
// (agents/inputUnderstanding.js) asks for it, recorded with the provider that answered, so a small
// model can be taught to give the same reading (ml/, the reader LLM).
//
//   node eval/readerData.js [--max-calls 400] [--sources suites,news]
//
// Messages come from sources that are not used to evaluate the system: the stance claims (today's
// headlines and their one-detail-changed copies), the fact-checkers' ruled claims, the consistency
// suite's four phrasings of each claim, the older robustness and held-out suites, and today's Google
// News headlines in English, Tamil and Hindi. The benchmark, held-out v2 and the reviewer probe stay
// out: they evaluate the reader afterwards, as they evaluate the system.
//
// Writes eval/results/reader_pairs.jsonl, one line per message (appending, resumable by message), and
// spends at most --max-calls readings in a run, so labelling never takes the quota a check needs.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Every reading the step asks for is recorded, with who answered. Wrapped before the reader loads,
// since it takes its reference to the gateway when it is required.
const gateway = require('../utils/nvidiaNimApi');
const realCall = gateway.callNimApiJson;
let last = null;
gateway.callNimApiJson = async (prompt, options = {}) => {
  const meta = {};
  const value = await realCall(prompt, { ...options, meta });
  if (options.label === 'input understanding') last = { value, provider: meta.provider || null, model: meta.model || null, cached: Boolean(meta.cached) };
  return value;
};
const { understandInput } = require('../agents/inputUnderstanding');

const OUT = path.join(__dirname, 'results', 'reader_pairs.jsonl');
const SUITES = path.join(__dirname, 'suites');
const EDITIONS = { en: 'hl=en-IN&gl=IN&ceid=IN:en', ta: 'hl=ta&gl=IN&ceid=IN:ta', hi: 'hl=hi&gl=IN&ceid=IN:hi' };
const TOPICS = [null, 'NATION', 'BUSINESS', 'TECHNOLOGY', 'ENTERTAINMENT', 'SPORTS', 'SCIENCE', 'HEALTH'];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const idOf = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
const load = (name) => JSON.parse(fs.readFileSync(path.join(SUITES, `${name}.json`), 'utf8'));

/** Messages from the suites that do not evaluate the system. */
const suiteMessages = () => {
  const out = [];
  for (const c of load('stance_claims').cases) out.push({ source: 'stance_claims', text: c.input });
  for (const c of load('rulings').cases) out.push({ source: 'rulings', text: c.input });
  for (const c of load('consistency').claims) for (const p of c.phrasings || []) out.push({ source: `consistency:${p.style}`, text: p.text });
  for (const name of ['robustness_suite', 'heldout_suite']) for (const c of load(name).cases) if (!/^https?:/i.test(c.input)) out.push({ source: name, text: c.input });
  return out;
};

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Today's Google News headlines, each edition and section, without the outlet Google appends. */
const newsMessages = async () => {
  const out = [];
  for (const [lang, edition] of Object.entries(EDITIONS)) {
    for (const topic of TOPICS) {
      const url = topic ? `https://news.google.com/rss/headlines/section/topic/${topic}?${edition}` : `https://news.google.com/rss?${edition}`;
      try {
        const xml = await fetch(url, { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
        for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
          const source = decode((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '').trim();
          const text = source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)).trim() : title;
          if (text.split(/\s+/).length >= 4) out.push({ source: `news:${lang}`, text });
        }
      } catch (_) { /* a section that does not answer is left out */ }
    }
  }
  return out;
};

const main = async () => {
  const maxCalls = Number(arg('max-calls', 400));
  const sources = (arg('sources', 'suites,news') || '').split(',');
  const done = new Set(fs.existsSync(OUT)
    ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch (_) { return null; } })
    : []);
  let messages = [];
  if (sources.includes('suites')) messages.push(...suiteMessages());
  if (sources.includes('news')) messages.push(...await newsMessages());
  const seen = new Set();
  messages = messages.filter((m) => { const id = idOf(m.text); if (seen.has(id) || done.has(id)) return false; seen.add(id); m.id = id; return true; });
  console.log(`${messages.length} new messages (${done.size} already recorded); spending at most ${maxCalls} readings`);

  let calls = 0; let kept = 0; let failed = 0; let fallbacks = 0; let streak = 0;
  for (const m of messages) {
    if (calls >= maxCalls) break;
    last = null;
    try {
      await understandInput(m.text);
    } catch (_) { /* recorded below as a failure */ }
    calls += 1;
    if (!last || !last.value) { failed += 1; streak += 1; }
    else {
      streak = last.provider === 'gemini' || (last.cached && last.provider === 'gemini') ? 0 : streak + 1;
      if (last.provider !== 'gemini') fallbacks += 1;
      fs.appendFileSync(OUT, `${JSON.stringify({ id: m.id, source: m.source, message: m.text, reading: last.value, provider: last.provider, model: last.model, at: new Date().toISOString() })}\n`);
      kept += 1;
    }
    // Labels from a fallback model are not labels to learn from, and five in a row means Gemini is
    // out: stop, and resume after the reset rather than record a weaker model's readings.
    if (streak >= 5) { console.log('Stopped: five readings in a row did not come from Gemini (quota or outage). Resume later.'); break; }
    if (calls % 25 === 0) console.log(`${calls} readings: ${kept} kept, ${fallbacks} by a fallback model, ${failed} failed`);
  }
  console.log(`done: ${calls} readings, ${kept} recorded (${fallbacks} by a fallback model, not for training), ${failed} failed`);
  process.exit(0);
};

if (require.main === module) main();

module.exports = { suiteMessages, idOf };
