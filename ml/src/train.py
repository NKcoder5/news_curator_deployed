"""Fine-tune a pair classifier (entailment / neutral / contradiction) on ml/data/train.jsonl.

  train.py --model MoritzLaurer/multilingual-MiniLMv2-L12-mnli-xnli --data ml/data --out ml/artifacts/minilm-l12-ft

Plain PyTorch loop: length-grouped batches (padding is most of the cost otherwise), AdamW with linear
warm-up and decay, bf16 autocast (the RTX 50-series supports it, and unlike fp16 it needs no loss scaling
and does not overflow in DeBERTa-style attention). Dev metrics are logged every epoch; the final weights are saved.
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import AutoConfig, AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup  # noqa: E402

from nli_common import half_dtype, label_map, load, metrics, predict_torch  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--epochs", type=float, default=2)
ap.add_argument("--lr", type=float, default=3e-5)
ap.add_argument("--bs", type=int, default=32)
ap.add_argument("--max-len", type=int, default=160)
ap.add_argument("--warmup", type=float, default=0.06)
ap.add_argument("--seed", type=int, default=13)
ap.add_argument("--freeze-embeddings", action="store_true",
                help="keep the word-embedding table at its pre-trained values (192M of mDeBERTa's 278M weights: saves 3 GB of optimiser state)")
ap.add_argument("--limit", type=int, default=None, help="train on the first N pairs only (smoke test)")
a = ap.parse_args()

random.seed(a.seed)
np.random.seed(a.seed)
torch.manual_seed(a.seed)
device = "cuda"
t0 = time.time()

tok = AutoTokenizer.from_pretrained(a.model)
order = label_map(AutoConfig.from_pretrained(a.model).id2label)  # model class index of entail / neutral / contradict
model = AutoModelForSequenceClassification.from_pretrained(a.model, dtype=torch.float32).to(device)  # checkpoints may be stored in fp16
if a.freeze_embeddings:
    model.get_input_embeddings().weight.requires_grad_(False)
train, dev = load(Path(a.data) / "train.jsonl")[:a.limit], load(Path(a.data) / "dev.jsonl")
enc = tok([r["premise"] for r in train], [r["hypothesis"] for r in train], truncation=True, max_length=a.max_len)
ids = enc["input_ids"]
labels = np.array([order[r["label"]] for r in train])
lengths = np.array([len(x) for x in ids])
print(f"{len(train)} pairs, mean {lengths.mean():.0f} tokens, tokenised in {time.time() - t0:.0f}s", flush=True)


def epoch_batches():
    perm = np.random.permutation(len(train))
    mega = a.bs * 50
    out = []
    for i in range(0, len(perm), mega):
        chunk = perm[i:i + mega]
        chunk = chunk[np.argsort(lengths[chunk])]
        out += [chunk[j:j + a.bs] for j in range(0, len(chunk), a.bs)]
    random.shuffle(out)
    return out


steps_per_epoch = (len(train) + a.bs - 1) // a.bs
total = int(steps_per_epoch * a.epochs)
decay = [p for n, p in model.named_parameters() if p.ndim > 1 and p.requires_grad]
no_decay = [p for n, p in model.named_parameters() if p.ndim <= 1 and p.requires_grad]
opt = torch.optim.AdamW([{"params": decay, "weight_decay": 0.01}, {"params": no_decay, "weight_decay": 0.0}], lr=a.lr)
sched = get_linear_schedule_with_warmup(opt, int(total * a.warmup), total)
# bf16 needs no loss scaling; fp16 (Colab's T4 has no bf16) does, or small gradients underflow to zero.
HALF = half_dtype()
scaler = torch.amp.GradScaler("cuda", enabled=HALF == torch.float16)
print(f"autocast {HALF}", flush=True)


def evaluate_dev():
    probs = predict_torch(model, tok, dev, order, max_len=a.max_len, device=device)
    pred = probs.argmax(axis=1)
    gold = np.array([r["label"] for r in dev])
    out = {"overall": metrics(gold, pred)}
    for src in sorted({r["src"] for r in dev}):
        ix = [i for i, r in enumerate(dev) if r["src"] == src]
        out[src] = metrics(gold[ix], pred[ix])
    return out


step, running, t_train, skipped = 0, 0.0, time.time(), 0
done = False
epoch = 0
while not done:
    model.train()
    for idx in epoch_batches():
        batch = tok.pad({k: [enc[k][i] for i in idx] for k in enc.keys()}, return_tensors="pt").to(device)
        y = torch.tensor(labels[idx], device=device)
        with torch.autocast(device_type="cuda", dtype=HALF):
            logits = model(**batch).logits
        loss = torch.nn.functional.cross_entropy(logits.float(), y)
        # fp16 can overflow in DeBERTa-style attention: a batch whose loss is not a number is skipped, and a
        # run where that keeps happening stops rather than training on garbage.
        if not torch.isfinite(loss):
            skipped += 1
            opt.zero_grad(set_to_none=True)
            if skipped > max(20, 0.02 * (step + 1)):
                raise SystemExit(f"{skipped} batches gave a non-finite loss by step {step}: use bf16 or fp32 for this model")
            continue
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        sched.step()
        opt.zero_grad(set_to_none=True)
        step += 1
        running += loss.item()
        if step % 200 == 0:
            el = time.time() - t_train
            print(f"step {step}/{total} loss {running / 200:.4f} lr {sched.get_last_lr()[0]:.2e} "
                  f"{el / 60:.1f} min elapsed, eta {(total - step) * el / step / 60:.1f} min", flush=True)
            running = 0.0
        if step >= total:
            done = True
            break
    epoch += 1
    r = evaluate_dev()
    print(f"== epoch {epoch} dev:", json.dumps({k: {m: v for m, v in x.items() if m in ('accuracy', 'macro_f1', 'false_contradiction')} for k, x in r.items()}), flush=True)
    # Saved every epoch: a long run on a shared GPU can be cut off before its last.
    model.save_pretrained(a.out)
    tok.save_pretrained(a.out)
    print(f"saved epoch {epoch} to {a.out} ({skipped} batches skipped so far)", flush=True)

Path(a.out).mkdir(parents=True, exist_ok=True)
model.save_pretrained(a.out)
tok.save_pretrained(a.out)
Path(a.out, "train_log.json").write_text(json.dumps({
    "base_model": a.model, "pairs": len(train), "epochs": a.epochs, "lr": a.lr, "batch_size": a.bs, "max_len": a.max_len,
    "steps": step, "skipped_batches": skipped, "train_minutes": round((time.time() - t_train) / 60, 1), "gpu": torch.cuda.get_device_name(0),
    "peak_gpu_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "dev": r}, indent=1), encoding="utf-8")
print(f"saved to {a.out}; training took {(time.time() - t_train) / 60:.1f} min", flush=True)
