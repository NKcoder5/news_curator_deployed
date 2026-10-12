// backend/utils/runContext.js
//
// What happened during one check, gathered without threading a parameter
// through every agent.
//
// A stored verdict has to say which model made each judgement behind it: the
// gateway rotates through six Gemini models, then NIM, then the local model,
// and the same prompt can be answered by any of them depending on the quota
// that day. Node's AsyncLocalStorage carries a per-check record through every
// await, so the gateway can note each call (task, provider, model, time, or
// that the answer came from the judgement cache) against the check it belongs
// to. Outside a check — tests, the feed, scripts — there is no context and
// nothing is recorded.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** Run `fn` with a fresh record of model calls; returns fn's result. */
const runWithContext = (fn) => storage.run({ calls: [] }, fn);

/** The record for the check in progress, or null. */
const currentContext = () => storage.getStore() || null;

/** Note one model call against the check in progress, if there is one. */
const noteModelCall = (call) => {
  const ctx = storage.getStore();
  if (ctx && Array.isArray(ctx.calls) && ctx.calls.length < 200) ctx.calls.push(call);
};

module.exports = { runWithContext, currentContext, noteModelCall };
