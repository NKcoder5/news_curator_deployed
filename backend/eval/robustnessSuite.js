// backend/eval/robustnessSuite.js
//
// Does Check Anything cope with the way people actually phrase things?
//
// A benchmark of tidy one-line claims measures the easy case. What people
// paste is a question ("is it true that…"), a hedge ("I heard…"), a forward
// in capitals with emoji, a sarcastic aside, a negation, an opinion wrapped
// round a fact, two claims in one breath, Tamil, Tanglish, Hindi, a typo, old
// news passed off as new. eval/suites/robustness_suite.json holds labelled
// cases of each kind; this runs every one through the same service the page
// uses and scores the answers three ways:
//
//   right      — the expected answer
//   safe       — an abstention or refusal listed as acceptable: unhelpful,
//                but it misleads no one
//   wrong      — anything else, and above all REAL for a false claim or FAKE
//                for a true one
//
// Usage:
//   node eval/robustnessSuite.js                     every case
//   node eval/robustnessSuite.js --category Tamil    one category
//   node eval/robustnessSuite.js --id q-1,ta-3       chosen cases
//   node eval/robustnessSuite.js --gap 8             seconds between cases
//   node eval/robustnessSuite.js --out before        results file suffix
//
// Writes eval/results/robustness_<out>.{json,md}.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { runContentCheck } = require('../services/contentCheck');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const gapSeconds = Number(flag('--gap', 5));
const outName = flag('--out', 'latest');
const onlyCategory = flag('--category');
const onlyIds = flag('--id') ? new Set(flag('--id').split(',')) : null;

const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'suites', 'robustness_suite.json'), 'utf8'));
const cases = suite.cases
  .filter(c => !onlyCategory || c.category === onlyCategory)
  .filter(c => !onlyIds || onlyIds.has(c.id));

const outcomeOf = (c, call) => {
  if (call === c.expected) return 'right';
  if ((c.alsoAcceptable || []).includes(call)) return 'safe';
  return 'wrong';
};

(async () => {
  const rows = [];
  for (const c of cases) {
    const started = Date.now();
    let call; let detail = ''; let rule = null; let readAs = null;
    try {
      const report = await runContentCheck(c.isUrl ? { url: c.input } : { text: c.input });
      call = report.call;
      detail = report.oneLine || '';
      rule = report.decision?.rule || null;
      readAs = report.understanding || null;
    } catch (err) {
      if (err.status && err.status < 500 && err.payload) {
        call = 'REFUSED';
        detail = err.payload.error || '';
      } else {
        call = 'ERROR';
        detail = err.message;
      }
    }
    const row = { ...c, call, outcome: outcomeOf(c, call), rule, detail, readAs, seconds: (Date.now() - started) / 1000 };
    rows.push(row);
    const mark = { right: '✓', safe: '~', wrong: '✗' }[row.outcome];
    console.log(`${mark} ${c.id.padEnd(10)} ${c.category.padEnd(22)} expected ${c.expected.padEnd(19)} got ${call.padEnd(19)} ${row.seconds.toFixed(1)}s  ${detail.slice(0, 80)}`);
    await new Promise(resolve => setTimeout(resolve, gapSeconds * 1000));
  }

  const tally = (list) => ({
    n: list.length,
    right: list.filter(r => r.outcome === 'right').length,
    safe: list.filter(r => r.outcome === 'safe').length,
    wrong: list.filter(r => r.outcome === 'wrong').length
  });
  const categories = [...new Set(rows.map(r => r.category))];
  const summary = {
    ranAt: new Date().toISOString(),
    overall: tally(rows),
    byCategory: Object.fromEntries(categories.map(cat => [cat, tally(rows.filter(r => r.category === cat))]))
  };

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `robustness_${outName}.json`), JSON.stringify({ summary, rows }, null, 2));
  const md = [
    `# Robustness suite (${outName})`,
    '',
    `Run ${summary.ranAt.slice(0, 16).replace('T', ' ')} UTC. ${summary.overall.right}/${summary.overall.n} right, ${summary.overall.safe} safe abstentions, ${summary.overall.wrong} wrong.`,
    '',
    '| Category | Cases | Right | Safe | Wrong |',
    '|---|---|---|---|---|',
    ...categories.map(cat => {
      const t = summary.byCategory[cat];
      return `| ${cat} | ${t.n} | ${t.right} | ${t.safe} | ${t.wrong} |`;
    }),
    '',
    '| Id | Input | Expected | Got | Decided by |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.id} | ${r.input.replace(/\|/g, '/').slice(0, 90)} | ${r.expected} | ${r.call} | ${r.rule || ''} |`),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(outDir, `robustness_${outName}.md`), md);

  const o = summary.overall;
  console.log(`\n${o.right}/${o.n} right, ${o.safe} safe, ${o.wrong} wrong`);
  for (const cat of categories) {
    const t = summary.byCategory[cat];
    console.log(`  ${cat.padEnd(24)} ${t.right}/${t.n}${t.wrong ? `  (${t.wrong} wrong)` : ''}`);
  }
  process.exit(0);
})();
