"""Markdown comparison tables from evaluation JSON files written by evaluate.py.

  tables.py label=path.json [label=path.json ...]     (the first one is the baseline in the per-category table)
"""
import json
import sys

runs = [(a.split("=", 1)[0], json.load(open(a.split("=", 1)[1], encoding="utf-8"))) for a in sys.argv[1:]]
sets = list(runs[0][1]["sets"])


def cell(run, name, key):
    v = run["sets"].get(name, {}).get("overall", {}).get(key)
    return "-" if v is None else f"{v * 100:.1f}"


for key, title in (("accuracy", "Accuracy (%)"), ("macro_f1", "Macro-F1 (%)"), ("false_contradiction", "False-contradiction rate (%): a pair that is not a contradiction called one"),
                   ("false_entailment", "False-entailment rate (%): a pair that is not an entailment called one"), ("contradiction_recall", "Contradiction recall (%)")):
    print(f"\n**{title}**\n")
    print("| set | n | " + " | ".join(label for label, _ in runs) + " |")
    print("|---|---:|" + "---:|" * len(runs))
    for name in sets:
        n = runs[0][1]["sets"][name]["overall"]["n"]
        print(f"| {name.replace('eval_', '')} | {n} | " + " | ".join(cell(r, name, key) for _, r in runs) + " |")

for name in ("eval_synth_seen", "eval_synth_unseen", "eval_claims", "eval_blind"):
    cats = runs[0][1]["sets"][name].get("by_cat", {})
    if not cats:
        continue
    print(f"\n**{name.replace('eval_', '')} by category: accuracy / false-contradiction (%)**\n")
    print("| category | n | " + " | ".join(label for label, _ in runs) + " |")
    print("|---|---:|" + "---:|" * len(runs))
    for cat, m in cats.items():
        cols = []
        for _, r in runs:
            x = r["sets"][name]["by_cat"].get(cat, {})
            cols.append(f"{x.get('accuracy', 0) * 100:.0f} / {x.get('false_contradiction', 0) * 100:.0f}" if x else "-")
        print(f"| {cat} | {m['n']} | " + " | ".join(cols) + " |")
