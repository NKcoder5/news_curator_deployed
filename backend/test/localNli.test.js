const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nli = require('../services/localNli');

// The model files live in ml/artifacts (not in git), so most of this suite proves the service's
// behaviour when the model is missing or broken -- what CI and a fresh clone see -- and one test
// runs the real model when it is installed.
const { labelOrder, softmax, padBatch, encodePair } = nli._internals;

const withModelDir = async (dir, fn) => {
  const before = process.env.LOCAL_NLI_MODEL_DIR;
  const warn = console.warn;
  process.env.LOCAL_NLI_MODEL_DIR = dir;
  console.warn = () => {};
  nli.reset();
  try {
    return await fn();
  } finally {
    console.warn = warn;
    if (before === undefined) delete process.env.LOCAL_NLI_MODEL_DIR;
    else process.env.LOCAL_NLI_MODEL_DIR = before;
    nli.reset();
  }
};

test('with no model installed every call answers null and none throws', async () => {
  await withModelDir(path.join(os.tmpdir(), 'pure-press-no-such-nli-model'), async () => {
    assert.strictEqual(nli.isAvailable(), false);
    assert.strictEqual(await nli.judgePair('West Indies beat India.', 'India beat West Indies.'), null);
    assert.deepStrictEqual(await nli.judgePairs([{ premise: 'a', hypothesis: 'b' }, {}, null]), [null, null, null]);
    assert.deepStrictEqual(await nli.judgePairs([]), []);
  });
});

test('a directory holding a broken model also answers null, once, without throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-press-bad-nli-'));
  try {
    fs.mkdirSync(path.join(dir, 'onnx'));
    for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) fs.writeFileSync(path.join(dir, f), '{}');
    fs.writeFileSync(path.join(dir, 'onnx', 'model_quantized.onnx'), 'not a model');
    await withModelDir(dir, async () => {
      assert.strictEqual(nli.isAvailable(), true);
      assert.strictEqual(await nli.judgePair('some premise', 'some claim'), null);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the label order is read from the model config, whatever order it was trained in', () => {
  assert.deepStrictEqual(labelOrder({ 0: 'entailment', 1: 'neutral', 2: 'contradiction' }), [0, 1, 2]);
  assert.deepStrictEqual(labelOrder({ 0: 'CONTRADICTION', 1: 'ENTAILMENT', 2: 'NEUTRAL' }), [1, 2, 0]);
  assert.strictEqual(labelOrder({ 0: 'LABEL_0', 1: 'LABEL_1', 2: 'LABEL_2' }), null);
  assert.strictEqual(labelOrder(undefined), null);
});

test('softmax gives probabilities that sum to one and survive large logits', () => {
  const p = softmax([1000, 999, 0]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
});

test('batches are right-padded with a mask that is zero over the padding', () => {
  const { ids, mask, width } = padBatch([[0, 5, 6, 2], [0, 7, 2]], 1);
  assert.strictEqual(width, 4);
  assert.deepStrictEqual(Array.from(ids), [0n, 5n, 6n, 2n, 0n, 7n, 2n, 1n]);
  assert.deepStrictEqual(Array.from(mask), [1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n]);
});

test('a premise that is too long is shortened and the claim is kept whole', () => {
  // One token per character, plus three for the separators: enough to exercise the cut.
  const tokenizer = { encode: (premise, { text_pair: claim }) => ({ ids: Array.from({ length: premise.length + claim.length + 3 }, (_, i) => i) }) };
  const claim = 'India won 84 medals at the Asian Games.';
  const ids = encodePair(tokenizer, 'x'.repeat(1500), claim);
  assert.ok(ids.length <= 160, `${ids.length} tokens`);
  assert.ok(ids.length > claim.length, 'the premise was not cut away entirely');
  assert.strictEqual(encodePair(tokenizer, 'short premise', claim).length, 'short premise'.length + claim.length + 3);
});

const hasRuntime = () => {
  try {
    require.resolve('onnxruntime-node');
    require.resolve('@huggingface/tokenizers');
    return true;
  } catch {
    return false;
  }
};
const modelPresent = nli.isAvailable() && hasRuntime();

test('the installed model tells support, silence and contradiction apart', { skip: !modelPresent && 'model files or runtime not installed' }, async () => {
  nli.reset();
  const pairs = [
    { premise: 'Nana Patekar passed away in Goa.', hypothesis: 'Nana Patekar died in Goa.' },
    { premise: 'West Indies beat India in the second T20I in Ranchi.', hypothesis: 'India beat West Indies in the second T20I in Ranchi.' },
    { premise: 'India finished the 2026 Asian Games with 85 medals.', hypothesis: 'India won 84 medals at the 2026 Asian Games.' },
    { premise: 'Nana Patekar (1 January 1951 – 8 October 2026) was an Indian actor.', hypothesis: 'Nana Patekar died in Goa.' },
    { premise: 'Heavy rain lashes Chennai.', hypothesis: 'India won 84 medals at the 2026 Asian Games.' },
    { premise: '', hypothesis: 'An empty premise cannot be judged.' },
  ];
  const out = await nli.judgePairs(pairs);
  assert.strictEqual(out.length, pairs.length);
  assert.strictEqual(out[0].label, 'entailment');
  assert.strictEqual(out[1].label, 'contradiction');
  assert.strictEqual(out[2].label, 'contradiction');
  assert.notStrictEqual(out[3].label, 'contradiction', 'an entry that gives only the death date does not contradict "died in Goa"');
  assert.strictEqual(out[4].label, 'neutral');
  assert.strictEqual(out[5], null);
  for (const r of out.slice(0, 5)) {
    const sum = r.scores.entailment + r.scores.neutral + r.scores.contradiction;
    assert.ok(Math.abs(sum - 1) < 1e-4, `scores sum to ${sum}`);
  }
  // The same pair alone and inside a batch gets the same answer.
  const alone = await nli.judgePair(pairs[1].premise, pairs[1].hypothesis);
  assert.strictEqual(alone.label, out[1].label);
  assert.ok(Math.abs(alone.scores.contradiction - out[1].scores.contradiction) < 1e-3);
});

// A deploy is built from the backend folder alone, and training exports to ml/artifacts, which git ignores:
// the model the server uses must be the copy shipped inside backend/.
test('the server uses the model shipped inside backend/, and /ready can say it runs', { skip: !hasRuntime() && 'runtime not installed' }, async () => {
  const before = process.env.LOCAL_NLI_MODEL_DIR;
  delete process.env.LOCAL_NLI_MODEL_DIR;
  try {
    nli.reset();
    assert.strictEqual(path.resolve(nli.modelDir()), path.join(__dirname, '..', 'models', 'minilm-l12-onnx-int8'));
    assert.strictEqual(nli.isAvailable(), true, 'backend/models/minilm-l12-onnx-int8 is missing its files');
    assert.strictEqual(nli.status().state, 'not loaded');
    const s = await nli.warmUp();
    assert.strictEqual(s.state, 'ready');
    assert.strictEqual(s.source, 'shipped');
    assert.strictEqual(s.selfTest.passed, true, `self-test answered ${s.selfTest.label}`);
    assert.ok(!JSON.stringify(s).includes(path.sep + 'models'), 'no file path in a public status');
  } finally {
    if (before !== undefined) process.env.LOCAL_NLI_MODEL_DIR = before;
    nli.reset();
  }
});

test('a model directory without its files is reported missing, not ready', () => {
  const before = process.env.LOCAL_NLI_MODEL_DIR;
  process.env.LOCAL_NLI_MODEL_DIR = path.join(os.tmpdir(), 'no-such-model-dir');
  try {
    nli.reset();
    assert.strictEqual(nli.status().state, 'missing');
    assert.strictEqual(nli.status().source, 'configured');
  } finally {
    if (before === undefined) delete process.env.LOCAL_NLI_MODEL_DIR; else process.env.LOCAL_NLI_MODEL_DIR = before;
    nli.reset();
  }
});
