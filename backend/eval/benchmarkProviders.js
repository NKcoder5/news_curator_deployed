/**
 * Which provider should run which task, decided by measurement.
 *
 *     node eval/benchmarkProviders.js            # measure and print
 *     node eval/benchmarkProviders.js --write    # also write data/taskRouting.json
 *     node eval/benchmarkProviders.js --runs 5   # repetitions per task (default 3)
 *
 * A local model is not uniformly better or worse than a hosted one. It is free,
 * private, and available when a quota is not; it is weaker where a task needs a
 * taxonomy held in mind or several documents compared at once. Rather than
 * guess where the line falls, this runs every LLM task in the pipeline against
 * every configured provider on fixed inputs and records three things:
 *
 *   validity   — how often the reply parsed AND carried the keys the caller
 *                cannot proceed without. This is the floor: a provider that
 *                returns prose, or JSON missing its verdict, has not done the
 *                task however fast it did it.
 *   correctness — for tasks with a known right answer, how often it gave that
 *                answer. Validity alone is not capability. The local model
 *                returns perfectly well-formed JSON for the premise check and
 *                the wrong verdict in it: asked whether an article calling
 *                Rahul Gandhi "Prime Minister" conflicts with his encyclopedia
 *                entry, it answers no. Both hosted models answer yes and quote
 *                the line. A task with a correctness case must pass it to be
 *                routed locally, whatever its validity rate.
 *   agreement  — for tasks with a numeric score, how close the provider's
 *                answer is to the hosted reference, on the 0-10 scale the
 *                factors use. Reported as mean absolute difference.
 *   latency    — median milliseconds per call.
 *
 * A task is routed to the local model when it is valid at or above
 * MIN_VALIDITY and, where a score exists, within MAX_SCORE_DRIFT of the
 * reference. Everything else keeps the hosted provider in front. The table it
 * writes carries the measurements beside each decision, so the routing can be
 * read and argued with rather than taken on trust.
 *
 * Nothing here touches the news index, the article reader, Wikipedia or OCR:
 * those are network operations against external services, not model calls, and
 * they are unaffected by which model answers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('../utils/llmProviders');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const RUNS = Number((args[args.indexOf('--runs') + 1]) || 3) || 3;

/** A task is local-eligible at or above this valid-reply rate. */
const MIN_VALIDITY = 0.8;
/** ...and, where the task has a known right answer, this success rate on it. */
const MIN_CORRECTNESS = 0.8;
/** ...and within this mean absolute difference from the hosted reference, on 0-10. */
const MAX_SCORE_DRIFT = 2.0;

// ---------------------------------------------------------------------------
// The tasks, with a fixed input each so every provider is asked the same thing.
// ---------------------------------------------------------------------------

const HEADLINE = 'Council approves riverfront plan after three-hour debate';
const CLICKBAIT_HEADLINE = 'You WON’T BELIEVE what this mayor said next — experts are STUNNED';
const ARTICLE = 'The city council voted 34 to 11 on Tuesday to approve 42 crore rupees for an '
  + 'extension of the cycle lane network, according to minutes published on the council’s website. '
  + 'Council transport secretary Meera Krishnan said construction would begin in January. The '
  + 'opposition group leader, Rakesh Menon, said he had voted against the measure because of '
  + 'concerns about parking.';
const LOADED = 'The corrupt establishment is once again lying to you. Everyone knows the so-called '
  + 'experts are paid off. Wake up before it is too late — share this with everyone you know '
  + 'before they take it down.';

/**
 * Each entry: the agent call, the keys a usable reply must carry, and where to
 * read a 0-10 score from when the task produces one.
 */
const TASKS = [
  {
    name: 'clickbait',
    run: (m) => m.clickbait.analyzeClickbait(CLICKBAIT_HEADLINE),
    score: (r) => r.score
  },
  {
    name: 'bias',
    run: (m) => m.bias.analyzeBias(HEADLINE, LOADED),
    score: (r) => r.score
  },
  {
    name: 'manipulation',
    run: (m) => m.manipulation.detectManipulation(HEADLINE, LOADED),
    score: (r) => r.score
  },
  {
    name: 'transparency',
    run: (m) => m.transparency.assessTransparency(HEADLINE, ARTICLE),
    score: (r) => r.score
  },
  {
    name: 'summary',
    run: (m) => m.summarize(ARTICLE),
    valid: (r) => typeof r === 'string' && r.length > 20
  },
  {
    name: 'detailed summary',
    run: (m) => m.detailedSummary(ARTICLE),
    valid: (r) => typeof r === 'string' && r.length > 20
  },
  {
    name: 'claim extraction',
    run: (m) => m.claims.extractClaims(HEADLINE, ARTICLE, 2, { code: 'en', name: 'English' }),
    valid: (r) => Array.isArray(r) && r.length > 0 && Boolean(r[0].claim && r[0].keywords)
  },
  {
    name: 'premise check',
    run: (m) => m.reference.checkPremises(
      'Prime Minister Rahul Gandhi announces nationwide fuel subsidy',
      'Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday in New Delhi.'),
    valid: (r) => ['consistent', 'contradicted', 'not-found', 'no-entities'].includes(r.status),
    // Rahul Gandhi has never been Prime Minister, and his encyclopedia entry
    // says what he is. A model that reads the entry and reports no conflict has
    // not done this task, however well-formed its reply.
    correct: (r) => r.status === 'contradicted' && (r.contradictions || []).length > 0
  },
  {
    name: 'coverage keywords',
    run: (m) => m.compare.__test
      ? m.compare.__test.deriveKeywords(HEADLINE)
      : Promise.resolve(null),
    valid: (r) => typeof r === 'string' && r.trim().split(/\s+/).length >= 2,
    skipIfUnavailable: true
  },
  {
    name: 'stance judgement',
    run: (m) => m.claims.__test.judgeClaim(
      'The city council approved funding for a cycle lane extension.',
      [
        { source: 'The Hindu', title: 'Council clears cycle lane funding', description: 'Councillors voted 34-11 to approve the extension.', url: 'https://example.com/a' },
        { source: 'Deccan Herald', title: 'Cycle lane plan approved', description: 'The council approved 42 crore for cycle lanes.', url: 'https://example.com/b' }
      ]),
    valid: (r) => ['supported', 'contradicted', 'unverified'].includes(r.verdict),
    // Both retrieved items report the same vote. "supported" is the answer.
    correct: (r) => r.verdict === 'supported'
  }
];

// ---------------------------------------------------------------------------

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Run one task on one provider, with the environment pinned so only that
 * provider can answer. Pinning matters: without it a failing local model would
 * silently fall through to the hosted one and be recorded as a local success.
 */
const measure = async (task, providerName) => {
  const previous = process.env.LLM_PROVIDER;
  const previousOllama = process.env.OLLAMA_HOST;
  process.env.LLM_PROVIDER = providerName;
  if (providerName !== 'ollama') process.env.OLLAMA_HOST = '';

  // The agents cache the gateway, which caches the chain, so both are reloaded.
  for (const id of Object.keys(require.cache)) {
    if (id.includes('agents') || id.includes('utils\\llmProviders') || id.includes('utils/llmProviders')
        || id.includes('nvidiaNimApi')) {
      delete require.cache[id];
    }
  }
  const mods = {
    clickbait: require('../agents/clickbaitAgent'),
    bias: require('../agents/biasAgent'),
    manipulation: require('../agents/manipulationAgent'),
    transparency: require('../agents/transparencyAgent'),
    claims: require('../agents/claimVerificationAgent'),
    summarize: require('../agents/summarizeAgent'),
    detailedSummary: require('../agents/detailedSummaryAgent'),
    reference: require('../agents/referenceCheck'),
    compare: require('../agents/compareCoverageAgent')
  };

  const latencies = [];
  const scores = [];
  let valid = 0;
  let correct = 0;
  let attempted = 0;

  for (let i = 0; i < RUNS; i++) {
    const started = Date.now();
    try {
      const result = await task.run(mods);
      const ms = Date.now() - started;

      // A content factor that fell back to the pattern matcher did not answer.
      const degraded = result && typeof result === 'object' && result.degraded;
      const ok = degraded ? false
        : task.valid ? task.valid(result)
        : typeof task.score(result) === 'number';

      if (ok) {
        valid++;
        latencies.push(ms);
        if (task.score) {
          const value = task.score(result);
          if (typeof value === 'number') scores.push(value);
        }
        if (task.correct) {
          attempted++;
          if (task.correct(result)) correct++;
        }
      }
    } catch (err) {
      // A throw is an invalid reply; the reason is in the gateway's own log.
    }
  }

  process.env.LLM_PROVIDER = previous;
  if (previousOllama !== undefined) process.env.OLLAMA_HOST = previousOllama;

  return {
    validity: Number((valid / RUNS).toFixed(2)),
    correctness: attempted ? Number((correct / attempted).toFixed(2)) : null,
    medianMs: median(latencies),
    meanScore: scores.length ? Number(mean(scores).toFixed(2)) : null,
    runs: RUNS
  };
};

const main = async () => {
  const available = Object.values(PROVIDERS).filter(p => p.isConfigured()).map(p => p.name);
  if (!available.length) {
    console.error('No provider is configured. Set at least one of NIM_API_KEY, GEMINI_API_KEY, OLLAMA_HOST.');
    process.exit(1);
  }

  // The reference is the first configured hosted provider: the one the system
  // used before a local model was available.
  const hosted = available.filter(n => n !== 'ollama');
  const reference = hosted[0] || null;

  console.log(`Providers: ${available.join(', ')}`);
  console.log(`Reference for agreement: ${reference || 'none (no hosted provider configured)'}`);
  console.log(`Runs per task per provider: ${RUNS}\n`);

  const results = {};
  for (const task of TASKS) {
    results[task.name] = {};
    for (const providerName of available) {
      // One complete line per measurement. Writing the prompt first and the
      // result later interleaved them with the gateway's own warnings, which
      // made the console output unreadable and unparseable.
      const measured = await measure(task, providerName);
      results[task.name][providerName] = measured;
      console.log(
        `  RESULT ${task.name.padEnd(18)} ${providerName.padEnd(7)}`
        + ` valid ${String(Math.round(measured.validity * 100)).padStart(3)}%`
        + ` ${(measured.medianMs === null ? '   -  ' : ((measured.medianMs / 1000).toFixed(1) + 's').padStart(6))}`
        + ` ${(measured.meanScore === null ? '   -' : String(measured.meanScore).padStart(5))}`
        + ` ${(measured.correctness === null ? '    -' : (String(Math.round(measured.correctness * 100)) + '%').padStart(5))}`
      );
    }
  }

  // ------------------------------------------------------------- the routing
  const table = {
    generatedAt: new Date().toISOString(),
    method: `${RUNS} runs per task per provider on fixed inputs; a reply counts as valid only `
      + 'when it parses and carries the keys the caller requires, and a content factor that fell '
      + 'back to the pattern matcher counts as invalid.',
    thresholds: { minValidity: MIN_VALIDITY, maxScoreDrift: MAX_SCORE_DRIFT },
    reference,
    localModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    default: available.includes('ollama')
      ? ['ollama', ...hosted]
      : [...hosted],
    tasks: {}
  };

  console.log('\nRouting:');
  for (const task of TASKS) {
    const local = results[task.name].ollama;
    const ref = reference ? results[task.name][reference] : null;

    let drift = null;
    if (local && ref && local.meanScore !== null && ref.meanScore !== null) {
      drift = Number(Math.abs(local.meanScore - ref.meanScore).toFixed(2));
    }

    const localCapable = Boolean(local)
      && local.validity >= MIN_VALIDITY
      && (local.correctness === null || local.correctness >= MIN_CORRECTNESS)
      && (drift === null || drift <= MAX_SCORE_DRIFT);

    const chain = localCapable ? ['ollama', ...hosted] : [...hosted, 'ollama'];
    const why = !local ? 'no local provider configured'
      : local.validity < MIN_VALIDITY
        ? `local valid on ${(local.validity * 100).toFixed(0)}% of replies, below the ${(MIN_VALIDITY * 100)}% gate`
        : local.correctness !== null && local.correctness < MIN_CORRECTNESS
          ? `local returns well-formed replies but got the known answer right `
            + `${(local.correctness * 100).toFixed(0)}% of the time, below the ${(MIN_CORRECTNESS * 100)}% gate`
          : drift !== null && drift > MAX_SCORE_DRIFT
            ? `local scores drift ${drift} from ${reference} on a 0-10 scale, above the ${MAX_SCORE_DRIFT} limit`
            : `local valid on ${(local.validity * 100).toFixed(0)}% of replies`
              + (local.correctness === null ? '' : `, correct on ${(local.correctness * 100).toFixed(0)}%`)
              + (drift === null ? '' : `, within ${drift} of ${reference}`);

    table.tasks[task.name] = { chain, reason: why, measured: results[task.name], scoreDrift: drift };
    console.log(`  ${task.name.padEnd(18)} -> ${chain[0].padEnd(7)}  (${why})`);
  }

  const out = path.join(__dirname, '..', 'data', 'taskRouting.json');

  // Routes set by hand carry `overriddenAt` and a reason recording the live
  // failure that forced them — "TVK sweeps both seats" read as agreeing with
  // "TVK lost". A fixed-input benchmark cannot see that failure, so a rewrite
  // would quietly undo the fix. They are carried over, and named, unless
  // --reset-overrides is given.
  if (!args.includes('--reset-overrides') && fs.existsSync(out)) {
    try {
      const previous = JSON.parse(fs.readFileSync(out, 'utf8'));
      for (const [name, entry] of Object.entries(previous.tasks || {})) {
        if (entry && entry.overriddenAt) {
          table.tasks[name] = { ...entry, measured: results[name] || entry.measured };
          console.log(`  ${name.padEnd(18)} -> ${entry.chain[0].padEnd(7)}  (kept: set by hand on ${entry.overriddenAt})`);
        }
      }
    } catch (_) { /* an unreadable table has nothing to carry over */ }
  }

  if (WRITE) {
    fs.writeFileSync(out, JSON.stringify(table, null, 2));
    console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
  } else {
    console.log('\nNot written. Re-run with --write to install this routing.');
  }

  const localTasks = Object.values(table.tasks).filter(t => t.chain[0] === 'ollama').length;
  console.log(`\nLocal model leads on ${localTasks} of ${TASKS.length} tasks.`);
};

main().catch(err => { console.error(err); process.exit(1); });
