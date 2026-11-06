"""从官方原始权重导出可校验的 ONNX 组件，不进入应用安装包"""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
import pathlib
import sys
import types
from fractions import Fraction
import zipfile

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper
import torch
SOURCES = {
    "beat": ("https://github.com/CPJKU/beat_this", "beat-this==1.1.0",
             "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"),
    "demucs": ("https://github.com/facebookresearch/demucs", "demucs==4.0.1",
               "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"),
}


class FrequencyCore(torch.nn.Module):
    """保留官方神经网络，将复数傅里叶变换留给独立推理进程"""

    def __init__(self, model):
        """连接波形与实数频谱两条输入，不修改训练权重
        @param model - 官方原始模型
        """
        super().__init__()
        self.model = model
        model._spec = self.read_spectrum
        model._magnitude = lambda spectrum: spectrum
        model._mask = lambda spectrum, estimate: estimate
        model._ispec = self.capture_spectrum

    def read_spectrum(self, waveform):
        """提供当前推理的实数频谱
        @param waveform - 官方模型的波形分支输入
        @returns 当前实数频谱
        """
        return self.frequency_input

    def capture_spectrum(self, spectrum, length=None, scale=0):
        """保留尚未逆变换的频谱分支
        @param spectrum - 官方预测的实数频谱
        @param length - 原始上下文长度
        @param scale - 官方逆变换尺度
        @returns 供图优化消除的波形零占位
        """
        self.frequency_output = spectrum
        return spectrum.new_zeros((spectrum.shape[0], spectrum.shape[1], 2, length))

    def forward(self, waveform, spectrum):
        """分别返回官方波形分支和频谱分支
        @param waveform - 固定上下文双声道波形
        @param spectrum - 对应的实数频谱
        @returns 两条尚未相加的原精度预测
        """
        self.frequency_input = spectrum
        waveform = self.model(waveform)
        return waveform, self.frequency_output


def model_inputs(kind):
    """生成固定校验输入与对应的官方频谱布局
    @param kind - 节拍或分离模型
    @returns 不依赖随机数实现的命名张量
    """
    shape = (1, 1500, 128) if kind == "beat" else (1, 2, 172032)
    values = np.arange(np.prod(shape), dtype=np.uint32)
    values = (values * np.uint32(1664525) + np.uint32(1013904223)) & np.uint32(65535)
    samples = (values.astype(np.float32).reshape(shape) / 65535 - 0.5) * (4 if kind == "beat" else 0.2)
    if kind == "beat":
        return {"spectrogram": samples}
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(4096) / 4096)).astype(np.float32)
    padded = np.pad(samples, ((0, 0), (0, 0), (1536, 1536)), mode="reflect")
    padded = np.pad(padded, ((0, 0), (0, 0), (2048, 2048)), mode="reflect")
    chunks = np.lib.stride_tricks.sliding_window_view(padded, 4096, axis=-1)[..., ::1024, :]
    spectrum = np.fft.rfft(chunks * window, axis=-1, norm="ortho").swapaxes(-1, -2)[..., :-1, 2:170]
    real = np.stack((spectrum.real, spectrum.imag), axis=2).reshape(1, 4, 2048, 168)
    return {"waveform": samples, "spectrum": real.astype(np.float32)}


def main():
    """核验官方权重，导出原精度图、校验向量和独立下载的组件包"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=SOURCES)
    parser.add_argument("checkpoint", type=pathlib.Path)
    parser.add_argument("target", type=pathlib.Path)
    args = parser.parse_args()
    checkpoint = args.checkpoint.resolve()
    target = args.target.resolve()
    source_url, package, expected = SOURCES[args.kind]
    with checkpoint.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != expected:
        raise ValueError("请选择当前兼容的官方原始权重")
    target.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    torch.backends.mha.set_fastpath_enabled(False)
    if args.kind == "demucs":
        # 仅使用官方滤波函数，避免包初始化时加载无关的音频读取依赖
        filtering = types.ModuleType("openunmix")
        filtering.__path__ = [str(importlib.metadata.distribution("openunmix").locate_file("openunmix"))]
        sys.modules["openunmix"] = filtering
        from demucs.states import load_model

        model = load_model(torch.load(checkpoint, map_location="cpu", weights_only=False,
                                      mmap=True)).eval()
        model.segment = Fraction(172032, 44100)
        model.use_train_segment = False
        shape, prefix = [1, 2, 172032], "htdemucs"
    else:
        from beat_this.model.beat_tracker import BeatThis

        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        parameters = inspect.signature(BeatThis).parameters
        model = BeatThis(**{key: value for key, value in state["hyper_parameters"].items() if key in parameters})
        model.load_state_dict({key.removeprefix("model."): value for key, value in state["state_dict"].items()})
        model.eval()
        del state
        shape, prefix = [1, 1500, 128], "beat-this"
    model_path = target / (prefix + ".onnx")
    examples = model_inputs(args.kind)
    with torch.inference_mode():
        wrapped = FrequencyCore(model).eval() if args.kind == "demucs" else model
        reference = wrapped(*(torch.from_numpy(value) for value in examples.values()))
        reference = list(reference.values()) if isinstance(reference, dict) else reference
        reference = [value.detach().cpu().numpy().copy() for value in reference]
        torch.onnx.export(wrapped, tuple(torch.from_numpy(value) for value in examples.values()), model_path,
                          input_names=list(examples), output_names=["beat", "downbeat"] if args.kind == "beat" else ["time_output", "frequency_output"],
                          opset_version=17, dynamo=False)
    graph = onnx.load(model_path)
    if args.kind == "demucs":
        inferred = onnx.shape_inference.infer_shapes(graph)
        dimensions = {info.name: [dim.dim_value for dim in info.type.tensor_type.shape.dim]
                      for info in [*inferred.graph.input, *inferred.graph.value_info]}
        nodes = []
        for node in graph.graph.node:
            if node.op_type != "Split":
                nodes.append(node)
                continue
            # DirectML 对多批次通道等分存在数值偏差，等价切片保持每个通道和原始权重
            assert len(node.input) == 1 and len(node.output) == 2
            axis = next(helper.get_attribute_value(attr) for attr in node.attribute if attr.name == "axis")
            width = dimensions[node.input[0]][axis]
            assert width > 0 and width % 2 == 0
            for index, output in enumerate(node.output):
                name = node.name + f"/slice{index}/"
                for key, value in [("start", [index * width // 2]), ("end", [(index + 1) * width // 2]), ("axis", [axis])]:
                    graph.graph.initializer.append(numpy_helper.from_array(np.array(value, dtype=np.int64), name + key))
                nodes.append(helper.make_node("Slice", [node.input[0], name + "start", name + "end", name + "axis"], [output], name=name + "output"))
        del graph.graph.node[:]
        graph.graph.node.extend(nodes)
    pending = [graph]
    while pending:
        message = pending.pop()
        if hasattr(message, "doc_string"):
            message.doc_string = ""
        for field, value in message.ListFields():
            if field.message_type:
                pending.extend(value if field.is_repeated else [value])
    onnx.checker.check_model(graph)
    onnx.save(graph, model_path)
    options = ort.SessionOptions()
    options.enable_cpu_mem_arena = False
    options.enable_mem_reuse = False
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
    predictions = session.run(None, examples)
    for prediction, expected_output in zip(predictions, reference, strict=True):
        np.testing.assert_allclose(prediction, expected_output, rtol=0.001, atol=0.001)
    check_path = model_path.with_suffix(".check.json")
    check_path.write_text(json.dumps({"outputs": [
        value.ravel()[np.linspace(0, value.size - 1, 128, dtype=np.int64)].tolist() for value in predictions
    ]}), encoding="utf8")
    files = []
    for filename in (model_path, check_path):
        with filename.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        files.append({"file": filename.name, "bytes": filename.stat().st_size, "sha256": digest})
    manifest = {"source": source_url, "sourceSha256": expected, "package": package,
                "runtime": "ONNX Runtime", "inputShape": shape, "precision": "FP32", "files": files}
    archive = target / ("automix-" + args.kind + "-v2.zip")
    distribution = importlib.metadata.distribution(package.split("==")[0])
    license_path = next(path for path in distribution.files
                        if path.name in ("LICENSE", "LICENSE.txt"))
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for filename in (model_path, check_path):
            output.write(filename, filename.name)
        output.writestr("manifest.json", json.dumps(manifest, indent=2))
        output.writestr("LICENSE.txt", distribution.locate_file(license_path).read_bytes())
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest["archive"] = {"file": archive.name, "bytes": archive.stat().st_size, "sha256": digest}
    (target / (prefix + ".json")).write_text(json.dumps(manifest, indent=2), encoding="utf8")
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
