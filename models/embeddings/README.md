## Bundled Local Embedding Models

将项目自带的本地 Embedding 模型放在这个目录下，每个模型一个子目录。

示例：

- `models/embeddings/bge-small-zh-v1.5/`
- `models/embeddings/multilingual-e5-small/`

每个模型目录建议至少包含：

- `config.json`
- `tokenizer.json`
- `model.safetensors`、`pytorch_model.bin`、`onnx/model.onnx` 或 `model.onnx`

设置页会自动扫描这里的一级子目录，并把它们作为“内置模型”展示。
