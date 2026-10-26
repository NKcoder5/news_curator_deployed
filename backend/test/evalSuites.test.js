// Every labelled suite is evidence only if it is well formed: ids unique, the
// expected answer one the service can give, no message counted in two suites
// (a case reused from a suite the system was tuned on is not held out), and
// every label that is not a refusal resting on a source someone can open.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { outcomeOf, degradedLabels, quotaGuard } = require('../eval/liveCheck');

const SUITES = path.join(__dirname, '..', 'eval', 'suites');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SUITES, name), 'utf8'));
const files = fs.readdirSync(SUITES).filter(f => f.endsWith('.json'));

const CALLS = new Set(['REAL', 'FAKE', 'PARTLY FALSE', 'MISLEADING', 'CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'SATIRE']);
const REFUSALS = new Set(['REFUSED', 'NOT A FACTUAL CLAIM']);
const RELATIONS = new Set(['same', 'variant', 'different']);
// Written before sources were recorded with each label. Every suite written
// since must carry them.
const WITHOUT_SOURCES = new Set(['robustness_suite.json', 'heldout_suite.json', 'claim_matching.json']);
// Adversarial inputs, not labelled claims: their expected answers and their
// evidence follow the security stream's own scheme (eval/injectionSuite.js).
// They still parse, keep unique ids and repeat no other suite's message.
const NOT_FACTUAL = new Set(['injection_suite.json']);
// Claims with no verdict label: stance data is drawn from them (eval/stanceClaims.js), and its labels
// come from the stance step, per headline, not from the suite.
const UNLABELLED = new Set(['stance_claims.json']);
// Found by this test: the benchmark and the robustness suite (both of 11 Oct)
// share one message. Left as it was, since those runs are already on record;
// data/ruleReliability.json counts it twice. No other repeat is allowed.
const KNOWN_REPEATS = new Set(['chennai is the capital of karnataka']);
const normalise = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const isUrl = (s) => /^https?:\/\/[^\s/]+\.[^\s]+$/.test(s);

/** The messages a suite sends to the service, with the case each belongs to. */
const inputsOf = (name, suite) => [
  ...(suite.cases || []).filter(c => typeof c.input === 'string').map(c => ({ suite: name, id: c.id, input: c.input })),
  ...(suite.claims || []).flatMap(c => (c.phrasings || []).map(p => ({ suite: name, id: `${c.id}/${p.style}`, input: p.input })))
];

// The benchmark's claims live in its script; they are messages too.
const benchmarkInputs = () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'eval', 'benchmarkCheckAnything.js'), 'utf8');
  return [...source.matchAll(/\{ text: '((?:[^'\\]|\\.)*)', truth:/g)].map((m, i) => ({ suite: 'benchmarkCheckAnything.js', id: `b-${i + 1}`, input: m[1] }));
};

test('every suite file parses and has cases, claims or pairs', () => {
  assert.ok(files.length >= 6, `expected at least six suites, found ${files.join(', ')}`);
  for (const f of files) {
    const s = load(f);
    assert.ok((s.cases || s.claims || s.pairs || []).length > 0, `${f} is empty`);
  }
});

test('ids are unique within each suite', () => {
  for (const f of files) {
    const s = load(f);
    const ids = [...(s.cases || []), ...(s.claims || []), ...(s.pairs || [])].map(c => c.id).filter(Boolean);
    assert.strictEqual(new Set(ids).size, ids.length, `${f} repeats an id`);
  }
});

test('message cases expect an answer the service can give', () => {
  for (const f of files.filter(x => !NOT_FACTUAL.has(x))) {
    const s = load(f);
    for (const c of [...(s.cases || []), ...(s.claims || [])].filter(x => x.expected)) {
      assert.ok(CALLS.has(c.expected), `${f} ${c.id}: unknown expected ${c.expected}`);
      for (const a of c.alsoAcceptable || []) {
        assert.ok(CALLS.has(a) && a !== c.expected, `${f} ${c.id}: bad alsoAcceptable ${a}`);
      }
      if (s.cases) {
        assert.ok(c.id && c.category && typeof c.input === 'string' && c.input.trim(), `${f}: a case lacks id, category or input`);
      }
    }
  }
});

test('no message appears in two suites, or twice in one', () => {
  const all = [...files.flatMap(f => inputsOf(f, load(f))), ...benchmarkInputs()];
  assert.ok(all.length > 150, `expected the suites' messages, found ${all.length}`);
  const seen = new Map();
  const repeats = [];
  for (const x of all) {
    const key = normalise(x.input);
    if (seen.has(key) && !KNOWN_REPEATS.has(key)) repeats.push(`${x.suite} ${x.id} repeats ${seen.get(key)}: "${x.input}"`);
    else seen.set(key, `${x.suite} ${x.id}`);
  }
  assert.deepStrictEqual(repeats, []);
});

test('every label that is not a refusal rests on a source URL, with the date it was labelled', () => {
  for (const f of files.filter(x => !WITHOUT_SOURCES.has(x) && !NOT_FACTUAL.has(x) && !UNLABELLED.has(x))) {
    const s = load(f);
    for (const c of [...(s.cases || []), ...(s.claims || [])]) {
      if (REFUSALS.has(c.expected)) continue;
      assert.ok((c.sources || []).length > 0, `${f} ${c.id} has no source`);
      for (const u of c.sources) assert.ok(isUrl(u), `${f} ${c.id}: "${u}" is not a URL`);
      assert.match(String(c.labelledOn || s.labelledOn || ''), /^\d{4}-\d{2}-\d{2}$/, `${f} ${c.id} has no labelledOn date`);
    }
  }
});

test('the consistency suite writes every claim four ways', () => {
  const { claims } = load('consistency.json');
  assert.ok(claims.length >= 10);
  for (const c of claims) {
    assert.deepStrictEqual(c.phrasings.map(p => p.style), ['plain', 'question', 'native', 'forward'], c.id);
    assert.ok(['ta', 'hi'].includes(c.phrasings[2].language), `${c.id}: the third phrasing is Tamil or Hindi`);
  }
});

test('claim-matching pairs are labelled, and the held-out set has its decoys', () => {
  for (const f of files.filter(x => x.startsWith('claim_matching'))) {
    for (const p of load(f).pairs) {
      assert.ok(p.a && p.b && RELATIONS.has(p.label), `${f}: bad pair ${JSON.stringify(p).slice(0, 80)}`);
      assert.ok(!p.decoy || p.label === 'different', `${f} ${p.id}: a decoy is a different claim`);
    }
  }
  const held = load('claim_matching_heldout.json').pairs;
  assert.ok(held.length >= 40);
  assert.ok(held.filter(p => p.decoy).length >= 12);
});

test('held-out suite v2 is large enough and covers old news presented as today', () => {
  const { cases } = load('heldout_v2.json');
  assert.ok(cases.length >= 40);
  assert.ok(cases.filter(c => c.category === 'old news as today').length >= 5);
});

test('outcomes: an abstention is missed, a verdict the other way is wrong', () => {
  const c = { expected: 'FAKE', alsoAcceptable: ['CANNOT VERIFY'] };
  assert.strictEqual(outcomeOf(c, 'FAKE'), 'right');
  assert.strictEqual(outcomeOf(c, 'CANNOT VERIFY'), 'safe');
  assert.strictEqual(outcomeOf({ expected: 'FAKE' }, 'CANNOT VERIFY'), 'missed');
  assert.strictEqual(outcomeOf(c, 'REAL'), 'wrong');
});

test('a Gemini-led judgement answered by another provider marks the case degraded; a cached one does not', () => {
  assert.deepStrictEqual(degradedLabels([
    { label: 'input understanding', provider: 'nim' },
    { label: 'stance judgement', provider: 'gemini' },
    { label: 'clickbait', provider: 'ollama' },
    { label: 'fact-check match', provider: 'ollama', cached: true }
  ]), ['input understanding']);
});

test('the quota guard stops after two degraded or failed cases in a row', () => {
  const guard = quotaGuard();
  assert.strictEqual(guard.note({ call: 'REAL', degraded: ['stance judgement'] }), false);
  assert.strictEqual(guard.note({ call: 'FAKE', degraded: [] }), false);
  assert.strictEqual(guard.note({ call: 'ERROR', degraded: [] }), false);
  assert.strictEqual(guard.note({ call: 'REAL', degraded: ['input understanding'] }), true);
});

// 26 Oct: the network dropped mid-run, every search failed, and seventeen cases were filed as missed
// before the run ended on its own. A check that could not search measured the network.
test('the guard stops when searches cannot run, and a resumed run checks those cases again', () => {
  const { keptRows, unmeasured } = require('../eval/liveCheck');
  const guard = quotaGuard();
  const down = { call: 'CANNOT VERIFY', rule: 'verification-unavailable', degraded: [] };
  assert.strictEqual(guard.note(down), false);
  assert.strictEqual(guard.note(down), true);
  assert.strictEqual(unmeasured(down), true);
  assert.strictEqual(unmeasured({ call: 'CANNOT VERIFY', rule: 'no-independent-coverage', degraded: [] }), false);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')), 'run.json');
  fs.writeFileSync(file, JSON.stringify({ rows: [{ id: 'a', call: 'FAKE', rule: 'rated-false-by-fact-checkers', degraded: [] }, { id: 'b', ...down }] }));
  assert.deepStrictEqual(keptRows(file).map(r => r.id), ['a']);
});
