// backend/eval/stanceClaims.js
//
// Claims for the stance data (eval/stanceAgreement.js), drawn from today's
// news so the pairs look like what the verifier meets: each top headline as a
// claim other outlets confirm, and beside it the same headline with one
// detail changed (a figure, who beat whom, a direction, a negation), which
// outlets reporting the real story contradict. The labels are not taken from
// how a claim was made: every headline is judged by the hosted model through
// the verifier's own stance step, and changes that come out "unrelated" are
// recorded as such.
//
//   node eval/stanceClaims.js [--per 20]
//
// Writes eval/suites/stance_claims.json (adding to what is there).

const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'suites', 'stance_claims.json');
// Google News, India edition: the stories our readers forward. (fetchTopNews
// asks a news API first, whose top stories are mostly American.)
const EDITION = 'hl=en-IN&gl=IN&ceid=IN:en';
const CATEGORIES = { general: null, business: 'BUSINESS', technology: 'TECHNOLOGY', entertainment: 'ENTERTAINMENT', sports: 'SPORTS', science: 'SCIENCE', health: 'HEALTH' };

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Top headlines of one section, without the " - Outlet" Google appends. */
const topHeadlines = async (topic) => {
  const url = topic ? `https://news.google.com/rss/headlines/section/topic/${topic}?${EDITION}` : `https://news.google.com/rss?${EDITION}`;
  const xml = await fetch(url, { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const source = decode((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '').trim();
    return source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)).trim() : title.replace(/\s+-\s+[^-]+$/, '').trim();
  }).filter(Boolean);
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

// A headline that asks, live-blogs or teases asserts nothing to judge.
// So does an explainer ("Why Rubio is visiting..."), a quote cut short, and a
// page of puzzle hints, deals or how-tos.
const usable = (t) => t.split(/\s+/).length >= 6 && t.length <= 200
  && !/\?|^(live|watch|explained|opinion|analysis|photos?|video|why|how|what|when|who|where|here'?s|here is|top \d+|best)\b|\blive updates?\b|\||\.\.\.|…/i.test(t)
  && !/\b(hints?|answers?|wordle|strands|connections|quiz|horoscope|how to|tips|guide|review|deals?|discount|sale|price list|live score)\b/i.test(t);

const OPPOSITE = [
  ['wins', 'loses'], ['won', 'lost'], ['rises', 'falls'], ['rose', 'fell'], ['gains', 'loses'], ['up', 'down'],
  ['approves', 'rejects'], ['approved', 'rejected'], ['arrested', 'released'], ['launches', 'scraps'],
  ['increases', 'cuts'], ['hikes', 'cuts'], ['surges', 'plunges'], ['jumps', 'drops'], ['higher', 'lower'],
  ['record high', 'record low'], ['allows', 'bans'], ['resigns', 'is reappointed'], ['accepts', 'refuses']
];

/** The same headline with one detail changed, or null when no rule applies. */
const changeOneDetail = (t) => {
  // Who beat whom: "Australia beat India by 6 wickets" -> "India beat Australia by 6 wickets".
  const beat = t.match(/^(.+?)\s+(beat|beats|defeat|defeats|thrash|thrashes|stun|stuns|outclass|outclasses)\s+(.+?)(\s+(?:in|by|to|at|for)\s+.*|[,:].*)?$/i);
  if (beat) return { kind: 'swap', text: `${beat[3]} ${beat[2]} ${beat[1]}${beat[4] || ''}` };
  // A figure that is not a year: 85 medals -> 102 medals, Rs 2.5 crore -> Rs 3 crore.
  const fig = t.match(/(?<![A-Za-z\d.,\-/])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\d.,]*\d)(?!\s*(?:st|nd|rd|th)\b)/);
  if (fig && !/^(19|20)\d{2}$/.test(fig[1])) {
    const n = Number(fig[1].replace(/,/g, ''));
    const changed = fig[1].includes('.') ? (n + Math.max(0.5, n * 0.2)).toFixed(1) : String(Math.round(n + Math.max(1, n * 0.2)));
    return { kind: 'figure', text: t.replace(fig[1], changed) };
  }
  for (const [a, b] of OPPOSITE) {
    const re = new RegExp(`\\b${a}\\b`, 'i');
    if (re.test(t)) return { kind: 'direction', text: t.replace(re, b) };
    const back = new RegExp(`\\b${b}\\b`, 'i');
    if (back.test(t)) return { kind: 'direction', text: t.replace(back, a) };
  }
  const aux = t.match(/\b(is|are|was|were|has|have|will|can)\b(?!\s+not\b)/i);
  if (aux && !/\b(not|no|never|n't)\b/i.test(t)) return { kind: 'negation', text: t.replace(aux[0], `${aux[0]} not`) };
  return null;
};

const main = async () => {
  const per = Number(arg('per', 20));
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { about: '', cases: [] };
  const seen = new Set(existing.cases.map((c) => c.input.toLowerCase()));
  const day = new Date().toISOString().slice(0, 10);
  const cases = [];
  for (const [category, topic] of Object.entries(CATEGORIES)) {
    const titles = await topHeadlines(topic).catch(() => []);
    for (const raw of titles.filter(usable).slice(0, per)) {
      const title = raw.replace(/\s+/g, ' ').trim();
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const n = existing.cases.length + cases.length;
      cases.push({ id: `${day}-${n}`, category, kind: 'headline', input: title });
      const changed = changeOneDetail(title);
      if (changed && !seen.has(changed.text.toLowerCase())) {
        seen.add(changed.text.toLowerCase());
        cases.push({ id: `${day}-${n}c`, category, kind: changed.kind, input: changed.text, changedFrom: title });
      }
    }
  }
  const out = {
    about: 'Claims for the stance data (eval/stanceClaims.js): top headlines, and each with one detail changed. Labels come from the stance step, not from here.',
    cases: [...existing.cases, ...cases]
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  const kinds = cases.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] || 0) + 1 }), {});
  console.log(`${cases.length} new claims (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}); ${out.cases.length} in all`);
  process.exit(0);
};

if (require.main === module) main();

module.exports = { changeOneDetail, usable };
