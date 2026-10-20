"""Evaluate a model (PyTorch directory / Hub id, or an ONNX directory) on the evaluation sets.

  evaluate.py --model <dir-or-hub-id> --data ml/data --out result.json [--onnx] [--sets a,b] [--con-threshold 0.7]

Writes a JSON with, per set: overall metrics and, where the rows carry them, a breakdown by category / sub-label.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from nli_common import Timer, label_map, load, predict_onnx, predict_torch, report  # noqa: E402

SETS = ["eval_synth_seen", "eval_synth_unseen", "eval_claims", "eval_blind", "eval_fnc1", "eval_xnli_hi", "eval_indic_ta", "eval_indic_hi",
        "eval_fever", "eval_mnli", "eval_stance"]

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--onnx", default=None, help="path to an .onnx file; --model then supplies tokenizer and config")
ap.add_argument("--sets", default=",".join(SETS))
ap.add_argument("--max-len", type=int, default=160)
ap.add_argument("--con-threshold", type=float, default=None)
ap.add_argument("--limit", type=int, default=None, help="evaluate only the first N rows of each set")
ap.add_argument("--errors", default=None, help="name of one set whose misclassified rows are printed")
a = ap.parse_args()

from transformers import AutoConfig, AutoTokenizer  # noqa: E402

from nli_common import load_tokenizer  # noqa: E402
tok = load_tokenizer(a.model)
order = label_map(AutoConfig.from_pretrained(a.model).id2label)
if a.onnx:
    import onnxruntime as ort

    opts = ort.SessionOptions()
    session = ort.InferenceSession(a.onnx, opts, providers=["CPUExecutionProvider"])
    predict = lambda rows: predict_onnx(session, tok, rows, order, max_len=a.max_len)  # noqa: E731
else:
    import torch
    from transformers import AutoModelForSequenceClassification

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained(a.model, dtype=torch.float32).to(device)
    predict = lambda rows: predict_torch(model, tok, rows, order, max_len=a.max_len, device=device)  # noqa: E731

results = {"model": a.model, "onnx": a.onnx, "con_threshold": a.con_threshold, "sets": {}}
for name in a.sets.split(","):
    if not (Path(a.data) / f"{name}.jsonl").exists():
        print(f"{name}: not built, skipped")
        continue
    rows = load(Path(a.data) / f"{name}.jsonl")[:a.limit]
    with Timer() as t:
        probs = predict(rows)
    if name == a.errors:
        from nli_common import NAMES, decide
        for r, p, y in zip(rows, probs, decide(probs, a.con_threshold)):
            if y != r["label"]:
                print(f"  gold={NAMES[r['label']][:3]} pred={NAMES[y][:3]} p={p.round(2).tolist()}")
                print(f"    P: {r['premise'][:200]}")
                print(f"    H: {r['hypothesis'][:200]}")
    results["sets"][name] = dict(report(rows, probs, a.con_threshold), seconds=round(t.seconds, 1))
    o = results["sets"][name]["overall"]
    print(f"{name:20s} n={o['n']:5d} acc={o['accuracy']:.3f} f1={o['macro_f1']:.3f} "
          f"falseCon={o.get('false_contradiction', float('nan')):.3f} falseEnt={o.get('false_entailment', float('nan')):.3f} "
          f"conRecall={o.get('contradiction_recall', float('nan')):.3f}  ({t.seconds:.0f}s)", flush=True)
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
Path(a.out).write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
