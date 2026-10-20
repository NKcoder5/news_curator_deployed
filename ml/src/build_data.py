"""Assemble training, dev and evaluation files in ml/data from the raw downloads and the synthetic generator.

Labels everywhere: 0 entailment, 1 neutral, 2 contradiction (the order the candidate models use).

Training mix (about 170k pairs): synthetic in-domain 80k, FEVER-NLI 25k, FNC-1 stance 24k, IndicXNLI Tamil 14k and
Hindi 6k, XNLI Hindi 8k, MultiNLI 12k (replay). The test sets of the public data are never trained on.

Claim-matching pairs from backend/eval/suites are used as an evaluation set only, in both directions: the model is
never trained on a claim from those suites, so their later use in the project's own evaluation stays clean.
"""
import json
import random
import re
import sys
from pathlib import Path

import pandas as pd

DATA = Path(sys.argv[1])
SUITES = Path(sys.argv[2])
RAW = DATA / "raw"
rng = random.Random(11)


def write(name, rows):
    with open(DATA / f"{name}.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    labels = [r["label"] for r in rows]
    print(f"{name:22s} {len(rows):7d}  ent/neu/con = {labels.count(0)}/{labels.count(1)}/{labels.count(2)}")


def pairs(df, src, lang, premise="premise", hypothesis="hypothesis", label="label"):
    return [{"premise": str(p), "hypothesis": str(h), "label": int(y), "src": src, "lang": lang}
            for p, h, y in zip(df[premise], df[hypothesis], df[label]) if p and h and y in (0, 1, 2)]


def sample(rows, n):
    return rng.sample(rows, min(n, len(rows)))


def balanced(df, n, label="label"):
    per = n // 3
    return pd.concat([df[df[label] == k].sample(min(per, (df[label] == k).sum()), random_state=3) for k in (0, 1, 2)])


def indic(lang, split):
    with open(RAW / f"indicxnli/forward/{split}/xnli_{lang}.json", encoding="utf-8") as f:
        return pd.DataFrame(json.load(f)[{"dev": "validation"}.get(split, split)])


# ---- FEVER-NLI. In this Hub copy the columns are swapped: `premise` holds the claim, `hypothesis` the evidence.
def fever(split, n):
    df = pd.read_parquet(RAW / f"nli_fever/data/{split}-00000-of-00001.parquet")
    df = df.rename(columns={"premise": "hypothesis", "hypothesis": "premise"})
    df["premise"] = df["premise"].str.replace(r"\s+([.,;:!?)])", r"\1", regex=True).str.replace(r"\(\s+", "(", regex=True)
    return pairs(balanced(df, n), "fever", "en")


# ---- FNC-1: headline (hypothesis) against the sentences of the body that overlap it most (premise).
STOP = set("a an the of in on at to for and or is are was were be been by with from as that this it its his her their they he "
           "she we you i not no has have had will would can could says said after before over into than about up out new".split())


def words(s):
    return {w for w in re.findall(r"[a-z0-9']+", s.lower()) if w not in STOP}


def best_sentences(headline, body, k=2):
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", body.replace("\n", " ")) if len(s) > 20]
    h = words(headline)
    ranked = sorted(range(len(sentences)), key=lambda i: (-len(h & words(sentences[i])), i))[:k]
    return " ".join(sentences[i] for i in sorted(ranked))[:700]


FNC_LABEL = {"agree": 0, "discuss": 1, "unrelated": 1, "disagree": 2}


def fnc(stances_file, bodies_file, quota, body_ids=None):
    st = pd.read_csv(RAW / f"fnc1/{stances_file}")
    bodies = dict(pd.read_csv(RAW / f"fnc1/{bodies_file}").values)
    if body_ids is not None:
        st = st[st["Body ID"].isin(body_ids)]
    parts = []
    for stance, n in quota.items():
        sub = st[st["Stance"] == stance]
        parts.append(sub.sample(min(n, len(sub)), random_state=5).assign(stance=stance))
    rows = []
    for _, r in pd.concat(parts).iterrows():
        rows.append({"premise": best_sentences(r["Headline"], bodies[r["Body ID"]]), "hypothesis": r["Headline"],
                     "label": FNC_LABEL[r["stance"]], "src": "fnc1", "lang": "en", "sub": r["stance"]})
    return rows


# ---- real claim pairs from the project's claim-matching suites (evaluation only)
def claim_pairs():
    rows = []
    mapping = {"same": 0, "variant": 2, "different": 1}
    for name in ("claim_matching", "claim_matching_heldout"):
        for p in json.load(open(SUITES / f"{name}.json", encoding="utf-8"))["pairs"]:
            for a, b in ((p["a"], p["b"]), (p["b"], p["a"])):
                rows.append({"premise": a, "hypothesis": b, "label": mapping[p["label"]], "src": "claims", "lang": "en",
                             "cat": "claim_matching", "sub": p["label"], "suite": name})
    return rows


# ---- hand-written pairs for the final check (ml/eval/blind_pairs.json), evaluation only
def blind_pairs():
    blind = json.load(open(Path(__file__).resolve().parents[1] / "eval" / "blind_pairs.json", encoding="utf-8"))
    return [{"premise": p["premise"], "hypothesis": p["hypothesis"], "label": blind["labels"][p["label"]], "src": "blind",
             "lang": "en", "cat": p["cat"]} for p in blind["pairs"]]


train, dev = [], []

# synthetic
for name, bucket in (("synth_train", train), ("synth_dev", dev)):
    for line in open(DATA / f"{name}.jsonl", encoding="utf-8"):
        r = json.loads(line)
        r["src"] = "synth"
        bucket.append(r)
synth_test = [json.loads(line) for line in open(DATA / "synth_test.jsonl", encoding="utf-8")]
write("eval_synth_seen", [dict(r, src="synth") for r in synth_test if r["split"] == "test-seen"])
write("eval_synth_unseen", [dict(r, src="synth") for r in synth_test if r["split"] == "test-unseen"])

# FEVER-NLI
train += fever("train", 25000)
fever_dev = fever("dev", 2700)  # the Hub copy's test split carries no labels
rng.shuffle(fever_dev)
dev += fever_dev[:300]
write("eval_fever", fever_dev[300:])

# MultiNLI replay
mnli = pd.read_parquet(RAW / "multi_nli/data/train-00000-of-00001.parquet")
train += pairs(balanced(mnli, 18000), "mnli", "en")
write("eval_mnli", pairs(balanced(pd.read_parquet(RAW / "multi_nli/data/validation_matched-00000-of-00001.parquet"), 2400), "mnli", "en"))

# XNLI Hindi and IndicXNLI Hindi / Tamil
train += pairs(balanced(pd.read_parquet(RAW / "xnli_hi/hi/train-00000-of-00001.parquet"), 10000), "xnli_hi", "hi")
dev += pairs(balanced(pd.read_parquet(RAW / "xnli_hi/hi/validation-00000-of-00001.parquet"), 300), "xnli_hi", "hi")
write("eval_xnli_hi", pairs(pd.read_parquet(RAW / "xnli_hi/hi/test-00000-of-00001.parquet"), "xnli_hi", "hi"))
for lang, n in (("ta", 16000), ("hi", 8000)):
    train += pairs(balanced(indic(lang, "train"), n), f"indic_{lang}", lang)
    dev += pairs(balanced(indic(lang, "dev"), 300), f"indic_{lang}", lang)
write("eval_indic_ta", pairs(indic("ta", "test"), "indic_ta", "ta"))
write("eval_indic_hi", pairs(balanced(indic("hi", "test"), 2400), "indic_hi", "hi"))

# FNC-1: train on 90% of the bodies, hold out the rest for dev; the competition test set is evaluation only
ids = sorted(pd.read_csv(RAW / "fnc1/train_bodies.csv")["Body ID"])
rng.shuffle(ids)
cut = len(ids) // 10
dev_ids, train_ids = set(ids[:cut]), set(ids[cut:])
train += fnc("train_stances.csv", "train_bodies.csv", {"agree": 6000, "disagree": 1700, "discuss": 8000, "unrelated": 8300}, train_ids)
dev += fnc("train_stances.csv", "train_bodies.csv", {"agree": 100, "disagree": 100, "discuss": 150, "unrelated": 150}, dev_ids)
write("eval_fnc1", fnc("competition_test_stances.csv", "competition_test_bodies.csv",
                       {"agree": 1903, "disagree": 697, "discuss": 2500, "unrelated": 2500}))

write("eval_claims", claim_pairs())
write("eval_blind", blind_pairs())

# Our own setting: Google News headlines judged against the claims people forward, labelled by Gemini
# through the verifier's own stance step (backend/eval/stanceAgreement.js). Split by claim, so no claim
# is in two splits, and repeated in training: a few thousand pairs against a hundred thousand general ones.
STANCE = DATA / "stance_pairs.jsonl"
if STANCE.exists():
    to_label = {"agree": 0, "unrelated": 1, "disagree": 2}
    def parsed(line):
        try:
            return json.loads(line)
        except ValueError:  # two recorders appending at once can leave a broken line
            return {}
    rows = [parsed(line) for line in open(STANCE, encoding="utf-8") if line.strip()]
    rows = [r for r in rows if not r.get("noCoverage") and r.get("provider") == "gemini" and r.get("hosted") in to_label]
    claims = sorted({r["id"] for r in rows})
    random.Random(7).shuffle(claims)
    n = len(claims)
    held, dev_claims = set(claims[:n // 5]), set(claims[n // 5:n // 5 + n // 10])
    as_pair = lambda r: {"premise": r["premise"], "hypothesis": r["claim"], "label": to_label[r["hosted"]],
                         "src": "stance_ours", "lang": "en", "sub": r["hosted"], "claim_id": r["id"]}
    write("eval_stance", [as_pair(r) for r in rows if r["id"] in held])
    dev += [as_pair(r) for r in rows if r["id"] in dev_claims]
    train += [as_pair(r) for r in rows if r["id"] not in held and r["id"] not in dev_claims] * 3

rng.shuffle(train)
rng.shuffle(dev)
write("train", train)
write("dev", dev)
from collections import Counter
print(Counter(r["src"] for r in train))
