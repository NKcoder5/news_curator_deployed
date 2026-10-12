// backend/eval/claimMatching.js
//
// How well does the claim memory recognise a claim it has seen?
//
// Scores services/claimSignature.compareSignatures on labelled pairs
// (eval/suites/claim_matching.json): same, variant (figure, date or polarity
// changed) or different. The error that matters most is a FALSE MERGE — two
// different claims treated as one, which would attach one claim's history and
// verdict to another. A missed match only costs a repeated check.
//
// Usage: node eval/claimMatching.js              signatures only
//        node eval/claimMatching.js --with-model  ambiguous pairs settled by the model, as in use
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { signatureOf, compareSignatures } = require('../services/claimSignature');
const { sameClaim } = require('../services/claimMatchJudge');
const withModel = process.argv.includes('--with-model');

const { pairs } = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'claim_matching.json'), 'utf8'));

(async () => {
const rows = [];
for (const p of pairs) {
  const r = compareSignatures(signatureOf(p.a), signatureOf(p.b));
  let got = r.relation;
  if (withModel && r.ambiguous && await sameClaim(p.a, p.b)) got = 'same';
  rows.push({ ...p, got, differences: r.differences, score: r.score, askedModel: Boolean(withModel && r.ambiguous) });
}

const count = (pred) => rows.filter(pred).length;
const askedModel = count(r => r.askedModel);
const linked = (rel) => rel === 'same' || rel === 'variant';
const summary = {
  pairs: rows.length,
  exact: count(r => r.got === r.label),
  falseMerges: count(r => r.label === 'different' && r.got === 'same'),
  falseLinks: count(r => r.label === 'different' && linked(r.got)),
  sameRecall: `${count(r => r.label === 'same' && r.got === 'same')}/${count(r => r.label === 'same')}`,
  variantRecall: `${count(r => r.label === 'variant' && r.got === 'variant')}/${count(r => r.label === 'variant')}`,
  differentKeptApart: `${count(r => r.label === 'different' && r.got === 'different')}/${count(r => r.label === 'different')}`,
  modelConsulted: withModel ? askedModel : 'off'
};

for (const r of rows) {
  const mark = r.got === r.label ? 'ok ' : (r.label === 'different' && r.got !== 'different' ? 'XX ' : '-- ');
  console.log(`${mark} ${r.label.padEnd(8)} got ${r.got.padEnd(9)} ${String(r.score).padEnd(5)} ${r.a.slice(0, 48)} ~ ${r.b.slice(0, 48)}${r.differences.length ? `  [${r.differences.join('; ')}]` : ''}`);
}
console.log('\n' + JSON.stringify(summary, null, 1));
const out = path.join(__dirname, 'results');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, withModel ? 'claim_matching_with_model.json' : 'claim_matching.json'), JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 2));
process.exit(0);
})();
