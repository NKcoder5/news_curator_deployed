"""The mix for continuing to train the fine-tuned pair model (artifacts/mdeberta-ft) on the fact-check setting.

    python src/build_continue.py data data/continue [--replay 30000]

New pairs, labelled by fact-checkers rather than by a model (backend/eval/claimReviewPairs.js):
  claimreview   a debunk's headline against the claim it rated false (contradiction), a true rating's
                headline against its claim (entailment), and a debunk against another rumour about the same
                subject (neutral). Split by review address: train and dev here, eval held out.
  match         two desks' wordings of one rumour, labelled by hand as the same claim (entailment, in both
                directions, which is what the matcher in agents/factCheckSearch.js asks) or not (neutral).

Kept from the first run's mix (data/train.jsonl, built by src/build_data.py): every pair of our own stance setting
(already split by claim there, so its held-out claims stay out) and a replay sample of the rest, so the general
skills are not forgotten. The dev file is the first run's, with the new dev pairs added.
"""
import argparse
import json
import random
from collections import Counter
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("data")
ap.add_argument("out")
ap.add_argument("--replay", type=int, default=30000)
ap.add_argument("--repeat", type=int, default=2, help="times each new training pair is repeated")
a = ap.parse_args()

DATA, OUT = Path(a.data), Path(a.out)
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(23)


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write(name, rows):
    with open(OUT / f"{name}.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    labels = [r["label"] for r in rows]
    print(f"{name:18s} {len(rows):7d}  ent/neu/con = {labels.count(0)}/{labels.count(1)}/{labels.count(2)}")


first_train, first_dev = load(DATA / "train.jsonl"), load(DATA / "dev.jsonl")
ours = [r for r in first_train if r["src"] == "stance_ours"]
rest = [r for r in first_train if r["src"] != "stance_ours"]
replay = rng.sample(rest, min(a.replay, len(rest)))

# A true rating's headline often hedges, asks or reports a denial ("omits key context", "Does this video
# show...?"): read by hand on 2026-10-22, too many of those pairs were not agreements, so they are left out.
cr = [r for r in load(DATA / "claimreview_pairs.jsonl") if r["sub"] != "confirm"]
keep = lambda r: {k: r[k] for k in ("premise", "hypothesis", "label", "src", "sub", "lang", "claim_id")}
cr_train = [keep(r) for r in cr if r["split"] == "train"]
cr_dev = [keep(r) for r in cr if r["split"] == "dev"]
cr_eval = [keep(r) for r in cr if r["split"] == "eval"]

match_train, match_dev, match_eval = [], [], []
# The matcher's question, claim against claim. Same: two desks' wordings reviewed within two weeks that
# share at least half their names and words (read by hand on 2026-10-22: about nine in ten such pairs are
# one rumour). Not the same: the two claims of an "other rumour" pair, months apart and sharing little.
# Both directions, split by the first review's address as the stance pairs are.
import hashlib
split_of = lambda url: {0: "eval", 1: "dev"}.get(int(hashlib.sha1(url.encode()).hexdigest()[:4], 16) % 10, "train")
cands = json.load(open(DATA / "raw" / "claimreview" / "match_candidates.json", encoding="utf-8"))["pairs"]
for p in cands:
    if p["score"] >= 0.5:
        for x, y in ((p["a"], p["b"]), (p["b"], p["a"])):
            {"train": match_train, "dev": match_dev, "eval": match_eval}[p["split"]].append(
                {"premise": x, "hypothesis": y, "label": 0, "src": "match", "sub": "same", "lang": "en", "claim_id": p["aUrl"][-12:]})
for r in load(DATA / "claimreview_pairs.jsonl"):
    if r["sub"] == "other rumour" and r.get("premise_claim"):
        for x, y in ((r["premise_claim"], r["hypothesis"]), (r["hypothesis"], r["premise_claim"])):
            {"train": match_train, "dev": match_dev, "eval": match_eval}[r["split"]].append(
                {"premise": x, "hypothesis": y, "label": 1, "src": "match", "sub": "different", "lang": "en", "claim_id": r["claim_id"]})
labels_file = DATA / "raw" / "claimreview" / "match_labels.json"
if labels_file.exists():
    for p in json.load(open(labels_file, encoding="utf-8"))["pairs"]:
        if p["label"] not in ("same", "different"):
            continue
        y = 0 if p["label"] == "same" else 1
        both = [{"premise": p["a"], "hypothesis": p["b"], "label": y, "src": "match", "sub": p["label"], "lang": "en", "claim_id": p["id"]},
                {"premise": p["b"], "hypothesis": p["a"], "label": y, "src": "match", "sub": p["label"], "lang": "en", "claim_id": p["id"]}]
        {"train": match_train, "dev": match_dev, "eval": match_eval}[p["split"]].extend(both)

train = cr_train * a.repeat + match_train * a.repeat + ours + replay
rng.shuffle(train)
write("train", train)
write("dev", first_dev + cr_dev + match_dev)
write("eval_claimreview", cr_eval)
if match_eval:
    write("eval_match", match_eval)
print(Counter(r["src"] for r in train))
