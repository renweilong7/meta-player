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

    base_url = str(payload.get("baseUrl", "")).strip()
    api_key = str(payload.get("apiKey", "")).strip()
    model = str(payload.get("model", "")).strip()
    video_path = str(payload.get("videoPath", "")).strip()
    prompt = str(payload.get("prompt", "")).strip()
    fps = payload.get("fps")

    if not base_url:
        fail("missing baseUrl")
    if not api_key:
        fail("missing apiKey")
    if not model:
        fail("missing model")
    if not video_path:
        fail("missing videoPath")
    if not prompt:
        fail("missing prompt")
    if not isinstance(fps, (int, float)):
        fail("fps must be a number")

    try:
        import dashscope
        from dashscope import MultiModalConversation
    except Exception as error:  # noqa: BLE001
        fail(f"missing dependency dashscope: {error}")

    dashscope.base_http_api_url = base_url
    video_uri = f"file://{video_path}"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "video": video_uri,
                    "fps": fps,
                },
                {
                    "text": prompt,
                },
            ],
        }
    ]

    try:
        response = MultiModalConversation.call(
            api_key=api_key,
            model=model,
            messages=messages,
        )
    except Exception as error:  # noqa: BLE001
        fail(str(error))

    try:
        content = response.output.choices[0].message.content
    except Exception as error:  # noqa: BLE001
        fail(f"invalid dashscope response: {error}")

    text = ""
    if isinstance(content, list):
        text = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict)
        ).strip()
    elif isinstance(content, str):
        text = content.strip()

    if not text:
        fail("dashscope returned empty content")

    result: dict[str, Any] = {
        "content": text,
    }
    usage = getattr(response, "usage", None)
    if usage is not None:
        result["usage"] = {
            "input_tokens": getattr(usage, "input_tokens", None),
            "output_tokens": getattr(usage, "output_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
        }
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
