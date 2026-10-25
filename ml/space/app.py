"""Our own pair model, served for the backend (backend/services/localNli.js, OWN_MODEL_URL).

POST /pairs {"pairs": [{"premise": ..., "hypothesis": ...}, ...]} -> {"model": ..., "results": [{"label", "scores"} | null]}

Tokenisation and truncation follow the backend's own client exactly (encodePair in services/localNli.js): at most
160 tokens, the premise shortened in proportion to the excess and the claim kept whole, so a pair reads the same
here as on the server's CPU. The Space is private: the Hugging Face gateway admits only requests carrying a token.
"""
import json
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from tokenizers import Tokenizer

MODEL = Path(os.environ.get("MODEL_DIR") or Path(__file__).parent / "model")
MAX_TOKENS, MAX_PREMISE_CHARS, MAX_HYPOTHESIS_CHARS, BATCH_SIZE, MAX_PAIRS = 160, 2000, 500, 16, 96
LABELS = ["entailment", "neutral", "contradiction"]

config = json.loads((MODEL / "config.json").read_text(encoding="utf-8"))
order = [next(int(i) for i, v in config["id2label"].items() if str(v).lower().startswith(name[:3])) for name in LABELS]
pad_id = config.get("pad_token_id", 0) or 0
tokenizer = Tokenizer.from_file(str(MODEL / "tokenizer.json"))
tokenizer.no_truncation()
tokenizer.no_padding()
options = ort.SessionOptions()
options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
options.intra_op_num_threads = 2
session = ort.InferenceSession(str(MODEL / "onnx" / "model_quantized.onnx"), options, providers=["CPUExecutionProvider"])
NAME = (MODEL / "NAME").read_text(encoding="utf-8").strip() if (MODEL / "NAME").exists() else "own pair model"

app = FastAPI()


class Pair(BaseModel):
    premise: str = ""
    hypothesis: str = ""


class Request(BaseModel):
    pairs: list[Pair]


def encode(premise, hypothesis):
    text, claim = premise[:MAX_PREMISE_CHARS], hypothesis[:MAX_HYPOTHESIS_CHARS]
    for _ in range(8):
        ids = tokenizer.encode(text, claim).ids
        if len(ids) <= MAX_TOKENS:
            return ids
        text = text[:max(10, (len(text) * (MAX_TOKENS - 4)) // len(ids))]
    return None


@app.get("/")
def health():
    return {"ok": True, "model": NAME}


@app.post("/pairs")
def pairs(req: Request):
    if len(req.pairs) > MAX_PAIRS:
        raise HTTPException(413, f"at most {MAX_PAIRS} pairs per request")
    results = [None] * len(req.pairs)
    jobs = []
    for i, p in enumerate(req.pairs):
        premise, hypothesis = p.premise.strip(), p.hypothesis.strip()
        if premise and hypothesis:
            ids = encode(premise, hypothesis)
            if ids:
                jobs.append((i, ids))
    jobs.sort(key=lambda j: len(j[1]))
    for start in range(0, len(jobs), BATCH_SIZE):
        chunk = jobs[start:start + BATCH_SIZE]
        width = max(len(ids) for _, ids in chunk)
        ids = np.full((len(chunk), width), pad_id, dtype=np.int64)
        mask = np.zeros((len(chunk), width), dtype=np.int64)
        for r, (_, row) in enumerate(chunk):
            ids[r, :len(row)] = row
            mask[r, :len(row)] = 1
        logits = session.run(["logits"], {"input_ids": ids, "attention_mask": mask})[0]
        for r, (index, _) in enumerate(chunk):
            z = logits[r] - logits[r].max()
            p = np.exp(z) / np.exp(z).sum()
            scores = {name: float(p[order[k]]) for k, name in enumerate(LABELS)}
            results[index] = {"label": max(scores, key=scores.get), "scores": scores}
    return {"model": NAME, "results": results}
