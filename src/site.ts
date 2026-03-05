const STYLE = `
:root {
  --bg: #f6f1e8;
  --ink: #1f1b16;
  --muted: #6b6258;
  --card: #fffaf2;
  --line: #dccfbd;
  --accent: #8a2d1c;
  --ok: #22673f;
  --warn: #9b5d05;
  --bad: #8f1919;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1100px 500px at 15% -5%, #e9dcc6 0%, transparent 70%),
    radial-gradient(900px 500px at 100% 0%, #f3e7d3 0%, transparent 65%),
    var(--bg);
}
main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 56px; }
h1 { margin: 0 0 6px; letter-spacing: 0.2px; }
.meta { color: var(--muted); margin: 0 0 18px; }
.jobs { display: grid; gap: 14px; }
article {
  background: linear-gradient(180deg, #fffdf8 0%, var(--card) 100%);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 8px 20px rgba(31, 27, 22, 0.06);
}
.top { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; flex-wrap: wrap; }
.meta-line { color: var(--muted); font-size: 0.9rem; }
.summary { margin: 10px 0 0; color: #3f3933; white-space: pre-wrap; line-height: 1.45; }
.pill {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
  margin-right: 6px;
  margin-bottom: 6px;
  font-size: 0.8rem;
  background: #fff;
}
.quality { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.grade-A, .grade-B { color: var(--ok); }
.grade-C { color: var(--warn); }
.grade-D, .grade-F { color: var(--bad); }
a { color: var(--accent); text-decoration: none; }
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
  raw_body?: string;
  completeness_score?: number;
  completeness_grade?: "A" | "B" | "C" | "D" | "F";
  missing_fields?: string[];
  contact_channels?: string[];
  timezone?: string | null;
  employment_type?: string | null;
};

export function buildIndex(records: SiteRow[], repo: string): string {
  const generatedAtIso = new Date().toISOString();
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
    <p class="meta">Issue-driven jobs board for <a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a>. Updated <time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time>.</p>
    <section class="jobs" id="jobs">${cards}</section>
  </main>
  <script>
    (function () {
      const updated = document.getElementById('updated-at');
      if (updated && updated.dateTime) {
        const dt = new Date(updated.dateTime);
        if (!Number.isNaN(dt.getTime())) {
          updated.textContent = dt.toLocaleString();
        }
      }
    })();
  </script>
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
  const summary = escapeHtml(selectDisplaySummary(row.summary, row.raw_body));
  const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
  const grade = row.completeness_grade || "F";
  const missing = row.missing_fields || [];
  const missingText = missing.length ? escapeHtml(missing.join(", ")) : "none";
  const contacts = row.contact_channels?.length ? escapeHtml(row.contact_channels.join(", ")) : "-";
  const timezone = row.timezone ? escapeHtml(row.timezone) : "-";
  const employmentType = row.employment_type ? escapeHtml(row.employment_type) : "-";
  const search = [row.title, row.company, row.location, row.summary].filter(Boolean).join(" ");

  return `<article data-score="${score}" data-grade="${grade}" data-missing="${escapeHtml(missing.join(","))}" data-created="${escapeHtml(row.created_at || "")}" data-search="${escapeHtml(search)}"><div class="top"><a href="${url}"><strong>${title}</strong></a><span class="meta-line">#${row.number} · ${created}</span></div><p>${company}${location}${salary}${remote}</p><p class="quality"><span class="pill grade-${grade}">Quality ${grade} (${score})</span><span class="pill">Missing: ${missingText}</span><span class="pill">Timezone: ${timezone}</span><span class="pill">Employment: ${employmentType}</span></p><p class="meta-line">Contact: ${contacts}</p><p class="summary">${summary}</p></article>`;
}

function selectDisplaySummary(summary?: string, rawBody?: string): string {
  const cleanedSummary = (summary ?? "").trim();
  if (cleanedSummary.length >= 60) {
    return cleanedSummary;
  }

  const fallback = pickMeaningfulParagraph(rawBody ?? "");
  if (fallback) {
    return fallback;
  }

  return cleanedSummary;
}

function pickMeaningfulParagraph(body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (/^(job\s*title|title|location|company|salary|薪资|职位|岗位|工作地点|地点)\s*[:：]/i.test(paragraph)) {
      continue;
    }
    if (paragraph.length >= 40) {
      return paragraph.slice(0, 400);
    }
  }

  return paragraphs[0]?.slice(0, 400) ?? "";
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
