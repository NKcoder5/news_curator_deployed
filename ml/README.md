# ml/ - our own text-pair model

A small multilingual classifier that reads a *premise* (a headline, a fact-check headline, an
encyclopedia sentence) and a *claim* and says **entailment**, **neutral** or **contradiction**.
It is meant to replace the external-LLM calls that judge sentence pairs. Results, data and the
decision on the base model are in `docs/engineering/2026-10-14-own-models.md`; the Node service that
runs the exported model is `backend/services/localNli.js`.

Nothing large is in git. The virtual environment, the datasets and the model files are
regenerable and ignored: `ml/.venv/`, `ml/data/`, `ml/artifacts/`.

## Reproduce

Windows, Python 3.12+ (developed on 3.14), an NVIDIA GPU for training (RTX 5050, 8 GB, took 9 minutes
for the model that was kept). All commands run from the repository root. `-I -X utf8` runs Python in
isolated mode (nothing from the current directory is imported, which matters when reading downloaded
data) with UTF-8 output.

```powershell
# 1. environment (PyTorch needs a CUDA 12.8+ build for RTX 50-series GPUs)
python -m venv ml\.venv
ml\.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
ml\.venv\Scripts\python -m pip install transformers datasets accelerate scikit-learn sentencepiece protobuf onnx onnxruntime onnxscript huggingface_hub tiktoken psutil pandas

# 2. data: public sets into ml/data/raw, our synthetic pairs, then the train / dev / eval files
ml\.venv\Scripts\python -I -X utf8 ml/src/fetch_data.py ml/data/raw
python ml/src/synth.py --out ml/data
ml\.venv\Scripts\python -I -X utf8 ml/src/build_data.py ml/data backend/eval/suites

# 3. zero-shot baselines of the three candidate base models (for the comparison)
ml\.venv\Scripts\python -I -X utf8 ml/src/zero_shot.py ml/data ml/artifacts/eval

# 4. fine-tune (about 10 minutes for MiniLM-L12 on this GPU; mDeBERTa did not finish in the time allowed, see the engineering note)
ml\.venv\Scripts\python -I -X utf8 ml/src/train.py --model MoritzLaurer/multilingual-MiniLMv2-L12-mnli-xnli --data ml/data --out ml/artifacts/minilm-l12-ft --epochs 2 --lr 3e-5

# 5. evaluate (writes JSON; add --errors eval_claims to print the misclassified pairs of one set)
ml\.venv\Scripts\python -I -X utf8 ml/src/evaluate.py --model ml/artifacts/minilm-l12-ft --data ml/data --out ml/artifacts/eval/ft_minilm_l12.json

# 6. export to ONNX with a pruned vocabulary, quantise to int8, then check the int8 model and measure CPU latency
ml\.venv\Scripts\python -I -X utf8 ml/src/export_onnx.py --model ml/artifacts/minilm-l12-ft --out ml/artifacts/minilm-l12-onnx-int8 --data ml/data
ml\.venv\Scripts\python -I -X utf8 ml/src/evaluate.py --model ml/artifacts/minilm-l12-onnx-int8 --onnx ml/artifacts/minilm-l12-onnx-int8/onnx/model_quantized.onnx --data ml/data --out ml/artifacts/eval/int8_minilm_l12.json
ml\.venv\Scripts\python -I -X utf8 ml/src/bench_onnx.py --model ml/artifacts/minilm-l12-onnx-int8 --onnx ml/artifacts/minilm-l12-onnx-int8/onnx/model_quantized.onnx --data ml/data

# 7. comparison tables (markdown) from the JSON files
ml\.venv\Scripts\python -I -X utf8 ml/src/tables.py "zero-shot=ml/artifacts/eval/zeroshot_multilingual-MiniLMv2-L12-mnli-xnli.json" "fine-tuned=ml/artifacts/eval/ft_minilm_l12.json" "int8=ml/artifacts/eval/int8_minilm_l12.json"
```

To use the model in the backend, point `LOCAL_NLI_MODEL_DIR` at the export directory (default
`ml/artifacts/minilm-l12-onnx-int8`); `onnx/model.onnx` (the fp32 file, 160 MB) is not needed there. The export is 43 MB in total.

## What is in `ml/src`

| file | role |
|---|---|
| `synth.py` | synthetic in-domain pairs, one generator per failure mode; entities and some sentence frames are held out of training |
| `fetch_data.py` | downloads FEVER-NLI, MultiNLI, XNLI-hi, IndicXNLI (hi, ta) and FNC-1 |
| `build_data.py` | mixes them into `train.jsonl` / `dev.jsonl` and builds the evaluation files, including the project's claim-matching suites as an evaluation-only set |
| `train.py` | the fine-tuning loop (length-grouped batches, bf16 autocast over fp32 weights, linear warm-up and decay; `--freeze-embeddings` for large-vocabulary models) |
| `evaluate.py`, `nli_common.py` | predictions (PyTorch or ONNX Runtime) and metrics: accuracy, macro-F1, false-contradiction rate, per category |
| `export_onnx.py`, `bench_onnx.py` | vocabulary pruning, ONNX export, per-channel int8 quantisation, CPU latency and memory |
| `ml/eval/blind_pairs.json` | 72 hand-written pairs for the final check, kept unseen until the last model was trained |
| `zero_shot.py`, `tables.py`, `peek.py` | baseline comparison, markdown tables, a quick look at generated pairs |

## Labels and the error that matters

Labels are `0` entailment, `1` neutral, `2` contradiction. The error this project cannot afford is the
**false contradiction**: a pair that is not a contradiction called one, because it turns a true claim into a FAKE
verdict. Every evaluation reports it next to accuracy and macro-F1.
