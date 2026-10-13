"""CPU latency and memory of an ONNX model, per pair, on real pairs from the claim-matching and synthetic sets.

  bench_onnx.py --model <dir with tokenizer/config> --onnx <file.onnx> --data ml/data [--threads 1,2,4]
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import onnxruntime as ort  # noqa: E402
import psutil  # noqa: E402
from transformers import AutoConfig, AutoTokenizer  # noqa: E402

from nli_common import label_map, load, predict_onnx  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--onnx", required=True)
ap.add_argument("--data", required=True)
ap.add_argument("--threads", default="1,2,4")
ap.add_argument("--out", default=None)
a = ap.parse_args()

tok = AutoTokenizer.from_pretrained(a.model)
order = label_map(AutoConfig.from_pretrained(a.model).id2label)
rows = load(Path(a.data) / "eval_claims.jsonl")[:60] + load(Path(a.data) / "eval_synth_seen.jsonl")[:60]
proc = psutil.Process()
result = {"onnx_mb": round(Path(a.onnx).stat().st_size / 2**20, 1), "pairs": len(rows)}
for threads in (int(t) for t in a.threads.split(",")):
    before = proc.memory_info().rss
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    session = ort.InferenceSession(a.onnx, opts, providers=["CPUExecutionProvider"])
    predict_onnx(session, tok, rows[:4], order, bs=1)  # warm-up
    single = []
    for r in rows:
        t = time.perf_counter()
        predict_onnx(session, tok, [r], order, bs=1)
        single.append((time.perf_counter() - t) * 1000)
    t = time.perf_counter()
    predict_onnx(session, tok, rows, order, bs=16)
    batched = (time.perf_counter() - t) * 1000 / len(rows)
    result[f"threads_{threads}"] = {
        "single_pair_ms_median": round(statistics.median(single), 1),
        "single_pair_ms_p95": round(sorted(single)[int(len(single) * .95) - 1], 1),
        "batched_ms_per_pair": round(batched, 1),
        "rss_growth_mb": round((proc.memory_info().rss - before) / 2**20)}
    print(threads, "threads", result[f"threads_{threads}"], flush=True)
    del session
print(json.dumps(result))
if a.out:
    Path(a.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
