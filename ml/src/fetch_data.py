"""Download the public datasets into ml/data/raw/<name>/ (one directory each; nothing is executed).

All are plain parquet / JSON / CSV files:
  nli_fever    FEVER claims with evidence labelled entail / neutral / contradict (Nie et al., 2019)
  multi_nli    MultiNLI, a small replay so the model keeps its general English NLI
  xnli_hi      XNLI Hindi (train subset, validation, test)
  indicxnli    IndicXNLI Hindi and Tamil (machine-translated MNLI; human-checked dev and test)
  fnc1         Fake News Challenge stance data: headline vs article body (agree / disagree / discuss / unrelated)
"""
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download

ROOT = Path(sys.argv[1])


def hub(name, repo, files):
    out = ROOT / name
    out.mkdir(parents=True, exist_ok=True)
    for f in files:
        p = hf_hub_download(repo_id=repo, filename=f, repo_type="dataset", local_dir=out)
        print(name, f, Path(p).stat().st_size // 1024, "KB")


hub("nli_fever", "pietrolesci/nli_fever", ["data/train-00000-of-00001.parquet", "data/dev-00000-of-00001.parquet", "data/test-00000-of-00001.parquet"])
hub("multi_nli", "nyu-mll/multi_nli", ["data/train-00000-of-00001.parquet", "data/validation_matched-00000-of-00001.parquet"])
hub("xnli_hi", "facebook/xnli", ["hi/train-00000-of-00001.parquet", "hi/validation-00000-of-00001.parquet", "hi/test-00000-of-00001.parquet"])
hub("indicxnli", "Divyanshu/indicxnli", [f"forward/{s}/xnli_{lg}.json" for lg in ("hi", "ta") for s in ("train", "dev", "test")])
fnc = ROOT / "fnc1"
fnc.mkdir(parents=True, exist_ok=True)
for f in ("train_stances.csv", "train_bodies.csv", "competition_test_stances.csv", "competition_test_bodies.csv"):
    urllib.request.urlretrieve("https://raw.githubusercontent.com/FakeNewsChallenge/fnc-1/master/" + f, fnc / f)
    print("fnc1", f)
