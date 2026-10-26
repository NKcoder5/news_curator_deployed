// backend/utils/llmProviders.js
//
// Where the language model actually lives.
//
// The pipeline was written against NVIDIA NIM, which is free and, until its
// popularity caught up with it, fast. It is now frequently congested: the same
// call has been measured at 2 seconds and at 62 seconds, and 503 "model busy"
// replies are routine. That congestion — not the pipeline, not the prompts — is
// the dominant cost in an analysis.
//
// NIM stays the default: it is the most available option and needs no billing
// account. This module simply stops it being the *only* option, so a second
// provider can take over while NIM is struggling and hand back afterwards.
//
// Adding a provider means adding one entry here. Nothing above this file knows
// which one answered.
const axios = require('axios');

/* -------------------------------------------------------------------------
   Error classification, shared across providers
   ------------------------------------------------------------------------- */

/** Gone for good — switch away permanently. */
const isRetired = (status) => status === 404 || status === 410;

/** Busy right now, not retired — worth waiting before reaching for a backup. */
const isOverloaded = (status) => status === 503 || status === 529;

/** The caller is over its allowance — back off, then retry. */
const isRateLimited = (status) => status === 429;

/** Bad or missing credentials — retrying will never help. */
const isAuthFailure = (status) => status === 401 || status === 403;

/** Connection-level failures (timeout, reset) — worth failing over. */
const isConnectionFailure = (code) =>
  ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);

// HOSTED_AI=off leaves Gemini and NIM out even when their keys are set: every reading is then done by a model
// on hardware the team owns (Ollama) and by our own pair model. One switch, so a demonstration of the system
// without any outside AI does not depend on remembering to blank four keys.
const hostedOff = () => String(process.env.HOSTED_AI || '').trim().toLowerCase() === 'off';

/* -------------------------------------------------------------------------
   NVIDIA NIM — the default
   ------------------------------------------------------------------------- */

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Hosted models get retired. meta/llama-3.1-8b-instruct reached end of life and
// every analysis began failing with HTTP 410, so the model is configurable and
// these backups are tried automatically. Only models that actually respond
// belong on this list.
// Probed 26 Oct 2026, three stance questions each: nemotron-3-super-120b, kimi-k2.6, mistral-large-2 and
// llama-3.1-nemotron-70b answered 404 although /models still lists them; deepseek-v4.1-flash, gemma-4-31b
// and glm-5.3 gave no answer within 30 s. These three answered all three, right, in 1.4-11 s. The old
// first choice was retired, so every fallback to NIM had been timing out on the two backups behind it.
// NIM_MODEL_ONLY=1 keeps to NIM_MODEL_NAME alone, so a measurement of one model is not part another's.
const NIM_MODELS = process.env.NIM_MODEL_ONLY === '1' && process.env.NIM_MODEL_NAME ? [process.env.NIM_MODEL_NAME] : [
  process.env.NIM_MODEL_NAME || 'nvidia/nemotron-3-ultra-550b-a55b',
  'openai/gpt-oss-20b',
  'nvidia/nemotron-3.5-lightning-30b-a3b'
];

const nim = {
  name: 'nim',
  label: 'NVIDIA NIM',
  models: [...new Set(NIM_MODELS)],
  // How many calls this provider tolerates at once. NIM degrades under load:
  // six parallel calls measured *slower* end to end (98s) than two (63s), so it
  // is deliberately kept narrow.
  concurrency: 2,
  hosted: true,
  isConfigured: () => !hostedOff() && Boolean(process.env.NIM_API_KEY),
  missingKeyMessage: 'NIM_API_KEY is not set. Add it to your backend .env file.',

  async send({ model, prompt, maxTokens, temperature, topP, timeout, json }) {
    const response = await axios.post(NIM_URL, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      stream: false,
      // Asking for JSON is not the same as requesting it in the prompt. These
      // models reason in prose first and run out of reply budget before they
      // reach the object: a stance judgement over eight pieces of coverage
      // produced 2,238 characters of "Let's examine each…" and no JSON at all,
      // which the pipeline then had to report as an unrun check. Constrained
      // decoding removes the prose rather than asking the model to skip it.
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      // Nemotron thinks before it answers unless told not to, and the thinking
      // comes out of the same token budget. Measured on 14 Oct on a stance
      // judgement of twelve headlines: thinking on, 368 tokens of reasoning
      // and 16.9 s; on the real, longer prompts it ran out before the JSON,
      // and every fallback that day failed as "Invalid response format".
      // Thinking off: 0 reasoning tokens, a complete reply, 9.1 s.
      ...(/nemotron/i.test(String(model)) ? { chat_template_kwargs: { enable_thinking: false } } : {})
    }, {
      headers: {
        Authorization: `Bearer ${process.env.NIM_API_KEY}`,
        Accept: 'application/json'
      },
      timeout
    });

    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Invalid response format from NVIDIA NIM.');
    return text.trim();
  }
};

/* -------------------------------------------------------------------------
   Google Gemini — the alternative
   ------------------------------------------------------------------------- */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Google retires models while still listing them, exactly as NVIDIA does — the
// 2.5-flash names answer /models but return 404 "no longer available" on a real
// request. Measured on the bias task, three runs each:
//
//     gemini-3.1-flash-lite   3/3 valid   3.0s best
//     gemini-flash-latest     2/3 valid   6.8s best
//     gemini-2.5-flash(-lite) 404, retired
//
// The "-latest" alias is kept as the backup because it follows Google's current
// recommendation and so should outlive any specific version number.
// Each model has its own daily quota on the free tier — measured 2026-10-11:
// gemini-3.1-flash-lite 500 a day, gemini-flash-latest 20 — so listing
// several multiplies what one key can do in a day. A day of benchmarks spent
// the first model's 500 and every judgement fell through to slower providers;
// the gateway now moves to the next model on this list instead, and skips a
// model whose daily quota is spent until it resets (utils/nvidiaNimApi.js).
// Lite models first: they answer in about 1.5 s against 2-9 s for the others.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-flash-latest'
];

// Free-tier quotas are per Google Cloud project, so additional keys from other
// projects — each team member can make one in a minute — add a full day's
// quota for every model. GEMINI_EXTRA_KEYS, GEMINI_EXTRA_KEYS2, GEMINI_EXTRA_KEYS3
// (and any comma-separated keys or numbered GEMINI_EXTRA_KEYS* variables) take
// more keys beside GEMINI_API_KEY. Each key's models appear to the gateway
// as their own entries ("gemini-3.5-flash-lite#1" is that model on the second
// key, "#2" on the third, "#3" on the fourth), so a spent quota on one key moves
// the call to the next key rather than to a slower provider.
// The main key switches Gemini on or off; extra keys only add to it, so a test
// that blanks GEMINI_API_KEY still runs without the hosted model.
const collectExtraKeys = () => {
  const extraVarNames = new Set([
    'GEMINI_EXTRA_KEYS',
    'GEMINI_EXTRA_KEYS2',
    'GEMINI_EXTRA_KEYS3',
    ...Object.keys(process.env).filter(k => /^GEMINI_EXTRA_KEYS?(\d*)$/i.test(k))
  ]);

  const sortedNames = Array.from(extraVarNames).sort((a, b) => {
    const ma = a.match(/\d+$/);
    const mb = b.match(/\d+$/);
    const na = ma ? parseInt(ma[0], 10) : 1;
    const nb = mb ? parseInt(mb[0], 10) : 1;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  return sortedNames
    .flatMap(name => String(process.env[name] || '').split(','))
    .map(k => String(k).trim())
    .filter(Boolean);
};

const geminiKeys = () => (process.env.GEMINI_API_KEY
  ? [process.env.GEMINI_API_KEY.trim(), ...collectExtraKeys()]
  : []).map(k => String(k).trim()).filter(Boolean);
const splitModel = (entry) => {
  const [model, index] = String(entry).split('#');
  return { model, key: geminiKeys()[Number(index) || 0] };
};

const gemini = {
  name: 'gemini',
  label: 'Google Gemini',
  get models() {
    const models = [...new Set(GEMINI_MODELS)];
    // Each model on every key before the next model: the same model judging
    // keeps verdicts consistent. Key by key, a spent quota on the first key
    // handed the stance judgements to a weaker model while the same model
    // still had a full day on the second key — and on 14 Oct that weaker
    // model read four headlines as confirming "RBI cut the repo rate by 50
    // basis points this week", which a rerun on the first model called FAKE.
    return models.flatMap(m => geminiKeys().map((_, k) => (k === 0 ? m : `${m}#${k}`)));
  },
  // Gemini does not degrade the same way. Six identical calls, all valid:
  //     parallelism 2 -> 37.5s wall
  //     parallelism 3 ->  7.9s wall
  //     parallelism 6 ->  9.1s wall
  // Two was throttling the pipeline nearly five-fold. Six lets every factor in
  // an analysis run at once.
  concurrency: 6,
  hosted: true,
  isConfigured: () => !hostedOff() && geminiKeys().length > 0,
  missingKeyMessage:
    'GEMINI_API_KEY is not set. Add it to your backend .env file to use Gemini.',

  async send({ model: entry, prompt, maxTokens, temperature, topP, timeout, json }) {
    const { model, key } = splitModel(entry);
    const response = await axios.post(
      `${GEMINI_BASE}/${model}:generateContent`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          topP,
          // See the note on the NIM provider: constrained decoding, not a
          // politely worded instruction.
          ...(json ? { responseMimeType: 'application/json' } : {})
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          // Header auth, so the key never appears in a URL or a log line.
          'x-goog-api-key': key
        },
        // One attempt waits at most GEMINI_ATTEMPT_MS (15 s), not the gateway's 90: the lite models answer
        // in 1.5-3 s, and when one stalls the check's 45 s evidence deadline passed before the gateway
        // tried the next model. On 25 Oct, 10 of 60 rulings came back "verification unavailable" that
        // way, with 17 attempts on gemini-3.1-flash-lite cut off by the 90 s timeout.
        timeout: Math.min(timeout || 90000, Number(process.env.GEMINI_ATTEMPT_MS) || 15000)
      }
    );

    const candidate = response.data?.candidates?.[0];
    const text = (candidate?.content?.parts || [])
      .map(part => part.text || '')
      .join('')
      .trim();

    if (!text) {
      // A blocked or empty candidate is worth naming precisely; it is not a
      // transport failure and retrying the same prompt will not fix it.
      const reason = candidate?.finishReason
        || response.data?.promptFeedback?.blockReason
        || 'unknown';
      throw new Error(`Gemini returned no text (finish reason: ${reason}).`);
    }
    return text;
  }
};

/* -------------------------------------------------------------------------
   Ollama — a model running on this machine, answering to nobody
   ------------------------------------------------------------------------- */

// Both providers above are somebody else's computer, and both have already
// failed this project: a model was withdrawn mid-development and every analysis
// began returning HTTP 410, and the free tiers rate-limit under ordinary demo
// load. Neither failure was a defect in the pipeline, and neither was fixable
// from inside it.
//
// Ollama removes the dependency. It serves a model over plain HTTP on the local
// machine, with no key, no quota and no vendor able to retire anything. The rest
// of the system does not notice: the gateway exists precisely so that a provider
// is a configuration detail, and nothing above this file knows which one
// answered.
//
// Opt-in on purpose. Without OLLAMA_HOST set, this provider reports itself
// unconfigured and is left out of the chain entirely, so a machine that is not
// running Ollama never waits on a connection that cannot succeed.
//
// The deployed server has no GPU, so it reaches the team's laptop instead: the
// laptop checks in with its tunnel's address, a session token and the model it
// serves (services/modelHost.js, scripts/ownModelServer.js). OLLAMA_HOST, when
// set, wins; OLLAMA_TOKEN is sent with it if the host asks for one.
const modelHost = require('../services/modelHost');

const ollamaTarget = () => {
  const local = String(process.env.OLLAMA_HOST || '').trim().replace(/\/+$/, '');
  if (local) return { host: local, token: process.env.OLLAMA_TOKEN || null, model: null, remote: false };
  const own = modelHost.current();
  return own ? { host: own.url, token: own.token, model: own.model, remote: true } : null;
};

// Models that think before they answer unless told not to. The thinking comes out of the reply budget and
// adds seconds to every judgement, exactly as it did on NIM (see the Nemotron note above), so it is turned off.
const THINKS = /qwen3|deepseek-r1|magistral/i;

// Answers from a tunnel that say the laptop behind it is not there: Cloudflare's 530 (origin unreachable),
// a gateway error, or a token the proxy no longer accepts because the laptop restarted with a new one.
const HOST_GONE = new Set([401, 502, 504, 530]);

const ollama = {
  name: 'ollama',
  label: 'Ollama (own hardware)',
  hosted: false,
  get models() {
    return [...new Set([ollamaTarget()?.model, process.env.OLLAMA_MODEL || 'llama3.1:8b', 'mistral:7b', 'phi3:mini'].filter(Boolean))];
  },
  // One request at a time. A local model is bounded by the GPU in front of it,
  // not by a rate limit, and issuing several at once makes each of them slower
  // without finishing the batch any sooner.
  // Two at a time: the GPU still works one request at a time, but the next
  // prompt is already queued at Ollama instead of waiting on a round trip here.
  concurrency: Number(process.env.OLLAMA_MAX_CONCURRENT) || 2,
  isConfigured: () => Boolean(ollamaTarget()),
  missingKeyMessage:
    'OLLAMA_HOST is not set. Install Ollama, pull a model, then set OLLAMA_HOST=http://localhost:11434 in backend/.env.',

  async send({ model, prompt, maxTokens, temperature, topP, timeout, json }) {
    const target = ollamaTarget();
    if (!target) {
      // The laptop went away between choosing this provider and calling it: fail as a lost connection, so
      // the gateway moves on at once instead of trying each model on a host that is not there.
      throw Object.assign(new Error('The own-hardware model host is not connected.'), { code: 'ECONNRESET' });
    }
    try {
      return await sendToOllama(target, { model, prompt, maxTokens, temperature, topP, timeout, json });
    } catch (error) {
      if (target.remote && (HOST_GONE.has(error.response?.status) || isConnectionFailure(error.code))) modelHost.rest();
      throw error;
    }
  }
};

async function sendToOllama({ host, token }, { model, prompt, maxTokens, temperature, topP, timeout, json }) {
  const response = await axios.post(
    `${host}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      ...(THINKS.test(String(model)) ? { think: false } : {}),
      // How long the model stays loaded after this request. Ollama's default
      // is five minutes, and loading it again costs seconds: profiled on 12
      // Oct, the first two writing checks after a pause took 8.3 s and 9.5 s
      // against 1.4-2.8 s warm, and the check waited for them. Checks
      // arrive minutes apart, so the model is kept for half an hour.
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      // Ollama's name for the same thing.
      ...(json ? { format: 'json' } : {}),
      options: {
        temperature,
        top_p: topP,
        // Ollama's name for the reply budget.
        num_predict: maxTokens
      }
    },
    {
      // A local model on a laptop GPU is slower per token than a hosted one,
      // and the caller's timeout is sized for a hosted service. Give it room
      // rather than cancelling work that would have completed.
      timeout: Math.max(timeout || 0, 120000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    }
  );

  const text = response.data?.response;
  if (!text || !text.trim()) {
    throw new Error('Ollama returned an empty response.');
  }
  return text.trim();
}

/* -------------------------------------------------------------------------
   Selection
   ------------------------------------------------------------------------- */

const PROVIDERS = { nim, gemini, ollama };

/**
 * Resolve the provider order for this process.
 *
 * LLM_PROVIDER accepts:
 *   "nim"            - NIM only (the default, and what a fresh checkout does)
 *   "gemini"         - Gemini only
 *   "gemini,nim"     - a comma-separated preference order; the first configured
 *                      provider leads and the rest are failover targets
 *
 * A provider without its key is dropped from the order rather than failing the
 * process, so setting a preference that is not configured degrades to whatever
 * is.
 *
 * @returns {Array<Object>} providers in the order they should be tried
 */
/**
 * Per-task routing, measured rather than assumed.
 *
 * A local model is not uniformly better or worse than a hosted one: it is
 * free, private and always available, and it is weaker at tasks needing a
 * taxonomy held in mind or several documents compared at once. Which is which
 * is a question with an answer, so eval/benchmarkProviders.js measures every
 * task on every configured provider — valid-JSON rate, agreement with the
 * hosted reference, latency — and writes the table this reads.
 *
 * Absent the table every task uses the configured order, so the system behaves
 * exactly as before until the measurement has been made.
 */
let routingTable = null;
const loadRouting = () => {
  if (routingTable !== null) return routingTable;
  try {
    routingTable = require('../data/taskRouting.json');
  } catch (_) {
    routingTable = { tasks: {} };
  }
  return routingTable;
};

/** Test seam: forget the cached table so a freshly written one is picked up. */
const reloadRouting = () => {
  announcedSource = false;
  delete require.cache[require.resolve('../data/taskRouting.json')];
  routingTable = null;
};

const envOrder = () => String(process.env.LLM_PROVIDER || '')
  .split(',').map(n => n.trim().toLowerCase()).filter(Boolean);

let announcedSource = false;

const orderFor = (task) => {
  // LLM_PROVIDER wins when it is set.
  //
  // It used to lose to the routing table's default, which meant an operator who
  // edited .env to change providers saw no effect and no explanation — the
  // table silently overrode them. A measured table is the better default, but
  // it is a default, and an explicit setting has to beat it or the setting is
  // a lie. Per-task entries still apply within whatever order is chosen, since
  // those encode which provider can actually do the task.
  const explicit = envOrder();
  const table = loadRouting();

  if (!announcedSource) {
    announcedSource = true;
    console.log(explicit.length
      ? `Provider order from LLM_PROVIDER: ${explicit.join(' -> ')} (routing table ignored).`
      : `Provider order from data/taskRouting.json${table.generatedAt ? `, measured ${table.generatedAt.slice(0, 10)}` : ''}.`);
  }

  if (explicit.length) return explicit;

  const entry = task && table.tasks && table.tasks[task];
  if (entry && Array.isArray(entry.chain) && entry.chain.length) return entry.chain;
  if (Array.isArray(table.default) && table.default.length) return table.default;
  return ['nim'];
};

/**
 * @param {string} [task] the caller's task label, e.g. 'clickbait'
 * @returns {Array} providers to try, in order
 */
const resolveProviderChain = (task) => {
  const chain = [];
  for (const name of orderFor(task)) {
    const provider = PROVIDERS[name];
    if (provider && provider.isConfigured() && !chain.includes(provider)) {
      chain.push(provider);
    }
  }

  // Anything configured but not named becomes a failover target, so a second
  // key in .env is useful the moment it is added.
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.isConfigured() && !chain.includes(provider)) chain.push(provider);
  }

  return chain;
};

/**
 * How many model calls to allow at once, given the provider that leads.
 * LLM_MAX_CONCURRENT overrides it; NIM_MAX_CONCURRENT is still honoured so an
 * existing .env keeps working.
 * @returns {number}
 */
const resolveConcurrency = () => {
  const override = Number(process.env.LLM_MAX_CONCURRENT || process.env.NIM_MAX_CONCURRENT);
  if (Number.isFinite(override) && override > 0) return override;
  const [leader] = resolveProviderChain();
  return leader?.concurrency || 2;
};

module.exports = {
  PROVIDERS,
  resolveProviderChain,
  reloadRouting,
  resolveConcurrency,
  isRetired,
  isOverloaded,
  isRateLimited,
  isAuthFailure,
  isConnectionFailure,
  geminiKeys,
  splitModel,
  hostedOff
};
