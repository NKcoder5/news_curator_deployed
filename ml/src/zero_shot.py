"""Zero-shot comparison of the candidate base models on every evaluation set.

  ml/.venv/Scripts/python.exe -I -X utf8 ml/src/zero_shot.py ml/data ml/artifacts/eval
"""
import subprocess
import sys
from pathlib import Path

data, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for name in ("multilingual-MiniLMv2-L6-mnli-xnli", "multilingual-MiniLMv2-L12-mnli-xnli",
             "mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"):
    print("===", name, flush=True)
    subprocess.run([sys.executable, "-I", "-X", "utf8", str(Path(__file__).with_name("evaluate.py")),
                    "--model", f"MoritzLaurer/{name}", "--data", str(data), "--out", str(out / f"zeroshot_{name}.json")], check=True)
