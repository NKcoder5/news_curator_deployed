// More evidence against a claim must never make it look truer, and more
// evidence for it must never make it look falser. The decision explainer
// (services/decisionExplainer.js) found one case that broke this: a
// fact-checker's "false" added to old news passed off as new turned FAKE into
// CANNOT VERIFY. This sweeps a grid of evidence combinations for any other.
const test = require('node:test');
const assert = require('node:assert');
const { replayVerdict } = require('../agents/verdictEngine');

const ASOF = Date.parse('2026-10-12T07:30:00Z');
const RECENT = '2026-10-10T08:00:00Z';
const OLD = '2023-08-23T12:00:00Z';
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];

const outlets = (n, side, date, offset = 0) => Array.from({ length: n }, (_, k) => ({
  source: `Outlet ${side} ${WORDS[k + offset]}`, title: `${WORDS[k + offset]} ${side} report`, description: '',
  url: `https://${side}-${WORDS[k + offset]}.test/`, reliability: 8, publishedAt: date, reported: side === 'for' ? 'confirms' : 'otherwise'
}));

const debunk = { status: 'debunked', matches: [{ publisher: 'Factly', finding: 'false', rating: 'False', claimReviewed: 'the claim', url: 'https://factly.test/r', via: 'claimreview' }] };

const grid = [];
for (const time of ['now', 'past']) {
  for (const supportDate of [RECENT, OLD]) {
    for (const forN of [0, 1, 2, 3]) {
      for (const againstN of [0, 1, 2]) {
        for (const week of ['silent', 'presupposed-false']) {
          for (const premise of [0, 1]) {
            for (const techniques of [0, 2]) {
              grid.push({
                label: `${time} for=${forN}@${supportDate === OLD ? 'old' : 'new'} against=${againstN} week=${week} premise=${premise} tech=${techniques}`,
                input: {
                  claims: [{ claim: 'Narendra Modi resigned as Prime Minister.', verdict: 'x', time, kind: 'event',
                    supportingEvidence: outlets(forN, 'for', supportDate), contradictingEvidence: outlets(againstN, 'against', RECENT) }],
                  verificationStatus: forN || againstN ? 'checked' : 'unverified',
                  premiseResult: { status: premise ? 'contradicted' : 'consistent', contradictions: premise ? [{ entity: 'Narendra Modi', articleStates: 'resigned', referenceStates: 'is Prime Minister', reference: { title: 'Narendra Modi', url: 'https://en.wikipedia.org/wiki/Narendra_Modi' } }] : [], confirmations: [] },
                  factCheckResult: { status: 'none', matches: [] },
                  currentCoverageResult: { status: week, subject: 'Narendra Modi', headlinesRead: 30, outletsRead: 12,
                    presupposingFalse: week === 'presupposed-false' ? [{ source: 'The Hindu', title: 'PM Modi to visit Chennai', url: 'https://thehindu.test/x', reported: 'Modi still PM' }] : [] },
                  unconfirmedClaimResult: null,
                  sourceResult: { matched: false, score: 5, impersonates: null, type: null },
                  transparencyResult: { score: 6 },
                  manipulationResult: { techniques: Array.from({ length: techniques }, (_, k) => ({ technique: `t${k}` })) },
                  title: 'Narendra Modi resigned as Prime Minister.', publishedAt: null, domainAge: null, indexLagHours: 3, asOf: ASOF
                }
              });
            }
          }
        }
      }
    }
  }
}

const clone = (x) => JSON.parse(JSON.stringify(x));
// How strongly a call says the claim is false.
const FALSITY = { REAL: 0, 'CANNOT VERIFY': 1, MISLEADING: 2, 'PARTLY FALSE': 2, FAKE: 3 };
const falsity = (call) => FALSITY[call] ?? 1;

test(`a fact-checker's "false" never makes a verdict less false (${grid.length} combinations)`, () => {
  const broken = [];
  for (const { label, input } of grid) {
    const before = replayVerdict(input);
    const trial = clone(input);
    trial.factCheckResult = debunk;
    const after = replayVerdict(trial);
    if (falsity(after.call) < falsity(before.call)) broken.push(`${label}: ${before.call} -> ${after.call} (${after.rule})`);
  }
  assert.deepStrictEqual(broken, []);
});

test('more outlets reporting otherwise never make a verdict less false', () => {
  const broken = [];
  for (const { label, input } of grid) {
    const before = replayVerdict(input);
    const trial = clone(input);
    trial.claims[0].contradictingEvidence.push(...outlets(2, 'against', RECENT, 5));
    const after = replayVerdict(trial);
    if (falsity(after.call) < falsity(before.call)) broken.push(`${label}: ${before.call} -> ${after.call} (${after.rule})`);
  }
  assert.deepStrictEqual(broken, []);
});

// Fresh reports only: old reports confirming a claim presented as happening
// now are evidence that it is old news, and rightly make it more false.
test('more fresh outlets confirming it never make a verdict more false', () => {
  const broken = [];
  for (const { label, input } of grid) {
    const before = replayVerdict(input);
    const trial = clone(input);
    trial.claims[0].supportingEvidence.push(...outlets(2, 'for', RECENT, 5));
    const after = replayVerdict(trial);
    if (falsity(after.call) > falsity(before.call)) broken.push(`${label}: ${before.call} -> ${after.call} (${after.rule})`);
  }
  assert.deepStrictEqual(broken, []);
});

// A message with one claim confirmed and a premise the encyclopedia
// contradicts is partly false — and stays partly false when a second claim is
// also contradicted, rather than softening from FAKE to PARTLY FALSE.
test('a confirmed claim on a contradicted premise is partly false, with or without another claim contradicted', () => {
  const base = clone(grid.find(g => g.label === 'past for=0@new against=0 week=silent premise=1 tech=0').input);
  base.claims = [
    { claim: 'Narendra Modi inaugurated the new terminal at Chennai airport.', verdict: 'x', time: 'past', kind: 'event', supportingEvidence: outlets(2, 'for', RECENT), contradictingEvidence: [] },
    { claim: 'Narendra Modi resigned as Prime Minister.', verdict: 'x', time: 'past', kind: 'event', supportingEvidence: [], contradictingEvidence: [] }
  ];
  const confirmedOnly = replayVerdict(base);
  assert.strictEqual(confirmedOnly.rule, 'confirmed-claim-on-a-false-premise');
  assert.strictEqual(confirmedOnly.call, 'PARTLY FALSE');
  base.claims[1].contradictingEvidence = outlets(2, 'against', RECENT, 5);
  assert.strictEqual(replayVerdict(base).call, 'PARTLY FALSE');
});

// A second claim beside a confirmed one keeps the message from being REAL,
// however the first claim is confirmed (agents/verdictEngine.js R2d).
test('a claim this week rules out, or nobody reports, keeps a fact-checked message from being REAL', () => {
  const ruling = { status: 'confirmed', matches: [{ publisher: 'Factly', finding: 'true', rating: 'True', claimReviewed: 'A', url: 'https://factly.test/a', via: 'claimreview' }] };
  const input = (week, against) => ({
    ...clone(grid[0].input),
    claims: [{ claim: 'Narendra Modi inaugurated the Chennai airport terminal.', verdict: 'x', time: 'past', kind: 'event', supportingEvidence: outlets(1, 'for', RECENT), contradictingEvidence: outlets(against, 'against', RECENT, 5) }],
    factCheckResult: ruling,
    unconfirmedClaimResult: { claim: 'Free petrol for all students was announced.', confirmedClaim: 'Narendra Modi inaugurated the Chennai airport terminal.',
      week: { status: week, subject: 'free petrol', headlinesRead: 20, outletsRead: 9, presupposingFalse: week === 'presupposed-false' ? outlets(2, 'week', RECENT, 7).slice(0, 1).concat(outlets(1, 'wk', RECENT, 3)) : [] } }
  });
  assert.strictEqual(replayVerdict(input('presupposed-false', 0)).call, 'PARTLY FALSE');
  assert.strictEqual(replayVerdict(input('presupposed-false', 1)).call === 'REAL', false, 'fresh contradiction never makes it REAL');
  assert.strictEqual(replayVerdict(input('silent', 0)).call, 'CANNOT VERIFY');
});

