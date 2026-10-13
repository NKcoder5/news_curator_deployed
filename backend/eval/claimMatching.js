// backend/eval/claimMatching.js
//
// How well does the claim memory recognise a claim it has seen?
//
// Scores services/claimSignature.compareSignatures on labelled pairs
// (eval/suites/claim_matching.json): same, variant (figure, date or polarity
// changed) or different. The error that matters most is a FALSE MERGE — two
// different claims treated as one, which would attach one claim's history and
// verdict to another. A variant merged as the same claim is as costly: "India
// beat West Indies" filed under "West Indies beat India" carries the FAKE
// verdict of one onto the other. A missed match only costs a repeated check.
//
// Usage: node eval/claimMatching.js                          signatures only
//        node eval/claimMatching.js --with-model             ambiguous pairs settled by the model, as in use
//        node eval/claimMatching.js --suite claim_matching_heldout
//                                                           the held-out pairs (eval/suites/<name>.json)
//        node eval/claimMatching.js --with-model --max-model-calls 15
//                                                           refuse to start if more pairs than that need the model
//
// Writes eval/results/claim_matching[_<suite>][_with_model].json.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { signatureOf, compareSignatures } = require('../services/claimSignature');
const { sameClaim } = require('../services/claimMatchJudge');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const withModel = args.includes('--with-model');
const suiteName = flag('--suite', 'claim_matching');
const maxModelCalls = flag('--max-model-calls') === null ? Infinity : Number(flag('--max-model-calls'));

const { pairs } = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', `${suiteName}.json`), 'utf8'));

/** Score labelled rows ({label, got, decoy?, askedModel}) the same way for every suite. */
const summarise = (rows) => {
  const count = (pred) => rows.filter(pred).length;
  const linked = (rel) => rel === 'same' || rel === 'variant';
  const decoys = rows.filter(r => r.decoy);
  return {
    pairs: rows.length,
    exact: count(r => r.got === r.label),
    falseMerges: count(r => r.label === 'different' && r.got === 'same'),
    variantsMerged: count(r => r.label === 'variant' && r.got === 'same'),
    falseLinks: count(r => r.label === 'different' && linked(r.got)),
    sameRecall: `${count(r => r.label === 'same' && r.got === 'same')}/${count(r => r.label === 'same')}`,
    variantRecall: `${count(r => r.label === 'variant' && r.got === 'variant')}/${count(r => r.label === 'variant')}`,
    differentKeptApart: `${count(r => r.label === 'different' && r.got === 'different')}/${count(r => r.label === 'different')}`,
    decoysKeptApart: `${decoys.filter(r => r.got === 'different').length}/${decoys.length}`,
    ambiguous: count(r => r.ambiguous),
    modelConsulted: withModel ? count(r => r.askedModel) : 'off'
  };
};

(async () => {
  const compared = pairs.map(p => ({ p, r: compareSignatures(signatureOf(p.a), signatureOf(p.b)) }));
  const needModel = compared.filter(x => x.r.ambiguous).length;
  if (withModel && needModel > maxModelCalls) {
    console.error(`${needModel} ambiguous pairs would each need a model call; --max-model-calls is ${maxModelCalls}. Not started.`);
    process.exit(2);
  }

  const rows = [];
  for (const { p, r } of compared) {
    let got = r.relation;
    const askedModel = Boolean(withModel && r.ambiguous);
    if (askedModel && await sameClaim(p.a, p.b)) got = 'same';
    rows.push({ ...p, got, differences: r.differences, score: r.score, ambiguous: Boolean(r.ambiguous), askedModel });
  }

  const summary = summarise(rows);
  for (const r of rows) {
    const costly = (r.label === 'different' || r.label === 'variant') && r.got === 'same';
    const mark = r.got === r.label ? 'ok ' : costly || (r.label === 'different' && r.got !== 'different') ? 'XX ' : '-- ';
    console.log(`${mark} ${r.label.padEnd(9)} got ${r.got.padEnd(9)} ${String(r.score).padEnd(5)} ${r.a.slice(0, 48)} ~ ${r.b.slice(0, 48)}${r.differences.length ? `  [${r.differences.join('; ')}]` : ''}${r.ambiguous ? '  (ambiguous)' : ''}`);
  }
  console.log('\n' + JSON.stringify(summary, null, 1));
  const out = path.join(__dirname, 'results');
  fs.mkdirSync(out, { recursive: true });
  const base = suiteName === 'claim_matching' ? 'claim_matching' : `claim_matching_${suiteName.replace(/^claim_matching_/, '')}`;
  fs.writeFileSync(path.join(out, `${base}${withModel ? '_with_model' : ''}.json`),
    JSON.stringify({ ranAt: new Date().toISOString(), suite: suiteName, summary, rows }, null, 2));
  process.exit(0);
})();
