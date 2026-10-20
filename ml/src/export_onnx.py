"""Export a fine-tuned pair classifier to ONNX and quantise it to int8, with a pruned vocabulary.

  export_onnx.py --model ml/artifacts/minilm-l12-ft --out ml/artifacts/minilm-l12-onnx-int8 --data ml/data

Output directory (what backend/services/localNli.js loads):
  config.json, tokenizer.json, tokenizer_config.json, ...   the pruned tokenizer and the model config
  onnx/model.onnx             fp32 export (kept for comparison; delete before shipping)
  onnx/model_quantized.onnx   int8 weights (MatMul and the embedding table), dynamic activation quantisation

Why the vocabulary is pruned. A multilingual model carries a 250k-piece vocabulary, and that costs twice:
the embedding table is most of the model's size (448 MB fp32 for a 118M-parameter MiniLM), and the JavaScript
tokenizer keeps every piece in memory (measured: +270 MB of resident memory in Node), against a server with 512 MB.
The tokenizer here keeps the pieces that its segmentation of the project's text uses (every .jsonl in --data:
English, Hindi and Tamil training and evaluation sets), every single-character piece (so any word can still be
spelled) and the special tokens; the embedding table is cut to the same rows and ids are renumbered
consistently in tokenizer and model. Text the training data never used gets segmented into smaller kept pieces.

DeBERTa shares one attention projection between content and position; the exporter feeds the second use through
an Identity node and the quantiser would then leave that copy in fp32. The identities are folded first.
"""
import argparse
import json
from pathlib import Path

import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from tokenizers import Tokenizer
from transformers import AutoModelForSequenceClassification, AutoTokenizer, PreTrainedTokenizerFast

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--data", default=None, help="directory of .jsonl files whose text defines the vocabulary to keep; omit to keep it all")
ap.add_argument("--keep-top", type=int, default=0, help="also keep the first N pieces (sentencepiece orders them by frequency)")
ap.add_argument("--per-tensor", action="store_true",
                help="one scale per weight matrix instead of per output channel (measured: -2.4 points on the synthetic set, -2 on claims)")
ap.add_argument("--reduce-range", action="store_true", help="7-bit weights: safer on CPUs without VNNI, slightly less exact")
a = ap.parse_args()

out = Path(a.out)
(out / "onnx").mkdir(parents=True, exist_ok=True)
tok = AutoTokenizer.from_pretrained(a.model)
model = AutoModelForSequenceClassification.from_pretrained(a.model, dtype=torch.float32).eval().cpu()  # checkpoints may be stored in fp16
model.config.return_dict = True


def prune(tok, model, data_dir, keep_top):
    spec = json.loads(tok.backend_tokenizer.to_str())
    assert spec["model"]["type"] == "Unigram", "vocabulary pruning is written for sentencepiece-unigram tokenizers"
    pieces = spec["model"]["vocab"]
    kept = set(tok.all_special_ids) | set(range(keep_top)) | {i for i, (p, _) in enumerate(pieces) if len(p.lstrip("▁")) <= 1}
    pairs = []
    for f in sorted(Path(data_dir).glob("*.jsonl")):
        pairs += [(r["premise"], r.get("hypothesis") or r.get("claim", "")) for r in map(json.loads, open(f, encoding="utf-8")) if r.get("premise")]
    for i in range(0, len(pairs), 5000):
        chunk = pairs[i:i + 5000]
        for ids in tok([p for p, _ in chunk], [h for _, h in chunk])["input_ids"]:
            kept.update(ids)
    kept = sorted(kept)
    new_id = {old: new for new, old in enumerate(kept)}

    spec["model"]["vocab"] = [pieces[i] for i in kept]
    spec["model"]["unk_id"] = new_id[spec["model"]["unk_id"]]
    spec["added_tokens"] = [dict(t, id=new_id[t["id"]]) for t in spec["added_tokens"] if t["id"] in new_id]

    def renumber(node):  # post-processor templates name the special tokens by id
        if isinstance(node, dict):
            if "ids" in node:
                node["ids"] = [new_id[i] for i in node["ids"]]
            for v in node.values():
                renumber(v)
        elif isinstance(node, list):
            for v in node:
                renumber(v)

    renumber(spec["post_processor"])
    special = {k: getattr(tok, k) for k in ("bos_token", "eos_token", "unk_token", "sep_token", "pad_token", "cls_token", "mask_token") if getattr(tok, k)}
    pruned = PreTrainedTokenizerFast(tokenizer_object=Tokenizer.from_str(json.dumps(spec)), **special)
    weights = model.get_input_embeddings().weight.data[kept].clone()
    model.set_input_embeddings(torch.nn.Embedding.from_pretrained(weights, freeze=True))
    model.config.vocab_size = len(kept)
    for key in ("pad_token_id", "bos_token_id", "eos_token_id"):
        if getattr(model.config, key, None) is not None:
            setattr(model.config, key, new_id[getattr(model.config, key)])
    print(f"vocabulary {len(pieces)} -> {len(kept)} pieces, from {len(pairs)} pairs")
    return pruned


if a.data:
    tok = prune(tok, model, a.data, a.keep_top)

names = ["input_ids", "attention_mask"] + (["token_type_ids"] if getattr(model.config, "type_vocab_size", 0) > 1 else [])
sample = tok(["Narendra Modi resigned as Prime Minister today."], ["PM Modi resigned today."], return_tensors="pt")
args = tuple(sample[n] for n in names)
fp32 = out / "onnx" / "model.onnx"
with torch.no_grad():
    torch.onnx.export(model, args, str(fp32), input_names=names, output_names=["logits"], opset_version=17, dynamo=False,
                      dynamic_axes={**{n: {0: "batch", 1: "seq"} for n in names}, "logits": {0: "batch"}})
print("fp32", fp32.stat().st_size // 2**20, "MB")


def fold_identities(path):
    graph = onnx.load(path)
    weights = {i.name for i in graph.graph.initializer}
    alias = {n.output[0]: n.input[0] for n in graph.graph.node if n.op_type == "Identity" and n.input[0] in weights}
    resolve = lambda x: resolve(alias[x]) if x in alias else x  # noqa: E731
    kept_nodes = [n for n in graph.graph.node if not (n.op_type == "Identity" and n.output[0] in alias)]
    for n in kept_nodes:
        for k, x in enumerate(n.input):
            n.input[k] = resolve(x)
    del graph.graph.node[:]
    graph.graph.node.extend(kept_nodes)
    onnx.save(graph, path)
    return len(alias)


print("identities folded:", fold_identities(str(fp32)))
quant = out / "onnx" / "model_quantized.onnx"
quantize_dynamic(str(fp32), str(quant), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm", "Gather"],
                 extra_options={"MatMulConstBOnly": True}, per_channel=not a.per_tensor, reduce_range=a.reduce_range)
print("int8", quant.stat().st_size // 2**20, "MB")

tok.save_pretrained(out)
model.config.save_pretrained(out)
