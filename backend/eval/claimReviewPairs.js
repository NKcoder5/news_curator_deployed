// backend/eval/claimReviewPairs.js
//
// Stance pairs for our own pair model from fact-checkers' published reviews (eval/claimReviewCorpus.js),
// labelled by the desks' own ratings and wording, not by any model:
//
//   debunk        a review rated false whose headline denies the claim, against the claim it reviewed:
//                 the headline says the claim is not so (disagree). "Old video from Bangladesh shared as
//                 attack on Delhi Police" against "Video shows Congress worker attacking a Delhi policewoman".
//   confirm       a review rated true whose headline does not deny it, against its claim (agree).
//   other rumour  a debunk's headline against another rumour about the same people or places, reviewed
//                 months apart and differing in what it says (unrelated): a desk calling one story about
//                 Modi false says nothing about the next one. The readings our model got wrong on held-out
//                 news were of this kind: another event, an interim count, another programme.
//
// Also lists candidate pairs of two desks' wordings that may be one rumour, for labelling by hand as the
// same claim or not (the fact-check matcher's question), in match_candidates.json.
//
//   node eval/claimReviewPairs.js
//
// Writes ml/data/claimreview_pairs.jsonl (with a split per review: train, dev or eval, by its address)
// and ml/data/raw/claimreview/match_candidates.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { signatureOf, compareSignatures } = require('../services/claimSignature');

const ML = path.join(__dirname, '..', '..', 'ml', 'data');
const CORPUS = path.join(ML, 'raw', 'claimreview', 'corpus.jsonl');
const OUT = path.join(ML, 'claimreview_pairs.jsonl');
const CANDIDATES = path.join(ML, 'raw', 'claimreview', 'match_candidates.json');

// "Fact Check:", "FACT CHECK -", "Fact-check |" and the like: the desk's label, not what it found.
const PREFIX = /^\s*(?:\[?\s*(?:fact[\s-]?check(?:ed)?|factcheck|fake news buster|viral check|vishvas news|fact crescendo|boom fact check)\s*\]?\s*[:|\-–—]\s*)+/i;
// What a debunk's headline says of the claim, in the languages Indian desks publish in.
const DENIES = new RegExp([
  String.raw`\b(?:not|no|never|false(?:ly)?|fake|hoax|myth|misleading|wrong(?:ly)?|debunk\w*|untrue|baseless|fabricated|doctored|morphed|edited|old|unrelated|satire|satirical|ai[\s-]generated|deep\s?fake|digitally (?:altered|created)|scripted|staged|rumou?r|misinformation|incorrect|unverified|clipped|cropped|out of context|shared (?:as|with)|passed off)\b|n['’]t\b`,
  // Hindi, Marathi: fake, false, misleading, wrong, not, old, edited, rumour
  'फर्जी|फ़र्ज़ी|झूठ|भ्रामक|गलत|ग़लत|नहीं|पुराना|पुरानी|एडिटेड|अफवाह|खोटा|खोटी|दिशाभूल',
  // Tamil: fake, false, wrong, not, old, rumour, misleading
  'போலி|பொய்|தவறான|தவறு|இல்லை|பழைய|வதந்தி|திரித்து',
  // Telugu, Kannada, Malayalam, Bengali: fake, false, wrong, not
  'నకిలీ|తప్పు|అబద్ధం|ಸುಳ್ಳು|ನಕಲಿ|ತಪ್ಪು|വ്യാജ|തെറ്റ്|ভুয়া|মিথ্যা|ভুল|বিভ্রান্তিকর'
].join('|'), 'iu');
const ASKS = /\?["'”’)\]]*\s*$/;

const scriptOf = (t) => (/[஀-௿]/.test(t) ? 'ta' : /[ऀ-ॿ]/.test(t) ? 'hi' : /[ঀ-৿]/.test(t) ? 'bn'
  : /[ఀ-౿]/.test(t) ? 'te' : /[ഀ-ൿ]/.test(t) ? 'ml' : /[ಀ-೿]/.test(t) ? 'kn' : 'en');
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
// By the review's address, so a review is in one split only: 80% train, 10% dev, 10% eval.
const splitOf = (url) => { const b = parseInt(hash(url).slice(0, 4), 16) % 10; return b === 0 ? 'eval' : b === 1 ? 'dev' : 'train'; };
const days = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86400000 : Infinity);

const clean = (title) => String(title || '').replace(PREFIX, '').replace(/\s+/g, ' ').trim();
const shares = (a, b) => {
  const x = new Set([...a.entities, ...a.terms]);
  const y = [...b.entities, ...b.terms];
  const common = y.filter((t) => x.has(t)).length;
  return { common, jaccard: common / Math.max(1, new Set([...x, ...y]).size) };
};

const rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reviews = rows.map((r) => ({ ...r, headline: clean(r.title), sig: signatureOf(r.claim), split: splitOf(r.url) }));
for (const r of reviews) r.headSig = r.headline ? signatureOf(r.headline) : null;

const out = [];
const counts = {};
const push = (r, premise, label, sub, extra = {}) => {
  out.push({ premise, hypothesis: r.claim, label, src: 'claimreview', sub, lang: scriptOf(`${premise} ${r.claim}`),
    claim_id: hash(r.url).slice(0, 12), split: r.split, publisher: r.publisher, ...extra });
  counts[sub] = (counts[sub] || 0) + 1;
};

for (const r of reviews) {
  if (!r.headline || r.headline.length < 15 || ASKS.test(r.headline)) continue;
  // The headline must be about the claim: a name or a word in common (or another script, where the
  // signature cannot tell, and the desk's own pairing of the two is the evidence).
  const about = scriptOf(r.headline) !== scriptOf(r.claim) || shares(r.sig, r.headSig).common >= 1;
  if (!about) continue;
  if (r.ratingClass === 'false' && DENIES.test(r.headline)) push(r, r.headline, 2, 'debunk');
  else if (r.ratingClass === 'true' && !DENIES.test(r.headline)) push(r, r.headline, 0, 'confirm');
}

// Another rumour about the same subject: one per debunk, chosen deterministically.
const byEntity = new Map();
for (const r of reviews) for (const e of r.sig.entities) { if (!byEntity.has(e)) byEntity.set(e, []); byEntity.get(e).push(r); }
for (const x of out.filter((p) => p.sub === 'debunk').map((p) => reviews.find((r) => hash(r.url).slice(0, 12) === p.claim_id))) {
  const pool = [...new Set(x.sig.entities.flatMap((e) => byEntity.get(e) || []))]
    .filter((y) => y.url !== x.url && y.split === x.split && days(x.reviewedAt, y.reviewedAt) >= 90
      && compareSignatures(x.sig, y.sig).relation === 'different' && shares(x.sig, y.sig).jaccard < 0.25);
  if (!pool.length) continue;
  const y = pool.sort((a, b) => hash(x.url + a.url).localeCompare(hash(x.url + b.url)))[0];
  push(y, x.headline, 1, 'other rumour', { premise_claim: x.claim });
}

// Two desks' wordings that may be one rumour: reviewed within two weeks of each other, by different
// desks, sharing much of what they say. Labelled by hand; the label decides, not this score.
const candidates = [];
for (let i = 0; i < reviews.length; i += 1) {
  for (let j = i + 1; j < reviews.length; j += 1) {
    const a = reviews[i];
    const b = reviews[j];
    if (a.publisher === b.publisher || days(a.reviewedAt, b.reviewedAt) > 14) continue;
    const s = shares(a.sig, b.sig);
    if (s.common < 2 || s.jaccard < 0.2) continue;
    candidates.push({ a: a.claim, b: b.claim, aUrl: a.url, bUrl: b.url, aRating: a.ratingClass, bRating: b.ratingClass,
      score: Number(s.jaccard.toFixed(3)), relation: compareSignatures(a.sig, b.sig).relation });
  }
}
candidates.sort((p, q) => q.score - p.score);

fs.writeFileSync(OUT, out.map((p) => JSON.stringify(p)).join('\n') + '\n');
fs.writeFileSync(CANDIDATES, JSON.stringify({ about: 'Candidate same-rumour pairs from two desks, for labelling by hand (eval/claimReviewPairs.js).', pairs: candidates }, null, 1) + '\n');
const bySplit = out.reduce((m, p) => ({ ...m, [p.split]: (m[p.split] || 0) + 1 }), {});
const byLang = out.reduce((m, p) => ({ ...m, [p.lang]: (m[p.lang] || 0) + 1 }), {});
console.log(`${out.length} pairs from ${reviews.length} reviews: ${JSON.stringify(counts)}; splits ${JSON.stringify(bySplit)}; languages ${JSON.stringify(byLang)}`);
console.log(`${candidates.length} candidate same-rumour pairs (${candidates.filter((c) => c.score >= 0.4).length} sharing 40% or more)`);
