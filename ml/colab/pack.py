"""Build ml/colab/pure_press_ml.zip, the one file train_pair_model.ipynb asks for.

  python -I ml/colab/pack.py

It holds the training scripts, the blind and claim-matching pairs, our Gemini-labelled stance pairs, and the
model the server ships (for the before/after comparison). Run from anywhere; paths are from the repository.
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ml" / "colab" / "pure_press_ml.zip"
STANCE = ROOT / "backend" / "eval" / "results" / "stance_pairs.jsonl"
SHIPPED = ROOT / "backend" / "models" / "minilm-l12-onnx-int8"

if not STANCE.exists():
    raise SystemExit(f"missing {STANCE}: run backend/eval/stanceAgreement.js first")

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted((ROOT / "ml" / "src").glob("*.py")):
        z.write(f, f"ml/src/{f.name}")
    z.write(ROOT / "ml" / "eval" / "blind_pairs.json", "ml/eval/blind_pairs.json")
    for f in sorted((ROOT / "backend" / "eval" / "suites").glob("*.json")):
        z.write(f, f"backend/eval/suites/{f.name}")
    z.write(STANCE, "stance_pairs.jsonl")
    for f in sorted(SHIPPED.rglob("*")):
        if f.is_file():
            z.write(f, f"shipped_model/{f.relative_to(SHIPPED).as_posix()}")

rows = sum(1 for line in STANCE.open(encoding="utf-8") if '"hosted"' in line)
print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, {rows} labelled stance pairs)")
