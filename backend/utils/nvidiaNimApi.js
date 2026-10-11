const {
  resolveProviderChain,
  isRetired, isOverloaded, isRateLimited, isAuthFailure, isConnectionFailure
} = require('./llmProviders');

// Provider endpoints, model lists and error classification all live in
// llmProviders.js. This file is the gateway around them: one request gate, one
// retry policy, one JSON extractor, shared by every agent.

// Whichever model each provider last answered on, so a dead primary is not
// re-tested on every single call. Keyed by provider name.
const activeModel = {};

/* ---------------------------------------------------------------------------
   Request gate
   ---------------------------------------------------------------------------
   A single trust analysis fires seven-plus prompts. Sending them all at once
   trips the hosted tier's rate limit, and every rejected call silently became a
   neutral 5 in the reader's report — the analysis looked complete but half of
   it had not run. So calls queue here, a few at a time, and a rate-limited call
   waits and retries rather than degrading.
--------------------------------------------------------------------------- */

// Each provider's limit comes from llmProviders.js: NIM degrades when pushed and
// stays at two, Gemini does not and runs six, Ollama two.
const MAX_RATE_LIMIT_RETRIES = 3;


// Slots are held per provider. With one shared queue, a 10-second premise check
// on NVIDIA NIM held the only slot while the local model, which answers in about
// a second, sat idle; an analysis took the sum of every call. Now each provider
// queues only its own calls, so hosted and local work overlap.
const OVERRIDE = Number(process.env.LLM_MAX_CONCURRENT || process.env.NIM_MAX_CONCURRENT);
const providerSlots = new Map();
console.log(`LLM gateway: concurrency per provider (${OVERRIDE > 0 ? OVERRIDE : 'Ollama 2, NIM 2, Gemini 6'}).`);

const slotsFor = (provider) => {
  if (!providerSlots.has(provider.name)) {
    const max = Number.isFinite(OVERRIDE) && OVERRIDE > 0 ? OVERRIDE : (provider.concurrency || 2);
    providerSlots.set(provider.name, { inFlight: 0, waiting: [], max });
  }
  return providerSlots.get(provider.name);
};

const acquireSlot = (provider) =>
  new Promise((resolve) => {
    const s = slotsFor(provider);
    if (s.inFlight < s.max) {
      s.inFlight++;
      resolve();
    } else {
      s.waiting.push(resolve);
    }
  });

const releaseSlot = (provider) => {
  const s = slotsFor(provider);
  const next = s.waiting.shift();
  if (next) next();          // hand the slot straight to the next caller
  else s.inFlight--;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a prompt to the language model.
 *
 * Despite the file name this is provider-agnostic: it walks the providers
 * configured in llmProviders.js (NVIDIA NIM by default, Google Gemini as an
 * alternative), and within each provider walks that provider's model list.
 * The name is kept so the twelve agents that import it do not all have to
 * change at once.
 *
 * Order of escalation for a failing call:
 *   1. rate limited / busy  -> wait and retry the SAME model
 *   2. retired (404/410)    -> next model for this provider, permanently
 *   3. out of models        -> next provider
 *
 * @param {string} prompt
 * @param {Object} options - maxTokens, temperature, topP
 * @returns {Promise<string>} the reply text
 */
const callNimApi = async (prompt, options = {}) => {
  // The caller's label doubles as the routing key: which provider leads for
  // this task is a measured property of the task (see data/taskRouting.json),
  // not a global setting.
  const providers = resolveProviderChain(options.label);
  if (!providers.length) {
    throw new Error(
      'No language model provider is configured. Set NIM_API_KEY (or GEMINI_API_KEY) in your backend .env file.'
    );
  }

  const request = {
    prompt,
    maxTokens: options.maxTokens || 512,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    topP: options.topP || 1.0,
    timeout: 90000,
    // Passed to the provider so it can constrain decoding to JSON rather than
    // relying on the prompt to discourage prose.
    json: Boolean(options.json)
  };

  {
    let lastError;

    for (const provider of providers) {
      // Prefer whichever model this provider last answered on.
      const preferred = activeModel[provider.name] || provider.models[0];
      const models = [preferred, ...provider.models.filter(m => m !== preferred)];
      let preferredRetired = false;

      for (const model of models) {
        for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
          try {
            await acquireSlot(provider);
            let text;
            try {
              text = await provider.send({ ...request, model });
            } finally {
              releaseSlot(provider);
            }
            // Only adopt a different model permanently when the previous one is
            // actually gone. A backup used during a passing overload must not
            // demote a healthy primary for the rest of the process.
            if (model !== preferred && preferredRetired) {
              console.warn(`${provider.label}: switched to "${model}" (previous model retired).`);
              activeModel[provider.name] = model;
            }
            if (provider !== providers[0]) {
              console.warn(`${provider.label} answered after ${providers[0].label} could not.`);
            }
            return text;
          } catch (error) {
            lastError = error;
            const status = error.response?.status;

            if (isAuthFailure(status)) {
              // Never retried, and never silently swallowed: a bad key must be
              // fixed, not worked around.
              console.error(`${provider.label}: credentials rejected (${status}).`);
              break;
            }

            // Busy or rate limited: wait and try the same model again. Honour
            // the server's Retry-After when it sends one, else 1s, 2s, 4s.
            if ((isRateLimited(status) || isOverloaded(status)) && attempt < MAX_RATE_LIMIT_RETRIES) {
              const retryAfter = Number(error.response?.headers?.['retry-after']);
              const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : 1000 * Math.pow(2, attempt);
              console.warn(`${provider.label}: ${isRateLimited(status) ? 'rate limited' : 'model busy'}, retrying in ${waitMs}ms (attempt ${attempt + 1}).`);
              await sleep(waitMs);
              continue;
            }

            if (isRetired(status)) {
              console.error(`${provider.label}: model "${model}" is retired (${status}) — trying the next one.`);
              if (model === preferred) preferredRetired = true;
              break;
            }

            if (isOverloaded(status)) {
              console.error(`${provider.label}: model "${model}" still busy after retries — trying the next one.`);
              break;
            }

            if (isConnectionFailure(error.code)) {
              console.error(`${provider.label}: model "${model}" connection failed (${error.code}) — trying the next one.`);
              break;
            }

            console.error(`${provider.label} error:`, status || error.code || error.message);
            break;
          }
        }
      }
      if (providers.length > 1) {
        console.warn(`${provider.label} exhausted; falling through to the next provider.`);
      }
    }

    throw lastError || new Error('No language model was available.');
  }
};

/**
 * Find the balanced block that opens at `start`, or -1 if it never closes.
 * String contents are skipped so a brace inside a quote cannot fool the scan.
 * @returns {number} index of the closing bracket, or -1
 */
const findBalancedEnd = (text, start) => {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Rescue a reply that was cut off mid-structure.
 *
 * A truncated answer is not a wrong answer — it is a good answer missing its
 * tail. Trimming back to the last element that completed and closing the open
 * brackets keeps the questions, factors or techniques the model did finish,
 * instead of discarding the whole reply and paying for another round trip.
 *
 * @param {string} text - full candidate text
 * @param {number} start - index of the opening bracket
 * @returns {string|null} a balanced JSON string, or null if nothing survives
 */
const salvageTruncated = (text, start) => {
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;   // index just past the last element that closed cleanly

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      // A nested element just finished, so the text up to here is coherent.
      if (stack.length >= 1) lastSafe = i + 1;
    }
  }

  if (!stack.length) return null;          // not truncated after all
  if (lastSafe === -1) return null;         // nothing completed; nothing to keep

  let body = text.slice(start, lastSafe).replace(/,\s*$/, '');
  // Re-derive what is still open in the trimmed text, then close it.
  const open = [];
  inString = false; escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') open.push('}');
    else if (ch === '[') open.push(']');
    else if (ch === '}' || ch === ']') open.pop();
  }
  while (open.length) body += open.pop();
  return body;
};

/**
 * Repair the two malformations these models actually produce.
 * Conservative on purpose: a wrong repair is worse than a clean failure.
 * @param {string} json - text that looked like JSON but would not parse
 * @returns {string} possibly-repaired text
 */
const repairJson = (json) => json
  // Trailing comma before a closing brace or bracket.
  .replace(/,\s*([}\]])/g, '$1')
  // An unquoted string value: `"explanation": The headline is plain,` — quote
  // it up to the next comma or closing brace. Values that are already valid
  // JSON (a quote, object, array, number, true/false/null) are left alone.
  .replace(
    /("(?:[^"\\]|\\.)*"\s*:\s*)(?!\s*["{[\d\-]|\s*(?:true|false|null)\b)([^,}\]\n]+)/g,
    (_m, key, value) => `${key}"${value.trim().replace(/"/g, '\\"')}"`
  );

/**
 * Extract the JSON object or array embedded in a text response.
 * Handles code fences and prose around the JSON.
 *
 * The scan tries every bracket position rather than committing to the first.
 * NewsAPI truncates article bodies with a "[+8026 chars]" marker, and when a
 * model echoes that back the first "[" in the reply belongs to the marker, not
 * to the answer — locking onto it produced "Unexpected token '+'" and threw
 * away a reply that was otherwise perfectly good.
 *
 * @param {string} text - Raw LLM output
 * @returns {Object|Array} - Parsed JSON
 */
const extractJson = (text) => {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Try direct parse first
  try {
    return JSON.parse(candidate.trim());
  } catch (_) { /* fall through */ }

  // If the outermost bracket never closes, the reply was cut off. Salvage it
  // here, before the block scan below — that scan would otherwise find a
  // complete *inner* object (one question out of five) and return that
  // fragment as if it were the whole answer.
  const firstOpen = candidate.search(/[{[]/);
  if (firstOpen !== -1 && findBalancedEnd(candidate, firstOpen) === -1) {
    const salvaged = salvageTruncated(candidate, firstOpen);
    if (salvaged) {
      try {
        const parsed = JSON.parse(salvaged);
        console.warn('NIM: reply was truncated; recovered the complete part.');
        return parsed;
      } catch (_) { /* fall through to the block scan */ }
    }
  }

  // Collect every balanced block, objects first — every prompt here asks for
  // an object, so an array is only a fallback.
  const blocks = [];
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== '{' && candidate[i] !== '[') continue;
    const end = findBalancedEnd(candidate, i);
    if (end === -1) continue;
    blocks.push({ text: candidate.slice(i, end + 1), isObject: candidate[i] === '{' });
    i = end;   // don't rescan the block's own interior
  }

  const ordered = [...blocks.filter(b => b.isObject), ...blocks.filter(b => !b.isObject)];

  for (const block of ordered) {
    try {
      return JSON.parse(block.text);
    } catch (_) { /* try the next one */ }
  }

  // Nothing parsed as-is. Try repairing the most promising block.
  for (const block of ordered) {
    try {
      return JSON.parse(repairJson(block.text));
    } catch (_) { /* try the next one */ }
  }

  if (!blocks.length) throw new Error('No JSON found in LLM response');
  throw new Error('Unbalanced JSON in LLM response');
};

/**
 * Call the NIM API expecting a structured JSON response.
 *
 * Low temperature keeps output deterministic. On a parse failure the call is
 * retried with a larger token budget: "Unbalanced JSON" almost always means the
 * reply was cut off mid-object, and a more verbose model needs more room than
 * the one the prompt was originally sized for.
 *
 * @param {string} prompt - Prompt that instructs the model to answer in JSON
 * @param {Object} options - API options (maxTokens etc.)
 * @returns {Promise<Object|Array>} - Parsed JSON response
 */
/**
 * Does this object carry the keys the caller actually needs?
 *
 * JSON mode stops the model answering in prose; it does not make it answer the
 * question. Asked for {verdict, supporting_indices, contradicting_indices,
 * explanation} over eight pieces of coverage, one model returned the bare
 * array `[1]` — valid JSON, parsed without complaint, and useless. The caller
 * then saw a missing verdict and recorded the check as unrun.
 */
const hasRequiredKeys = (value, requiredKeys, allowArray) => {
  if (!requiredKeys || requiredKeys.length === 0) return true;
  // Some callers ask for a list and are equally happy with `{items: [...]}` or
  // a bare `[...]`; both answer the question. They say so explicitly rather
  // than every caller having to tolerate an array it cannot use.
  if (allowArray && Array.isArray(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return requiredKeys.every(key => value[key] !== undefined);
};

// Judgements asked at temperature 0 are remembered for half an hour.
//
// The same prompt at temperature 0 is meant to get the same answer, so asking
// again only spends quota. It mattered on the benchmark: run back to back, the
// checks drew Gemini's rate limit (429), the judgements fell through to a
// weaker model, and one of them read "Rs 5 crore" and "Rs 50 million" as
// different figures. A demo repeats the same claims, and a repeated check now
// asks no model anything.
const JUDGEMENT_TTL_MS = 30 * 60 * 1000;
const judgementCache = new Map();
const judgementKey = (label, prompt) =>
  `${label}|${require('crypto').createHash('sha1').update(prompt).digest('hex')}`;

const callNimApiJson = async (prompt, options = {}) => {
  const cacheable = options.temperature === 0;
  const key = cacheable ? judgementKey(options.label || 'model call', prompt) : null;
  if (cacheable) {
    const hit = judgementCache.get(key);
    if (hit && Date.now() - hit.at < JUDGEMENT_TTL_MS) return structuredClone(hit.value);
  }
  const value = await callNimApiJsonUncached(prompt, options);
  if (cacheable) {
    judgementCache.set(key, { at: Date.now(), value: structuredClone(value) });
    if (judgementCache.size > 500) judgementCache.delete(judgementCache.keys().next().value);
  }
  return value;
};

const callNimApiJsonUncached = async (prompt, options = {}) => {
  const baseTokens = options.maxTokens || 800;
  const requiredKeys = options.requiredKeys || [];
  const allowArray = Boolean(options.allowArray);
  // Which check is talking. Without it every structured call logs the same
  // anonymous "JSON reply unusable" and there is no way to tell a failing
  // headline check from a failing stance judgement without instrumenting the
  // code again from scratch.
  const label = options.label || 'model call';
  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Second attempt gets ~75% more room in case the first was truncated.
    const jsonOptions = {
      temperature: 0.2,
      ...options,
      // Every caller of this function wants an object back, so every call asks
      // the provider for one. Without it these models answer in prose and run
      // the reply budget out before the JSON: measured on a real stance
      // judgement over eight pieces of coverage, 2,238 characters of
      // step-by-step reasoning and no object, which the pipeline could only
      // report as "the check did not run".
      json: true,
      label,
      maxTokens: attempt === 0 ? baseTokens : Math.round(baseTokens * 1.75)
    };

    // A second attempt is told plainly what was wrong with the first. Repeating
    // the identical prompt and hoping for a different object is not a retry.
    const attemptPrompt = attempt === 0
      ? prompt
      : `${prompt}

Your previous reply was not usable: ${lastError?.message || 'it did not match the format'}. `
        + `Reply with a single JSON object containing exactly these keys: ${requiredKeys.join(', ') || 'as specified above'}. `
        + 'No array, no prose, no explanation outside the object.';

    let text;
    try {
      text = await callNimApi(attemptPrompt, jsonOptions);
    } catch (err) {
      // A transport failure is the caller's to handle; retrying it here would
      // double every outage's cost without improving the odds.
      throw err;
    }

    try {
      const parsed = extractJson(text);
      if (!hasRequiredKeys(parsed, requiredKeys, allowArray)) {
        throw new Error(`reply was JSON but did not contain ${requiredKeys.join(', ')}`);
      }
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`${label}: JSON reply unusable (attempt ${attempt + 1}) — ${err.message}`);
    }
  }
  throw lastError;
};

module.exports = { callNimApi, callNimApiJson, extractJson };
