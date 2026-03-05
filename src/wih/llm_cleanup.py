from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

SYSTEM_PROMPT = (
    "You clean and normalize hiring job records. "
    "Keep meaning intact, trim spam, fix obvious formatting noise, and output strict JSON."
)


def cleanup_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        return records

    url = os.getenv("LLM_API_URL", "https://api.openai.com/v1/responses")
    model = os.getenv("LLM_MODEL", "gpt-4.1-mini")

    user_prompt = (
        "Normalize these hiring records and return a JSON object with key 'records'. "
        "Keep all ids and issue numbers unchanged. Input:\n"
        f"{json.dumps(records, ensure_ascii=False)}"
    )

    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}]},
            {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "cleaned_records",
                "schema": {
                    "type": "object",
                    "properties": {
                        "records": {"type": "array", "items": {"type": "object"}}
                    },
                    "required": ["records"],
                    "additionalProperties": False,
                },
            }
        },
    }

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError:
        return records

    cleaned_json = _extract_json(result)
    if not cleaned_json:
        return records

    try:
        parsed = json.loads(cleaned_json)
    except json.JSONDecodeError:
        return records

    cleaned = parsed.get("records")
    return cleaned if isinstance(cleaned, list) else records


def _extract_json(payload: dict[str, Any]) -> str | None:
    output = payload.get("output", [])
    for item in output:
        for content in item.get("content", []):
            text = content.get("text")
            if isinstance(text, str):
                return text
    return payload.get("output_text") if isinstance(payload.get("output_text"), str) else None
