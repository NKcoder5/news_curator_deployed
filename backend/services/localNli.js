// backend/services/localNli.js
//
// Our own text-pair model: does this premise support, say nothing about, or contradict this claim?
//
// A small multilingual classifier (fine-tuned in ml/, exported to ONNX and quantised to int8) that runs on
// the server's CPU with no external API. It is the replacement for the model calls that judge a pair of
// sentences: a headline's stance toward a claim, whether a fact-check is about the same claim, whether an
// encyclopedia entry contradicts a claim. Nothing in the pipeline calls it yet; this is the service the
// pipeline will use once its verdicts are measured with it (docs/engineering/2026-10-14-own-models.md).
//
// Contract: judgePair(premise, hypothesis) -> { label, scores } or null. It returns null, and never throws,
// when the model is not installed, cannot be loaded, or the input is empty, so a caller always has the
// fallback it had before. The model files are not in git (ml/artifacts is ignored); the directory comes from
// LOCAL_NLI_MODEL_DIR and defaults to ml/artifacts/minilm-l12-onnx-int8.
//
// The model's directory holds what `ml/src/export_onnx.py` writes: config.json, tokenizer.json,
// tokenizer_config.json and onnx/model_quantized.onnx. Tokenisation is done in JavaScript
// (@huggingface/tokenizers, no native code); inference by onnxruntime-node. Both are loaded on first use.

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'minilm-l12-onnx-int8');
// The model was trained on pairs of at most this many tokens; a longer premise is cut, never the claim.
const MAX_TOKENS = 160;
const MAX_PREMISE_CHARS = 2000;
const MAX_HYPOTHESIS_CHARS = 500;
const BATCH_SIZE = 16;
const LABELS = ['entailment', 'neutral', 'contradiction'];

const modelDir = () => process.env.LOCAL_NLI_MODEL_DIR || DEFAULT_DIR;
const modelFile = (dir) => path.join(dir, 'onnx', 'model_quantized.onnx');

/** True when the files the model needs are on disk (says nothing about whether the runtime packages are). */
const isAvailable = () => {
  const dir = modelDir();
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json'].every((f) => fs.existsSync(path.join(dir, f)))
    && fs.existsSync(modelFile(dir));
};

/** Position of entailment / neutral / contradiction in the model's output, read from its config. */
const labelOrder = (id2label) => {
  const order = LABELS.map((name) => {
    const hit = Object.entries(id2label || {}).find(([, v]) => String(v).toLowerCase().startsWith(name.slice(0, 3)));
    return hit ? Number(hit[0]) : -1;
  });
  return order.every((i) => i >= 0) && new Set(order).size === 3 ? order : null;
};

const softmax = (logits) => {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
};

/** Right-pad a batch of id arrays to one length; returns int64 buffers ready for the model. */
const padBatch = (batch, padId) => {
  const width = Math.max(...batch.map((ids) => ids.length));
  const ids = new BigInt64Array(batch.length * width).fill(BigInt(padId));
  const mask = new BigInt64Array(batch.length * width);
  batch.forEach((row, r) => row.forEach((id, c) => {
    ids[r * width + c] = BigInt(id);
    mask[r * width + c] = 1n;
  }));
  return { ids, mask, width };
};

/**
 * Token ids for a (premise, hypothesis) pair, at most MAX_TOKENS long. The premise is shortened in
 * proportion to the excess and the claim is kept whole: the claim is what is being judged.
 */
const encodePair = (tokenizer, premise, hypothesis) => {
  let text = premise.slice(0, MAX_PREMISE_CHARS);
  const claim = hypothesis.slice(0, MAX_HYPOTHESIS_CHARS);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { ids } = tokenizer.encode(text, { text_pair: claim });
    if (ids.length <= MAX_TOKENS) return ids;
    text = text.slice(0, Math.max(10, Math.floor(text.length * (MAX_TOKENS - 4) / ids.length)));
  }
  return null;
};

let loading = null;

const load = async () => {
  const dir = modelDir();
  if (!isAvailable()) return null;
  try {
    const ort = require('onnxruntime-node');
    const { Tokenizer } = require('@huggingface/tokenizers');
    const readJson = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const config = readJson('config.json');
    const order = labelOrder(config.id2label);
    if (!order) throw new Error(`unrecognised labels in ${dir}/config.json`);
    const tokenizer = new Tokenizer(readJson('tokenizer.json'), readJson('tokenizer_config.json'));
    const session = await ort.InferenceSession.create(modelFile(dir), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      // A small server shares its cores with the API; two threads is the most this model can use well.
      intraOpNumThreads: Number(process.env.LOCAL_NLI_THREADS) || 2,
    });
    return { ort, tokenizer, session, order, padId: config.pad_token_id ?? 1 };
  } catch (err) {
    console.warn(`[localNli] model not usable (${err.message}); callers fall back to their previous path`);
    return null;
  }
};

const runtime = () => {
  if (!loading) loading = load();
  return loading;
};

/**
 * Judge many pairs at once. Resolves to an array the same length as `pairs`: a { label, scores } per pair,
 * or null for a pair that could not be judged (and for every pair when the model is unavailable).
 *
 * scores are probabilities { entailment, neutral, contradiction } and sum to 1.
 */
const judgePairs = async (pairs) => {
  const results = new Array(pairs.length).fill(null);
  const rt = await runtime();
  if (!rt) return results;
  const jobs = [];
  pairs.forEach((pair, index) => {
    const premise = typeof pair?.premise === 'string' ? pair.premise.trim() : '';
    const hypothesis = typeof pair?.hypothesis === 'string' ? pair.hypothesis.trim() : '';
    if (!premise || !hypothesis) return;
    try {
      const ids = encodePair(rt.tokenizer, premise, hypothesis);
      if (ids) jobs.push({ index, ids });
    } catch (err) {
      console.warn(`[localNli] could not tokenise a pair (${err.message})`);
    }
  });
  // Similar lengths together: padding is wasted work on a CPU.
  jobs.sort((a, b) => a.ids.length - b.ids.length);
  for (let start = 0; start < jobs.length; start += BATCH_SIZE) {
    const chunk = jobs.slice(start, start + BATCH_SIZE);
    try {
      const { ids, mask, width } = padBatch(chunk.map((j) => j.ids), rt.padId);
      const dims = [chunk.length, width];
      const feeds = { input_ids: new rt.ort.Tensor('int64', ids, dims), attention_mask: new rt.ort.Tensor('int64', mask, dims) };
      const logits = (await rt.session.run(feeds)).logits;
      const classes = logits.dims[1];
      chunk.forEach((job, row) => {
        const raw = Array.from(logits.data.slice(row * classes, (row + 1) * classes));
        const p = softmax(raw);
        const scores = { entailment: p[rt.order[0]], neutral: p[rt.order[1]], contradiction: p[rt.order[2]] };
        const label = LABELS.reduce((best, name) => (scores[name] > scores[best] ? name : best), LABELS[0]);
        results[job.index] = { label, scores };
      });
    } catch (err) {
      console.warn(`[localNli] inference failed for a batch of ${chunk.length} (${err.message})`);
    }
  }
  return results;
};

/** Judge one pair: does `premise` entail, leave open, or contradict the claim `hypothesis`? Null when it cannot say. */
const judgePair = async (premise, hypothesis) => (await judgePairs([{ premise, hypothesis }]))[0];

/** Forget the loaded model (tests point the service at different directories). */
const reset = () => { loading = null; };

module.exports = { judgePair, judgePairs, isAvailable, modelDir, reset, LABELS, _internals: { labelOrder, softmax, padBatch, encodePair } };
