from wih.parser import issue_to_normalized, parse_issue_text


def test_parse_issue_text_extracts_known_fields() -> None:
    parsed = parse_issue_text(
        "[Remote] ACME is hiring Senior Backend Engineer",
        "Company: ACME\nLocation: Singapore\nSalary: 5000-7000 USD\n\nBuild infra",
    )
    assert parsed.company == "ACME"
    assert parsed.location == "Singapore"
    assert parsed.salary == "5000-7000 USD"
    assert parsed.remote is True
    assert parsed.summary == "Company: ACME\nLocation: Singapore\nSalary: 5000-7000 USD"


def test_issue_normalization_shape() -> None:
    issue = {
        "id": 1,
        "number": 10,
        "html_url": "https://github.com/rebase-network/who-is-hiring/issues/10",
        "title": "[HK] Example Co hiring QA Engineer",
        "body": "Remote: yes\nSalary: 30K-50K RMB",
        "labels": [{"name": "jobs"}],
        "state": "open",
        "created_at": "2026-03-04T10:00:00Z",
        "updated_at": "2026-03-04T10:00:00Z",
        "closed_at": None,
        "user": {"login": "alice"},
    }

    normalized = issue_to_normalized(issue)
    assert normalized["number"] == 10
    assert normalized["labels"] == ["jobs"]
    assert normalized["author"] == "alice"
    assert normalized["remote"] is True
