// A channel that could not be read in time counts as absent — never as a
// finding.
//
// A reader's check now answers when its evidence channels are due, and a
// channel still out is reported as "could not be read in time". That is only
// safe if an unread channel moves the verdict nowhere: not towards FAKE (an
// unrun news search read as "no outlet reports this", a writing check with no
// score read as "names no sources"), and not towards REAL. These tests hold
// the values agents/trustAnalysisAgent.js substitutes (UNREAD) to that, over a
// grid of evidence, and check the deadline and the early start end to end
// with every channel stubbed.
const test = require('node:test');
const assert = require('node:assert');
const { replayVerdict, compactLedgerInput } = require('../agents/verdictEngine');

const AGENT_PATH = require.resolve('../agents/trustAnalysisAgent');
const { UNREAD } = require(AGENT_PATH);

const ASOF = Date.parse('2026-10-12T07:30:00Z');
const RECENT = '2026-10-10T08:00:00Z';
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
const outlets = (n, side) => Array.from({ length: n }, (_, k) => ({
  source: `Outlet ${side} ${WORDS[k]}`, title: `${WORDS[k]} ${side} report`, description: '',
  url: `https://${side}-${WORDS[k]}.test/`, reliability: 8, publishedAt: RECENT, reported: side === 'for' ? 'confirms' : 'otherwise'
}));
const CLAIM = 'Narendra Modi resigned as Prime Minister.';
const REVIEW = { publisher: 'Factly', rating: 'False', claimReviewed: 'the claim', url: 'https://factly.test/r', via: 'claimreview' };
const PREMISE_AGAINST = { entity: 'Narendra Modi', articleStates: 'resigned', referenceStates: 'is Prime Minister', reference: { title: 'Narendra Modi', url: 'https://en.wikipedia.org/wiki/Narendra_Modi' } };
const PREMISE_FOR = { entity: 'Narendra Modi', referenceStates: 'Narendra Modi is Prime Minister', reference: { title: 'Narendra Modi', url: 'https://en.wikipedia.org/wiki/Narendra_Modi' } };

// What each channel returns when it ran and found nothing to report.
const NOTHING = {
  verification: (input) => ({ ...input, verificationStatus: 'unverified',
    claims: input.claims.map(c => ({ ...c, verdict: 'unverified', supportingEvidence: [], contradictingEvidence: [] })) }),
  premises: (input) => ({ ...input, premiseResult: { status: 'consistent', contradictions: [], confirmations: [] } }),
  factChecks: (input) => ({ ...input, factCheckResult: { status: 'none', matches: [] } }),
  currentCoverage: (input) => ({ ...input, currentCoverageResult: { status: 'silent', subject: 'Narendra Modi', headlinesRead: 30, outletsRead: 12, presupposingFalse: [] } }),
  transparency: (input) => ({ ...input, transparencyResult: { score: 8 } }),
  manipulation: (input) => ({ ...input, manipulationResult: { techniques: [] } })
};
// The same channel, not read in time.
const UNREAD_INPUT = {
  verification: (input) => {
    const v = UNREAD.verification(input.claims);
    return { ...input, verificationStatus: v.status, claims: v.claims };
  },
  premises: (input) => ({ ...input, premiseResult: UNREAD.premises() }),
  factChecks: (input) => ({ ...input, factCheckResult: UNREAD.factChecks() }),
  currentCoverage: (input) => ({ ...input, currentCoverageResult: UNREAD.currentCoverage() }),
  transparency: (input) => ({ ...input, transparencyResult: UNREAD.writing() }),
  manipulation: (input) => ({ ...input, manipulationResult: UNREAD.writing() })
};

const grid = [];
for (const time of ['now', 'past']) {
  for (const forN of [0, 1, 2]) {
    for (const againstN of [0, 1, 2]) {
      for (const factCheck of ['none', 'debunked', 'confirmed']) {
        for (const premise of ['consistent', 'contradicted', 'confirmed']) {
          for (const week of ['silent', 'presupposed-false']) {
            for (const risky of [false, true]) {
              grid.push({
                label: `${time} for=${forN} against=${againstN} factcheck=${factCheck} premise=${premise} week=${week} risky=${risky}`,
                input: {
                  claims: [{ claim: CLAIM, verdict: 'x', time, kind: time === 'past' ? 'standing_fact' : 'event',
                    supportingEvidence: outlets(forN, 'for'), contradictingEvidence: outlets(againstN, 'against') }],
                  verificationStatus: forN || againstN ? 'checked' : 'unverified',
                  premiseResult: { status: premise === 'contradicted' ? 'contradicted' : 'consistent',
                    contradictions: premise === 'contradicted' ? [PREMISE_AGAINST] : [], confirmations: premise === 'confirmed' ? [PREMISE_FOR] : [] },
                  factCheckResult: factCheck === 'none' ? { status: 'none', matches: [] }
                    : { status: factCheck, matches: [{ ...REVIEW, finding: factCheck === 'debunked' ? 'false' : 'true' }] },
                  currentCoverageResult: { status: week, subject: 'Narendra Modi', headlinesRead: 30, outletsRead: 12,
                    presupposingFalse: week === 'presupposed-false' ? outlets(2, 'week') : [] },
                  unconfirmedClaimResult: null,
                  sourceResult: { matched: false, score: 5, impersonates: null, type: null },
                  transparencyResult: { score: risky ? 2 : 8 },
                  manipulationResult: { techniques: risky ? [{ technique: 'fear' }, { technique: 'urgency' }] : [] },
                  title: CLAIM, publishedAt: null, domainAge: null, indexLagHours: 3, asOf: ASOF
                }
              });
            }
          }
        }
      }
    }
  }
}

// Through the same compaction the claim memory stores, so a stored check with
// an unread channel replays to the verdict it was given.
const verdict = (input) => replayVerdict(compactLedgerInput(input));

for (const channel of ['premises', 'factChecks', 'currentCoverage', 'transparency', 'manipulation']) {
  test(`an unread ${channel} channel decides exactly as one that found nothing (${grid.length} combinations)`, () => {
    const differ = [];
    for (const { label, input } of grid) {
      const nothing = verdict(NOTHING[channel](input));
      const unread = verdict(UNREAD_INPUT[channel](input));
      if (unread.call !== nothing.call || unread.rule !== nothing.rule) differ.push(`${label}: ${nothing.call}/${nothing.rule} vs unread ${unread.call}/${unread.rule}`);
    }
    assert.deepStrictEqual(differ, []);
  });
}

test(`an unread news search never yields a verdict the other channels did not give (${grid.length} combinations)`, () => {
  const broken = [];
  for (const { label, input } of grid) {
    const nothing = verdict(NOTHING.verification(input));
    const unread = verdict(UNREAD_INPUT.verification(input));
    // Either the other channels settle it as before (a fact-checker's ruling,
    // a reference entry), or the answer is that it could not be checked. An
    // unrun search must not count as "nobody reports this", which the rules
    // may weigh as a warning sign.
    if (unread.call !== nothing.call && unread.call !== 'CANNOT VERIFY') broken.push(`${label}: ${nothing.call} vs unread ${unread.call}/${unread.rule}`);
    if (unread.rule === 'uncorroborated-high-impact-with-risk-signals' || unread.rule === 'contradicted-by-current-coverage' || unread.rule === 'absent-from-heavy-coverage') {
      broken.push(`${label}: an unrun search was read as silence (${unread.rule})`);
    }
  }
  assert.deepStrictEqual(broken, []);
});

/* ---------------------------------------------------------------------------
   End to end, with every channel stubbed
--------------------------------------------------------------------------- */

const STUBBED = {
  clickbait: '../agents/clickbaitAgent',
  bias: '../agents/biasAgent',
  manipulation: '../agents/manipulationAgent',
  transparency: '../agents/transparencyAgent',
  verification: '../agents/claimVerificationAgent',
  premises: '../agents/referenceCheck',
  factChecks: '../agents/factCheckSearch',
  currentCoverage: '../agents/currentCoverage'
};
const never = () => new Promise(() => {});

/** The orchestrator over stubbed channels; `over` replaces any channel. */
const loadAgent = (over = {}) => {
  const calls = Object.fromEntries(Object.keys(STUBBED).map(k => [k, []]));
  const answer = (name, value) => (...args) => { calls[name].push(args); return over[name] ? over[name](...args) : Promise.resolve(value(...args)); };
  const exportsFor = {
    clickbait: { analyzeClickbait: answer('clickbait', () => ({ score: 9, isClickbait: false, signals: [], explanation: 'Plain headline.' })) },
    bias: { analyzeBias: answer('bias', () => ({ score: 9, biasLevel: 'low', politicalLean: 'none-detected', flaggedSentences: [], explanation: 'Neutral.' })) },
    manipulation: { detectManipulation: answer('manipulation', () => ({ score: 9, techniques: [], intensity: 'none', summary: '' })) },
    transparency: { assessTransparency: answer('transparency', () => ({ score: 7, level: 'some', checks: [], summary: 'Some sourcing.' })) },
    verification: {
      verifyClaims: answer('verification', (title, text, source, claims) => ({
        score: 8, status: 'corroborated', explanation: 'Reported elsewhere.',
        claims: claims.map(c => ({ claim: c.claim, time: c.time || null, kind: c.kind || null, verdict: 'supported',
          supportingEvidence: outlets(2, 'for'), contradictingEvidence: [], explanation: '' }))
      })),
      extractClaims: async () => []
    },
    premises: { checkPremises: answer('premises', () => ({ status: 'consistent', checked: [], contradictions: [], confirmations: [], explanation: 'Nothing contradicted.' })) },
    factChecks: { checkFactCheckers: answer('factChecks', () => ({ status: 'none', matches: [], considered: 0, explanation: 'No review.' })) },
    currentCoverage: { checkCurrentCoverage: answer('currentCoverage', () => ({ status: 'silent', presupposingFalse: [], reporting: [], explanation: 'Silent.' })) }
  };
  const saved = {};
  for (const [name, rel] of Object.entries(STUBBED)) {
    const p = require.resolve(rel);
    saved[p] = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsFor[name] };
  }
  delete require.cache[AGENT_PATH];
  const agent = require(AGENT_PATH);
  return {
    agent,
    calls,
    restore: () => {
      for (const [p, mod] of Object.entries(saved)) { if (mod) require.cache[p] = mod; else delete require.cache[p]; }
      delete require.cache[AGENT_PATH];
    }
  };
};

const MESSAGE = { title: 'Coimbatore police seized drugs in a special drive', content: 'Coimbatore district police seized drugs, gutkha and weapons in a special drive.', source: 'Pasted text', modality: 'text', textCoverage: 'full' };
const PREPARED = [{ claim: 'Coimbatore district police seized drugs, gutkha and weapons in a special drive.', time: 'now', kind: 'event', subject: 'Coimbatore police' }];
const stable = (report) => { const { timings, analyzedAt, ...rest } = report; return JSON.parse(JSON.stringify(rest)); };

test('a channel that never answers is reported unread at the deadline and changes nothing else', async () => {
  const reference = loadAgent();
  let expected;
  try {
    expected = await reference.agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED });
  } finally {
    reference.restore();
  }
  const { agent, restore } = loadAgent({ premises: never });
  try {
    const started = Date.now();
    const report = await agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED, deadlineMs: 150 });
    assert.ok(Date.now() - started < 1000, `answered after ${Date.now() - started} ms`);
    assert.deepStrictEqual(report.unreadChannels, ['premises']);
    assert.strictEqual(report.premiseCheck.status, 'error');
    assert.strictEqual(report.call, expected.call);
    assert.strictEqual(report.decision.rule, expected.decision.rule);
  } finally {
    restore();
  }
});

test('with every channel silent the answer still comes, and says it could not check', async () => {
  const { agent, restore } = loadAgent(Object.fromEntries(Object.keys(STUBBED).map(k => [k, never])));
  const events = [];
  try {
    const report = await agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED, deadlineMs: 150, onChannel: (e) => events.push(e) });
    assert.strictEqual(report.call, 'CANNOT VERIFY');
    assert.strictEqual(report.decision.rule, 'verification-unavailable');
    assert.deepStrictEqual([...report.unreadChannels].sort(),
      ['bias', 'clickbait', 'currentCoverage', 'factChecks', 'manipulation', 'premises', 'transparency', 'verification']);
    // The claim is still on the record, as a claim that could not be checked.
    assert.deepStrictEqual(report.evidence.perClaim.map(c => c.claim), [PREPARED[0].claim]);
    // No score, not a score of 0: nothing is said about the writing.
    for (const id of ['clickbait', 'bias', 'manipulation', 'transparency']) {
      const factor = report.factors.find(f => f.id === id);
      assert.strictEqual(factor.score, null, id);
      assert.match(factor.standDownReason, /in time/);
    }
    assert.strictEqual(report.quality, null);
    assert.ok(!report.concernPoints.some(p => /names no sources|unnamed authority/.test(p)), report.concernPoints.join(' | '));
    assert.ok(events.filter(e => e.unread).every(e => /in time/.test(e.summary)));
  } finally {
    restore();
  }
});

test('without a deadline a slow channel is waited for, as re-checks need', async () => {
  const late = () => new Promise(resolve => setTimeout(() => resolve({ status: 'consistent', checked: [], contradictions: [], confirmations: [], explanation: 'late' }), 200));
  const { agent, restore } = loadAgent({ premises: late });
  try {
    const report = await agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED });
    assert.deepStrictEqual(report.unreadChannels, []);
    assert.strictEqual(report.premiseCheck.status, 'consistent');
  } finally {
    restore();
  }
});

test('checks started before the claims are known are the ones used, and give the same report', async () => {
  const plain = loadAgent();
  let expected;
  try {
    expected = await plain.agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED });
  } finally {
    plain.restore();
  }
  const { agent, calls, restore } = loadAgent();
  try {
    const early = agent.startMessageChecks(MESSAGE);
    // Started at once, before any claim exists.
    for (const name of ['clickbait', 'bias', 'manipulation', 'transparency', 'premises']) assert.strictEqual(calls[name].length, 1, name);
    assert.deepStrictEqual(calls.premises[0], [MESSAGE.title, MESSAGE.content]);
    const report = await agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED, early });
    // And not run a second time.
    for (const name of ['clickbait', 'bias', 'manipulation', 'transparency', 'premises']) assert.strictEqual(calls[name].length, 1, name);
    assert.deepStrictEqual(stable(report), stable(expected));
  } finally {
    restore();
  }
});

test('a message read in another language has its reference check run on the English rendering', async () => {
  const { agent, calls, restore } = loadAgent();
  try {
    const tamil = { ...MESSAGE, title: 'கோவை போலீஸ் போதைப்பொருள் பறிமுதல்', content: 'கோவை மாவட்ட போலீஸ் போதைப்பொருள், குட்கா, ஆயுதங்களை பறிமுதல் செய்தது.' };
    const early = agent.startMessageChecks(tamil);
    const english = 'Coimbatore district police seized drugs, gutkha and weapons.';
    await agent.analyzeTrust({ ...tamil, preparedClaims: PREPARED, evidenceText: english, early });
    assert.strictEqual(calls.premises.length, 2);
    // The third argument is the subjects for a general fact; none here.
    assert.deepStrictEqual(calls.premises[1].slice(0, 2), [english.slice(0, 140), english]);
  } finally {
    restore();
  }
});

test('work started for different text is never used', async () => {
  const { agent, calls, restore } = loadAgent();
  try {
    const early = agent.startMessageChecks({ title: 'Something else', content: 'Something else entirely.' });
    await agent.analyzeTrust({ ...MESSAGE, preparedClaims: PREPARED, early });
    assert.strictEqual(calls.clickbait.length, 2);
    assert.deepStrictEqual(calls.clickbait[1][0], MESSAGE.title);
  } finally {
    restore();
  }
});
