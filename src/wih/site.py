from __future__ import annotations

import html
from datetime import datetime, timezone


def build_index(records: list[dict], repo: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cards = "\n".join(_render_card(row) for row in records)

    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>Who is Hiring</title>
  <style>
    :root {{ --bg:#f8fbff; --ink:#0f172a; --muted:#475569; --card:#ffffff; --line:#cbd5e1; --accent:#0ea5e9; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family: ui-sans-serif, -apple-system, sans-serif; color:var(--ink); background:radial-gradient(circle at 20% 20%, #e0f2fe, var(--bg)); }}
    main {{ max-width: 960px; margin: 0 auto; padding: 24px 16px 56px; }}
    h1 {{ margin-bottom: 6px; }}
    .meta {{ color: var(--muted); margin-bottom: 24px; }}
    .jobs {{ display: grid; gap: 12px; }}
    article {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }}
    .top {{ display:flex; gap:8px; justify-content:space-between; align-items:baseline; flex-wrap:wrap; }}
    .labels {{ color: var(--muted); font-size: 0.9rem; }}
    .summary {{ margin: 10px 0 0; color: var(--muted); white-space: pre-wrap; }}
    .pill {{ display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 8px; margin-right:6px; font-size: 0.8rem; }}
    a {{ color: #0284c7; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <main>
    <h1>Who is Hiring</h1>
    <p class=\"meta\">Issue-driven jobs board for <a href=\"https://github.com/{html.escape(repo)}\">{html.escape(repo)}</a>. Updated {timestamp}.</p>
    <section class=\"jobs\">{cards}</section>
  </main>
</body>
</html>
"""


def _render_card(row: dict) -> str:
    title = html.escape(row.get("title") or "Untitled role")
    url = html.escape(row.get("url") or "#")
    created = html.escape((row.get("created_at") or "")[:10])
    company = _pill("Company", row.get("company"))
    location = _pill("Location", row.get("location"))
    salary = _pill("Salary", row.get("salary"))
    remote = '<span class="pill">Remote</span>' if row.get("remote") else ""
    labels = ", ".join(row.get("labels") or [])
    summary = html.escape((row.get("summary") or "").strip())

    return (
        f"<article><div class=\"top\"><a href=\"{url}\"><strong>{title}</strong></a>"
        f"<span class=\"labels\">#{row.get('number')} · {created}</span></div>"
        f"<p>{company}{location}{salary}{remote}</p>"
        f"<p class=\"labels\">Labels: {html.escape(labels or '-')}</p>"
        f"<p class=\"summary\">{summary}</p></article>"
    )


def _pill(name: str, value: str | None) -> str:
    if not value:
        return ""
    return f'<span class="pill">{html.escape(name)}: {html.escape(value)}</span>'
