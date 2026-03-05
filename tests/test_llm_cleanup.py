from wih.llm_cleanup import cleanup_records


def test_cleanup_records_is_noop_without_api_key(monkeypatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    records = [{"id": 1, "title": "x"}]
    assert cleanup_records(records) == records
