#!/usr/bin/env python3

import json
import sys
from typing import Any


def fail(message: str) -> None:
    sys.stderr.write(f"{message}\n")
    raise SystemExit(1)


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
      model = SentenceTransformer(model_path, device="cpu")
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
