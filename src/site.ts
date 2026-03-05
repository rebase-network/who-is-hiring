const STYLE = `
:root { --bg:#f8fbff; --ink:#0f172a; --muted:#475569; --card:#ffffff; --line:#cbd5e1; --accent:#0ea5e9; }
* { box-sizing: border-box; }
body { margin:0; font-family: ui-sans-serif, -apple-system, sans-serif; color:var(--ink); background:radial-gradient(circle at 20% 20%, #e0f2fe, var(--bg)); }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 56px; }
h1 { margin-bottom: 6px; }
.meta { color: var(--muted); margin-bottom: 24px; }
.jobs { display: grid; gap: 12px; }
article { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }
.top { display:flex; gap:8px; justify-content:space-between; align-items:baseline; flex-wrap:wrap; }
.labels { color: var(--muted); font-size: 0.9rem; }
.summary { margin: 10px 0 0; color: var(--muted); white-space: pre-wrap; }
.pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 8px; margin-right:6px; font-size: 0.8rem; }
a { color: #0284c7; text-decoration: none; }
a:hover { text-decoration: underline; }
`;

type SiteRow = {
  number: number;
  title: string;
  url: string;
  created_at?: string | null;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  remote?: boolean;
  labels?: string[];
  summary?: string;
};

export function buildIndex(records: SiteRow[], repo: string): string {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const cards = records.map((row) => renderCard(row)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Who is Hiring</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>Who is Hiring</h1>
    <p class="meta">Issue-driven jobs board for <a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a>. Updated ${timestamp}.</p>
    <section class="jobs">${cards}</section>
  </main>
</body>
</html>
`;
}

function renderCard(row: SiteRow): string {
  const title = escapeHtml(row.title || "Untitled role");
  const url = escapeHtml(row.url || "#");
  const created = escapeHtml((row.created_at || "").slice(0, 10));
  const company = pill("Company", row.company);
  const location = pill("Location", row.location);
  const salary = pill("Salary", row.salary);
  const remote = row.remote ? '<span class="pill">Remote</span>' : "";
  const labels = escapeHtml((row.labels || []).join(", ") || "-");
  const summary = escapeHtml((row.summary || "").trim());

  return `<article><div class="top"><a href="${url}"><strong>${title}</strong></a><span class="labels">#${row.number} · ${created}</span></div><p>${company}${location}${salary}${remote}</p><p class="labels">Labels: ${labels}</p><p class="summary">${summary}</p></article>`;
}

function pill(name: string, value?: string | null): string {
  if (!value) {
    return "";
  }
  return `<span class="pill">${escapeHtml(name)}: ${escapeHtml(value)}</span>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
