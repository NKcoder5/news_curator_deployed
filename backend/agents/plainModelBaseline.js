// backend/agents/plainModelBaseline.js
//
// What a language model says about a claim with nothing to read.
//
// This is the "anyone could build it in five minutes" system: paste the claim
// into a chatbot and ask. It exists here only as a comparison, shown beside
// our verdict on request and measured in eval/benchmarkCheckAnything.js. It is
// the same hosted model the pipeline uses, given today's date and no evidence,
// so the difference between its answer and ours is exactly what retrieval,
// fact-check matching and the verdict rules add.
const { PROVIDERS } = require('../utils/llmProviders');
const { extractJson } = require('../utils/nvidiaNimApi');

/**
 * @param {string} claim
 * @returns {Promise<{call: string, reason: string, model: string, ms: number}>}
 *   call: REAL | FAKE | CANNOT VERIFY | ERROR
 */
const askPlainModel = async (claim) => {
  const gemini = PROVIDERS.gemini;
  const model = gemini.models[0];
  const started = Date.now();
  if (!gemini.isConfigured()) {
    return { call: 'ERROR', reason: 'No hosted model is configured.', model, ms: 0 };
  }
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Is the following claim true or false?

"${String(claim).slice(0, 1200)}"

Answer with a JSON object: {"answer": "TRUE" | "FALSE" | "UNSURE", "reason": "<one sentence>"}. Answer UNSURE if you cannot tell.`;
  try {
    const raw = await gemini.send({ model, prompt, maxTokens: 300, temperature: 0, topP: 1, timeout: 30000, json: true });
    const parsed = extractJson(raw);
    const answer = String(parsed?.answer || '').toUpperCase();
    return {
      call: answer === 'TRUE' ? 'REAL' : answer === 'FALSE' ? 'FAKE' : 'CANNOT VERIFY',
      reason: String(parsed?.reason || ''),
      model,
      ms: Date.now() - started
    };
  } catch (err) {
    return { call: 'ERROR', reason: 'The model could not be reached.', model, ms: Date.now() - started };
  }
};

module.exports = { askPlainModel };
