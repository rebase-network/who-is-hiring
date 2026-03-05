from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

FIELD_RE = re.compile(r"^\s*(?P<key>[\w\s/\-]+?)\s*[:：]\s*(?P<value>.+)$")
SALARY_RE = re.compile(r"(?:\$|USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|K|k|万|千|\d+[-~]\d+)")
REMOTE_RE = re.compile(r"\bremote\b|远程|居家|在家", re.IGNORECASE)


@dataclass
class ParsedIssue:
    title: str
    company: str | None
    location: str | None
    salary: str | None
    remote: bool
    summary: str
    fields: dict[str, str]


def parse_issue_text(title: str, body: str | None) -> ParsedIssue:
    content = (body or "").strip()
    fields = _extract_fields(content)
    summary = _extract_summary(content)

    company = fields.get("company") or fields.get("company name") or _guess_company(title)
    location = fields.get("location") or _guess_location(title, content)
    salary = fields.get("salary") or _guess_salary(title, content)
    remote = bool(fields.get("remote")) or bool(REMOTE_RE.search(f"{title}\n{content}"))

    return ParsedIssue(
        title=title.strip(),
        company=_clean(company),
        location=_clean(location),
        salary=_clean(salary),
        remote=remote,
        summary=summary,
        fields=fields,
    )


def issue_to_normalized(issue: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_issue_text(issue.get("title", ""), issue.get("body"))
    labels = [label["name"] for label in issue.get("labels", []) if isinstance(label, dict) and label.get("name")]

    return {
        "id": issue["id"],
        "number": issue["number"],
        "url": issue["html_url"],
        "title": parsed.title,
        "company": parsed.company,
        "location": parsed.location,
        "salary": parsed.salary,
        "remote": parsed.remote,
        "state": issue["state"],
        "labels": labels,
        "created_at": issue.get("created_at"),
        "updated_at": issue.get("updated_at"),
        "closed_at": issue.get("closed_at"),
        "summary": parsed.summary,
        "raw_body": issue.get("body") or "",
        "author": (issue.get("user") or {}).get("login"),
    }


def _extract_fields(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in body.splitlines():
        matched = FIELD_RE.match(line)
        if not matched:
            continue
        key = matched.group("key").strip().lower()
        value = matched.group("value").strip()
        fields[key] = value
    return fields


def _extract_summary(body: str) -> str:
    for paragraph in re.split(r"\n\s*\n", body):
        text = paragraph.strip()
        if text:
            return text[:400]
    return ""


def _guess_location(title: str, body: str) -> str | None:
    bracket = re.search(r"\[([^\]]+)\]", title)
    if bracket:
        return bracket.group(1)
    for key in ("base", "onsite", "office"):
        matched = re.search(rf"{key}\s*[:：]\s*([^\n]+)", body, flags=re.IGNORECASE)
        if matched:
            return matched.group(1).strip()
    return None


def _guess_salary(title: str, body: str) -> str | None:
    text = f"{title}\n{body}"
    if not SALARY_RE.search(text):
        return None
    matched = re.search(r"([\$]?[0-9][0-9,\.\-\s]{2,30}\s*(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|K|k|万|千)?)", text)
    return matched.group(1).strip() if matched else None


def _guess_company(title: str) -> str | None:
    matched = re.search(r"([A-Za-z][A-Za-z0-9&\-\.\s]{1,50})(?:\s+(?:is looking|hiring|诚聘|招聘))", title, flags=re.IGNORECASE)
    return matched.group(1).strip() if matched else None


def _clean(value: str | None) -> str | None:
    if not value:
        return None
    compact = re.sub(r"\s+", " ", value).strip()
    return compact or None
