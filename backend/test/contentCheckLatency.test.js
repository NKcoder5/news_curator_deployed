// What a reader's check waits for.
//
// Profiled on 12 Oct (scripts/profileCheck.js), a check ran its parts one
// after another that did not depend on one another: the writing and reference
// checks waited for the message to be read, the claim memory was looked up
// and written between the verdict and the reader, and the same message sent
// again minutes later was checked from scratch. These tests pin the order
// down with every stage stubbed and timed, so a change that puts any of it
// back on the reader's time fails here rather than on the page.
const test = require('node:test');
const assert = require('node:assert');

const CHECK_PATH = require.resolve('../services/contentCheck');
const STUBS = {
  understanding: require.resolve('../agents/inputUnderstanding'),
  trust: require.resolve('../agents/trustAnalysisAgent'),
  memory: require.resolve('../services/claimMemory'),
  translation: require.resolve('../agents/verdictTranslation'),
  explainer: require.resolve('../services/decisionExplainer')
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CLAIM = 'India won 84 medals at the Asian Games 2026.';

/**
 * Load the check over stubbed stages. `o` sets how long each takes, and
 * what the memory says; `log` records when each stage started and ended.
 */
const load = (o = {}) => {
  const opts = { understandMs: 20, evidenceMs: 50, lookupMs: 10, writeMs: 10, current: [1], report: {}, ...o };
  const t0 = Date.now();
  const log = [];
  const at = (event, extra = {}) => log.push({ event, t: Date.now() - t0, ...extra });
  const exportsFor = {
    understanding: {
      understandInput: async (text) => {
        at('understand:start');
        await sleep(opts.understandMs);
        at('understand:end');
        return { language: 'en', languageName: 'English', romanized: false, speechAct: 'assertion', tone: 'neutral', english: text,
          checkableClaims: [{ claim: CLAIM, time: 'past', kind: 'figure' }], claims: [{ claim: CLAIM, checkable: true }] };
      }
    },
    trust: {
      startMessageChecks: (article) => { at('early', { article }); return { marker: 'early', ...article }; },
      analyzeTrust: async (args) => {
        at('evidence:start', { args });
        await sleep(opts.evidenceMs);
        args.onLedgerInput({ claims: [{ claim: CLAIM }], asOf: Date.now() });
        at('evidence:end');
        return { call: 'FAKE', oneLine: 'Outlets report 85.', decision: { rule: 'contradicted-by-multiple-independent-sources' },
          unreadChannels: [], degradedFactors: [], factChecks: { status: 'none' }, currentCoverage: { status: 'silent' }, premiseCheck: { status: 'consistent' },
          ...opts.report };
      }
    },
    memory: {
      ENGINE_VERSION: 'engine-1',
      lookupClaims: async ({ claims }) => {
        at('lookup:start', { claims });
        await sleep(opts.lookupMs);
        at('lookup:end');
        return { claims, entries: [] };
      },
      prepareRecord: (plan) => {
        at('prepare');
        return {
          memory: { assessmentId: 'a1', claims: [{ claimId: 'r1', claim: CLAIM, timesSeen: 1, previous: null, variants: [] }], changeReason: null },
          write: async () => { at('write:start'); await sleep(opts.writeMs); at('write:end'); },
          recordIds: ['r1'],
          assessmentId: 'a1'
        };
      },
      stillCurrent: async () => { at('stillCurrent'); return opts.current; },
      noteSeenAgain: async () => { at('seenAgain'); }
    },
    translation: { translateVerdict: async () => null },
    explainer: { explainDecision: () => null }
  };
  const saved = {};
  for (const [name, p] of Object.entries(STUBS)) {
    saved[p] = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsFor[name] };
  }
  delete require.cache[CHECK_PATH];
  const { runContentCheck, recordsSettled } = require(CHECK_PATH);
  return {
    check: (text, hooks) => runContentCheck({ text }, hooks),
    settled: recordsSettled,
    log,
    first: (event) => log.find(e => e.event === event),
    count: (event) => log.filter(e => e.event === event).length,
    restore: () => {
      for (const [p, mod] of Object.entries(saved)) { if (mod) require.cache[p] = mod; else delete require.cache[p]; }
      delete require.cache[CHECK_PATH];
    }
  };
};

const MESSAGE = 'India won 84 medals at the Asian Games 2026, a record haul';

test('the answer does not wait for the claim memory to be written', async () => {
  const s = load({ writeMs: 400 });
  try {
    const started = Date.now();
    const result = await s.check(MESSAGE);
    assert.ok(Date.now() - started < 300, `answered after ${Date.now() - started} ms`);
    assert.strictEqual(result.memory.claims[0].timesSeen, 1, 'the page still gets what the memory knew');
    assert.strictEqual(s.count('write:end'), 0);
    await s.settled();
    assert.strictEqual(s.count('write:end'), 1, 'and the check is filed all the same, which a script can wait for');
  } finally {
    s.restore();
  }
});

test('the claim memory is looked up beside the evidence, not after it', async () => {
  const s = load({ evidenceMs: 200, lookupMs: 200 });
  try {
    const started = Date.now();
    await s.check(MESSAGE);
    assert.ok(Date.now() - started < 380, `took ${Date.now() - started} ms; one after the other would take over 400`);
    assert.deepStrictEqual(s.first('lookup:start').claims, [CLAIM]);
    assert.ok(s.first('lookup:start').t <= s.first('evidence:start').t + 5);
  } finally {
    s.restore();
  }
});

test('the message-only checks start before the message has been read, and are handed to the evidence step', async () => {
  const s = load({ understandMs: 100 });
  try {
    await s.check(MESSAGE);
    assert.ok(s.first('early').t < s.first('understand:end').t);
    const handed = s.first('evidence:start').args.early;
    assert.strictEqual(handed.marker, 'early');
    assert.strictEqual(handed.title, s.first('evidence:start').args.title);
    assert.strictEqual(handed.content, s.first('evidence:start').args.content);
  } finally {
    s.restore();
  }
});

test('a lookup still out after the verdict does not hold the answer, and the check is filed when it lands', async () => {
  const s = load({ lookupMs: 2200 });
  try {
    const started = Date.now();
    const result = await s.check(MESSAGE);
    const took = Date.now() - started;
    assert.ok(took >= 1400 && took < 2000, `answered after ${took} ms`);
    assert.strictEqual(result.memory, null);
    await sleep(900);
    assert.strictEqual(s.count('write:end'), 1);
  } finally {
    s.restore();
  }
});

test('a reader\'s check gives the evidence a deadline; a re-check waits for everything', async () => {
  const s = load();
  try {
    await s.check(MESSAGE);
    await s.check('Some other message about the Asian Games 2026 medals', { trigger: 'recheck' });
    const calls = s.log.filter(e => e.event === 'evidence:start');
    assert.strictEqual(calls[0].args.deadlineMs, 15000);
    assert.strictEqual(calls[1].args.deadlineMs, null);
  } finally {
    s.restore();
  }
});

test('the same message minutes later is answered from that check, marked cached with its age', async () => {
  const s = load({ current: [3] });
  try {
    const first = await s.check(MESSAGE);
    assert.strictEqual(first.cached, false);
    await sleep(50);   // the write lands
    const stages = [];
    const started = Date.now();
    const again = await s.check(MESSAGE, { onStage: (e) => stages.push(e.id) });
    assert.ok(Date.now() - started < 50, 'answered without running the check again');
    assert.strictEqual(again.cached, true);
    assert.ok(again.ageSeconds >= 0 && again.ageSeconds < 5);
    assert.ok(!Number.isNaN(Date.parse(again.checkedAt)));
    assert.strictEqual(again.call, first.call);
    assert.strictEqual(again.decision.rule, first.decision.rule);
    assert.strictEqual(again.memory.claims[0].timesSeen, 4, 'counted as seen once more');
    assert.deepStrictEqual(stages, ['cached']);
    assert.strictEqual(s.count('understand:start'), 1);
    assert.strictEqual(s.count('evidence:start'), 1);
    assert.strictEqual(s.count('seenAgain'), 1);
    // Spacing is not a different message; capitals are, because the writing
    // checks read them as shouting.
    assert.strictEqual((await s.check(`  ${MESSAGE.replace(/ /g, '  ')}  `)).cached, true);
    assert.strictEqual((await s.check(MESSAGE.toUpperCase())).cached, false);
  } finally {
    s.restore();
  }
});

test('nothing is served from an earlier check to a different message', async () => {
  const s = load();
  try {
    await s.check(MESSAGE);
    await sleep(50);
    assert.strictEqual((await s.check(`${MESSAGE}!!! forward to everyone`)).cached, false);
    assert.strictEqual(s.count('evidence:start'), 2);
  } finally {
    s.restore();
  }
});

// The consistency suite sends one claim in four phrasings back to back, and a
// re-check exists to see fresh evidence: served from the cache, both would
// measure the cache instead of the system.
test('an evaluation check and a re-check always run in full, even right after a reader\'s check of the same message', async () => {
  const s = load();
  try {
    await s.check(MESSAGE);
    await sleep(50);
    for (const trigger of ['eval', 'eval', 'recheck', 'recheck']) {
      const result = await s.check(MESSAGE, { trigger });
      assert.strictEqual(result.cached, false, trigger);
      await sleep(50);
    }
    assert.strictEqual(s.count('understand:start'), 5);
    assert.strictEqual(s.count('evidence:start'), 5);
    assert.strictEqual(s.count('stillCurrent'), 0, 'the cache is not even consulted');
    // Nor do they leave anything a reader would then be served.
    const t = load();
    try {
      await t.check(MESSAGE, { trigger: 'eval' });
      await t.check(MESSAGE, { trigger: 'recheck' });
      await sleep(50);
      assert.strictEqual((await t.check(MESSAGE)).cached, false);
    } finally {
      t.restore();
    }
  } finally {
    s.restore();
  }
});

test('nothing is served once a later check of the claim is filed, or after twenty minutes', async () => {
  const later = load({ current: null });
  try {
    await later.check(MESSAGE);
    await sleep(50);
    assert.strictEqual((await later.check(MESSAGE)).cached, false, 'the claim has a newer verdict');
  } finally {
    later.restore();
  }
  const old = load();
  const realNow = Date.now;
  try {
    await old.check(MESSAGE);
    await sleep(50);
    const base = realNow();
    Date.now = () => base + 20 * 60 * 1000 + 1;
    assert.strictEqual((await old.check(MESSAGE)).cached, false, 'twenty minutes is the limit for claims about now');
  } finally {
    Date.now = realNow;
    old.restore();
  }
});

test('an incomplete check is never served again', async () => {
  for (const report of [{ unreadChannels: ['premises'] }, { degradedFactors: ['bias'] }, { factChecks: { status: 'error' } },
    { decision: { rule: 'verification-unavailable' } }]) {
    const s = load({ report });
    try {
      await s.check(MESSAGE);
      await sleep(50);
      assert.strictEqual((await s.check(MESSAGE)).cached, false, JSON.stringify(report));
    } finally {
      s.restore();
    }
  }
});

// 26 Oct: with the connection dropping, one check waited 390 s for the message to be read while the
// gateway walked every model. The reading now has a limit, and past it the check goes on without it.
test('a reading that does not come back in time is not waited for', async () => {
  const saved = process.env.READING_DEADLINE_MS;
  process.env.READING_DEADLINE_MS = '150';
  const s = load({ understandMs: 5000 });
  try {
    const started = Date.now();
    await s.check(MESSAGE);
    assert.ok(Date.now() - started < 1500, `waited ${Date.now() - started} ms for the reading`);
    assert.ok(s.first('evidence:start'), 'the evidence step ran without the reading');
    // Read from the message's own sentences: a late reading means the models are slow, and another
    // model call to extract the claims would only queue behind them.
    const claims = s.first('evidence:start').args.preparedClaims;
    assert.ok(Array.isArray(claims) && claims.length === 1 && claims[0].readWithoutModel, 'the claims were read from the sentences');
    assert.match(claims[0].claim, /India won 84 medals/);
  } finally {
    if (saved === undefined) delete process.env.READING_DEADLINE_MS; else process.env.READING_DEADLINE_MS = saved;
    s.restore();
  }
});

test('a message refused only because it could not be read says so', async () => {
  const saved = process.env.READING_DEADLINE_MS;
  process.env.READING_DEADLINE_MS = '100';
  const s = load({ understandMs: 3000 });
  try {
    await assert.rejects(() => s.check('Many workers no longer pay income tax because of tax bracket changes.'), (err) => {
      assert.strictEqual(err.status, 422);
      assert.strictEqual(err.payload.readingFailed, true);
      assert.match(err.payload.error, /could not be read just now/);
      return true;
    });
  } finally {
    if (saved === undefined) delete process.env.READING_DEADLINE_MS; else process.env.READING_DEADLINE_MS = saved;
    s.restore();
  }
});
