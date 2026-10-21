// backend/eval/liveCheck.js
//
// What every live evaluation script shares: run one message through the same
// service the page uses, score the answer, notice when the model quota has run
// out, and keep results case by case so a run the quota stopped resumes where
// it stopped instead of starting again.
//
// Four outcomes, because they are not equally bad. A verdict the other way
// misleads; declining to answer only fails to help.
//   right   — the expected answer
//   safe    — an answer listed as acceptable for that case
//   missed  — an abstention or refusal where a verdict was due
//   wrong   — a verdict, and the wrong one
const fs = require('fs');
const path = require('path');
const { runContentCheck } = require('../services/contentCheck');
const { currentContext } = require('../utils/runContext');
const routing = require('../data/taskRouting.json');

const ABSTENTIONS = new Set(['CANNOT VERIFY', 'REFUSED', 'NOT A FACTUAL CLAIM', 'ERROR']);
const RESULTS = path.join(__dirname, 'results');

const outcomeOf = (c, call) => {
  if (call === c.expected) return 'right';
  if ((c.alsoAcceptable || []).includes(call)) return 'safe';
  if (ABSTENTIONS.has(call)) return 'missed';
  return 'wrong';
};

// The judgements whose route leads with Gemini (data/taskRouting.json). When
// one of them was answered by another provider, Gemini was out of quota or
// rate limited, and the answer measures the quota rather than the system:
// "a 429 sends judgements to a weaker fallback model" (benchmarkCheckAnything.js).
const GEMINI_LED = new Set(Object.entries(routing.tasks || {})
  .filter(([, task]) => (task.chain || [])[0] === 'gemini').map(([label]) => label));

// EVAL_HOSTED=off measures the system with every hosted model switched off (run with GEMINI_API_KEY,
// GEMINI_EXTRA_KEYS, NIM_API_KEY and OLLAMA_HOST empty): our own model answering a step Gemini usually
// takes is then what is being measured, not a degraded run.
const HOSTED_OFF = process.env.EVAL_HOSTED === 'off';
const degradedLabels = (calls) => HOSTED_OFF ? [] : [...new Set(calls
  .filter(c => !c.cached && GEMINI_LED.has(c.label) && c.provider && c.provider !== 'gemini')
  .map(c => c.label))];

const summariseCalls = (calls) => {
  const byProvider = {};
  for (const c of calls) {
    const key = c.cached ? 'cached' : (c.provider || 'unknown');
    byProvider[key] = (byProvider[key] || 0) + 1;
  }
  return { total: calls.length, byProvider };
};

/**
 * One message through Check Anything, exactly as the page sends it.
 * @returns {Promise<Object>} the call, rule, confidence, what the reading step
 *   understood, what the claim memory returned, timing, and which providers
 *   answered the model calls (degraded: the Gemini-led judgements that were not
 *   answered by Gemini)
 */
const checkMessage = async (input, { isUrl = false, trigger = 'eval' } = {}) => {
  const started = Date.now();
  // The check runs in its own context (utils/runContext.js), which records
  // every model call. Its first stage event is heard inside that context, so
  // the record can be held and read once the check is over.
  let context = null;
  const onStage = () => { if (!context) context = currentContext(); };
  let call; let detail = ''; let rule = null; let confidence = null; let kind = null; let readAs = null; let memory = null;
  try {
    const report = await runContentCheck(isUrl ? { url: input } : { text: input }, { onStage, trigger });
    call = report.call;
    detail = report.oneLine || '';
    rule = report.decision?.rule || null;
    confidence = report.decision?.confidence ?? null;
    readAs = report.understanding || null;
    memory = report.memory || null;
  } catch (err) {
    if (err.status && err.status < 500 && err.payload) {
      call = 'REFUSED';
      detail = err.payload.error || '';
      kind = err.payload.kind || null;
    } else {
      call = 'ERROR';
      detail = err.message;
    }
  }
  const calls = context?.calls || [];
  return {
    call, rule, confidence, kind, detail, readAs, memory,
    seconds: (Date.now() - started) / 1000,
    modelCalls: summariseCalls(calls),
    degraded: degradedLabels(calls)
  };
};

/**
 * Stops a run once the quota has gone: after `limit` cases in a row that
 * errored or were answered by fallback providers. What was done is kept, and
 * the run resumes from there once the quota resets.
 */
const quotaGuard = (limit = 2) => {
  let streak = 0;
  return {
    note: (row) => {
      streak = row.call === 'ERROR' || row.degraded.length ? streak + 1 : 0;
      return streak >= limit;
    }
  };
};

// Exit code for "stopped early, run again to resume" (EX_TEMPFAIL).
const EXIT_RESUMABLE = 75;

const resultsFile = (name) => path.join(RESULTS, name);

/** Rows from an earlier, interrupted run that measured the system and can be kept. */
const keptRows = (file) => {
  if (!fs.existsSync(file)) return [];
  const { rows = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return rows.filter(r => r.call !== 'ERROR' && !(r.degraded || []).length);
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

const quantile = (values, q) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
};

const pause = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

module.exports = {
  ABSTENTIONS, outcomeOf, checkMessage, degradedLabels, quotaGuard, EXIT_RESUMABLE,
  resultsFile, keptRows, writeJson, median, quantile, pause, GEMINI_LED
};
