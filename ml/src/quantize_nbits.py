"""Weight-only quantisation of an fp32 ONNX export, for models that dynamic int8 quantisation breaks.

    python src/quantize_nbits.py artifacts/<export>/onnx/model.onnx artifacts/<name>/onnx/model_quantized.onnx

Dynamic int8 (src/export_onnx.py) also quantises the activations, and mDeBERTa's do not survive it: measured on
2026-10-22, the int8 export read nearly every pair as one class. Here only the weights are quantised and the
activations stay fp32: the MatMul weights to 4 bits in blocks of 32 (MatMulNBits), then the embedding table
(Gather) to int8. For mdeberta-nb4 that is 106 MB against 1.1 GB, at about full-precision accuracy.
"""
import sys
import tempfile
from pathlib import Path

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.parent.mkdir(parents=True, exist_ok=True)
q = MatMulNBitsQuantizer(onnx.load(str(src)), block_size=32, is_symmetric=True)
q.process()
with tempfile.TemporaryDirectory() as tmp:
    nbits = Path(tmp) / "nbits4.onnx"
    q.model.save_model_to_file(str(nbits), use_external_data_format=False)
    quantize_dynamic(str(nbits), str(dst), weight_type=QuantType.QInt8, op_types_to_quantize=["Gather"], per_channel=False)
print(f"written {dst} ({dst.stat().st_size // 2**20} MB)", flush=True)
