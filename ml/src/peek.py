"""Print a few random rows per category and label from a pairs file (a quick sanity read)."""
import json
import random
import sys
from collections import defaultdict

path, per = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 2
rows = [json.loads(line) for line in open(path, encoding="utf-8")]
groups = defaultdict(list)
for r in rows:
    groups[(r["cat"], r["label"])].append(r)
random.seed(0)
for key in sorted(groups):
    for r in random.sample(groups[key], min(per, len(groups[key]))):
        print(f"[{key[0]}/{'ENT NEU CON'.split()[key[1]]}/{r['frame']}] P: {r['premise']}\n    H: {r['hypothesis']}")
