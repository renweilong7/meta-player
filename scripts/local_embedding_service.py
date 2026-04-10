#!/usr/bin/env python3

import json
import os
import sys
from typing import Any


def fail(message: str) -> None:
    sys.stderr.write(f"{message}\n")
    raise SystemExit(1)


def resolve_embedding_device() -> str:
    configured_device = os.environ.get("META_PLAYER_LOCAL_EMBEDDING_DEVICE", "").strip().lower()
    if configured_device:
        return configured_device

    try:
        import torch
    except Exception:
        return "cpu"

    try:
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass

    try:
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass

    return "cpu"


def main() -> None:
    try:
      payload = json.load(sys.stdin)
    except Exception as error:  # noqa: BLE001
      fail(f"invalid input: {error}")

    model_path = str(payload.get("model_path", "")).strip()
    inputs = payload.get("inputs", [])

    if not model_path:
      fail("missing model_path")

    if not isinstance(inputs, list) or any(not isinstance(item, str) for item in inputs):
      fail("inputs must be a string list")

    try:
      from sentence_transformers import SentenceTransformer
    except Exception as error:  # noqa: BLE001
      fail(f"missing dependency sentence-transformers: {error}")

    try:
      model = SentenceTransformer(model_path, device=resolve_embedding_device())
      embeddings = model.encode(
        inputs,
        normalize_embeddings=True,
        convert_to_numpy=True,
      )
    except Exception as error:  # noqa: BLE001
      fail(str(error))

    result: dict[str, Any] = {
      "embeddings": embeddings.tolist(),
      "count": len(inputs),
      "dimension": int(embeddings.shape[1]) if len(inputs) > 0 else 0,
    }
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
