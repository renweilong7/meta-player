#!/usr/bin/env python3

import json
import sys
from typing import Any


def fail(message: str) -> None:
    sys.stderr.write(f"{message}\n")
    raise SystemExit(1)


def get_field(source: Any, key: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def get_nested_field(source: Any, *keys: str) -> Any:
    current = source
    for key in keys:
        current = get_field(current, key)
        if current is None:
            return None
    return current


def to_plain_jsonable(source: Any, depth: int = 0) -> Any:
    if depth > 4:
      return str(source)
    if isinstance(source, (str, int, float, bool)) or source is None:
        return source
    if isinstance(source, dict):
        return {
            str(key): to_plain_jsonable(value, depth + 1)
            for key, value in source.items()
        }
    if isinstance(source, list):
        return [to_plain_jsonable(item, depth + 1) for item in source[:20]]
    if isinstance(source, tuple):
        return [to_plain_jsonable(item, depth + 1) for item in source[:20]]
    if hasattr(source, "items"):
        try:
            return {
                str(key): to_plain_jsonable(value, depth + 1)
                for key, value in source.items()
            }
        except Exception:  # noqa: BLE001
            return str(source)
    return str(source)


def build_dashscope_error_message(response: Any) -> str:
    status_code = get_field(response, "status_code")
    code = get_field(response, "code")
    message = get_field(response, "message")
    request_id = get_field(response, "request_id")
    output = get_field(response, "output")
    output_plain = to_plain_jsonable(output)

    details = []
    if status_code is not None:
        details.append(f"status_code={status_code}")
    if code:
        details.append(f"code={code}")
    if message:
        details.append(f"message={message}")
    if request_id:
        details.append(f"request_id={request_id}")
    if output_plain not in (None, {}, []):
        details.append(f"output={json.dumps(output_plain, ensure_ascii=False)}")

    if details:
        return "dashscope request failed: " + ", ".join(details)

    response_plain = to_plain_jsonable(response)
    return (
        "invalid dashscope response: "
        + json.dumps(response_plain, ensure_ascii=False)
    )


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
    response_format = payload.get("responseFormat")

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
    if not isinstance(response_format, dict):
        fail("responseFormat must be an object")

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
            response_format=response_format,
        )
    except Exception as error:  # noqa: BLE001
        fail(str(error))

    status_code = get_field(response, "status_code")
    output = get_field(response, "output")
    choices = get_nested_field(response, "output", "choices")

    if status_code not in (None, 200) or output is None or not isinstance(choices, list):
        fail(build_dashscope_error_message(response))

    if len(choices) == 0:
        fail(build_dashscope_error_message(response))

    message_content = get_nested_field(choices[0], "message", "content")
    if message_content is None:
        fail(build_dashscope_error_message(response))

    text = ""
    if isinstance(message_content, list):
        text = "".join(
            item.get("text", "")
            for item in message_content
            if isinstance(item, dict)
        ).strip()
    elif isinstance(message_content, str):
        text = message_content.strip()

    if not text:
        fail(build_dashscope_error_message(response))

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
