"""Create or update the private Space that serves our pair model.

    python space/deploy.py artifacts/mdeberta-clean-nb4 <name-shown-by-the-api>

Reads HF_TOKEN from backend/.env (never printed). Uploads ml/space/{app.py, Dockerfile, README.md} and the
export's config.json, tokenizer.json, tokenizer_config.json and onnx/model_quantized.onnx under model/.
"""
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[2]
token = next(line.split("=", 1)[1].strip().strip('"') for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines()
             if line.startswith("HF_TOKEN="))
export, name = Path(sys.argv[1]), sys.argv[2]
api = HfApi(token=token)
repo = f"{api.whoami()['name']}/pure-press-pair-model"
api.create_repo(repo, repo_type="space", space_sdk="docker", private=True, exist_ok=True)
here = Path(__file__).parent
for f in ("app.py", "Dockerfile", "README.md"):
    api.upload_file(path_or_fileobj=str(here / f), path_in_repo=f, repo_id=repo, repo_type="space")
for f in ("config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"):
    api.upload_file(path_or_fileobj=str(export / f), path_in_repo=f"model/{f}", repo_id=repo, repo_type="space")
api.upload_file(path_or_fileobj=name.encode(), path_in_repo="model/NAME", repo_id=repo, repo_type="space")
print(f"uploaded to {repo}; serving at https://{repo.replace('/', '-').lower()}.hf.space")
