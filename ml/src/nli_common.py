"""Shared helpers: data loading, batching, prediction (PyTorch or ONNX Runtime) and the metrics we report.

Labels: 0 entailment, 1 neutral, 2 contradiction. The headline error of this project is the
false contradiction: a pair that is not a contradiction being called one, because that is what
turns a true claim into a FAKE verdict.
"""
import json
import time

import numpy as np

ENT, NEU, CON = 0, 1, 2
NAMES = ["entailment", "neutral", "contradiction"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def label_map(id2label):
    """Position of entailment / neutral / contradiction in a model's output, from its config."""
    out = {}
    for i, name in id2label.items():
        key = str(name).lower()
        for target, prefix in ((ENT, "ent"), (NEU, "neu"), (CON, "con")):
            if key.startswith(prefix):
                out[target] = int(i)
    assert sorted(out) == [0, 1, 2], f"unrecognised labels {id2label}"
    return [out[ENT], out[NEU], out[CON]]


def half_dtype():
    """bf16 where the GPU has it (RTX 30-series and later, Colab's L4/A100); fp16 on older cards such as Colab's T4."""
    import torch
    return torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16


def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def batches_by_length(lengths, bs):
    order = np.argsort(lengths)
    return [order[i:i + bs] for i in range(0, len(order), bs)]


def predict_torch(model, tok, rows, order, bs=128, max_len=160, device="cuda"):
    """Probabilities in (entailment, neutral, contradiction) order."""
    import torch

    enc = tok([r["premise"] for r in rows], [r["hypothesis"] for r in rows], truncation=True, max_length=max_len)
    ids = enc["input_ids"]
    probs = np.zeros((len(rows), 3), dtype=np.float32)
    model.eval()
    with torch.no_grad():
        for idx in batches_by_length([len(x) for x in ids], bs):
            batch = tok.pad({k: [enc[k][i] for i in idx] for k in enc.keys()}, return_tensors="pt").to(device)
            with torch.autocast(device_type="cuda", dtype=half_dtype(), enabled=device == "cuda"):
                logits = model(**batch).logits.float().cpu().numpy()
            if not np.isfinite(logits).all():  # fp16 overflow: this batch again in full precision
                logits = model(**batch).logits.float().cpu().numpy()
            probs[idx] = softmax(logits)[:, order]
    return probs


def predict_onnx(session, tok, rows, order, bs=32, max_len=160):
    enc = tok([r["premise"] for r in rows], [r["hypothesis"] for r in rows], truncation=True, max_length=max_len)
    ids = enc["input_ids"]
    wanted = {i.name for i in session.get_inputs()}
    probs = np.zeros((len(rows), 3), dtype=np.float32)
    for idx in batches_by_length([len(x) for x in ids], bs):
        batch = tok.pad({k: [enc[k][i] for i in idx] for k in enc.keys()}, return_tensors="np")
        feed = {k: v.astype(np.int64) for k, v in batch.items() if k in wanted}
        probs[idx] = softmax(session.run(None, feed)[0])[:, order]
    return probs


def decide(probs, con_threshold=None):
    """argmax; with a threshold, contradiction needs probability >= threshold (otherwise the better of the other two)."""
    pred = probs.argmax(axis=1)
    if con_threshold is not None:
        weak = (pred == CON) & (probs[:, CON] < con_threshold)
        pred = np.where(weak, np.where(probs[:, ENT] >= probs[:, NEU], ENT, NEU), pred)
    return pred


def metrics(gold, pred):
    from sklearn.metrics import f1_score

    gold, pred = np.asarray(gold), np.asarray(pred)
    n = len(gold)
    non_con = gold != CON
    out = {"n": int(n), "accuracy": round(float((gold == pred).mean()), 4),
           "macro_f1": round(float(f1_score(gold, pred, labels=sorted(set(gold)), average="macro", zero_division=0)), 4)}
    if non_con.any():
        out["false_contradiction"] = round(float((pred[non_con] == CON).mean()), 4)  # not-a-contradiction called one
    if (gold == ENT).any():
        out["false_contradiction_on_true"] = round(float((pred[gold == ENT] == CON).mean()), 4)  # supporting pair called one
    if (gold != ENT).any():
        out["false_entailment"] = round(float((pred[gold != ENT] == ENT).mean()), 4)
    if (gold == CON).any():
        out["contradiction_recall"] = round(float((pred[gold == CON] == CON).mean()), 4)
    return out


def report(rows, probs, con_threshold=None, breakdown=("cat", "sub")):
    gold = np.array([r["label"] for r in rows])
    pred = decide(probs, con_threshold)
    result = {"overall": metrics(gold, pred)}
    for key in breakdown:
        groups = {}
        for i, r in enumerate(rows):
            if r.get(key):
                groups.setdefault(r[key], []).append(i)
        if len(groups) > 1 or (key == "cat" and groups):
            result["by_" + key] = {g: metrics(gold[ix], pred[ix]) for g, ix in sorted(groups.items())}
    return result


class Timer:
    def __enter__(self):
        self.t = time.time()
        return self

    def __exit__(self, *a):
        self.seconds = time.time() - self.t


def load_tokenizer(path):
    """AutoTokenizer, or tokenizer.json alone when the saved config names a class this transformers release
    cannot build (the shipped export was saved by an earlier transformers 5 release)."""
    from pathlib import Path
    from transformers import AutoTokenizer, PreTrainedTokenizerFast
    try:
        return AutoTokenizer.from_pretrained(path)
    except (ValueError, OSError, AttributeError):
        config_file = Path(path) / "tokenizer_config.json"
        config = json.loads(config_file.read_text(encoding="utf-8")) if config_file.exists() else {}
        special = {k: config[k] for k in ("bos_token", "eos_token", "unk_token", "sep_token", "pad_token", "cls_token", "mask_token")
                   if isinstance(config.get(k), str)}
        return PreTrainedTokenizerFast(tokenizer_file=str(Path(path) / "tokenizer.json"), **special)
