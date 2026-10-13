"""Export a fine-tuned pair classifier to ONNX and quantise it to int8.

  export_onnx.py --model ml/artifacts/minilm-l12-ft --out ml/artifacts/minilm-l12-onnx-int8

Output directory (what backend/services/localNli.js loads):
  config.json, tokenizer.json, tokenizer_config.json, ...   copied from the model
  onnx/model.onnx             fp32 export (kept for comparison; delete before shipping)
  onnx/model_quantized.onnx   int8 weights (MatMul and the embedding table), dynamic activation quantisation

The 250k-token embedding table is most of a multilingual model's size, so it is quantised too; without it the
"int8" file stays near 400 MB.
"""
import argparse
import shutil
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--reduce-range", action="store_true", help="7-bit weights: safer on CPUs without VNNI, slightly less exact")
a = ap.parse_args()

out = Path(a.out)
(out / "onnx").mkdir(parents=True, exist_ok=True)
tok = AutoTokenizer.from_pretrained(a.model)
model = AutoModelForSequenceClassification.from_pretrained(a.model).eval().cpu()
model.config.return_dict = True

sample = tok(["Narendra Modi resigned as Prime Minister today."], ["PM Modi resigned today."], return_tensors="pt")
names = ["input_ids", "attention_mask"] + (["token_type_ids"] if "token_type_ids" in sample and getattr(model.config, "type_vocab_size", 0) > 1 else [])
args = tuple(sample[n] for n in names)
fp32 = out / "onnx" / "model.onnx"
with torch.no_grad():
    torch.onnx.export(model, args, str(fp32), input_names=names, output_names=["logits"], opset_version=17, dynamo=False,
                      dynamic_axes={**{n: {0: "batch", 1: "seq"} for n in names}, "logits": {0: "batch"}})
print("fp32", fp32.stat().st_size // 2**20, "MB")

quant = out / "onnx" / "model_quantized.onnx"
quantize_dynamic(str(fp32), str(quant), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm", "Gather"],
                 extra_options={"MatMulConstBOnly": True}, per_channel=False, reduce_range=a.reduce_range)
print("int8", quant.stat().st_size // 2**20, "MB")

tok.save_pretrained(out)
shutil.copy(Path(a.model) / "config.json", out / "config.json")
