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
  responsibilities?: string | null;
};

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
button.load-more {
  margin-top: 18px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.95rem;
  cursor: pointer;
}
button.load-more[disabled] { cursor: default; opacity: 0.6; }
.detail-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.section-title { margin: 0 0 8px; font-size: 1rem; }
.section-body { margin: 0; white-space: pre-wrap; line-height: 1.5; }
.back-link { display: inline-block; margin-bottom: 14px; }
.cta { margin-top: 14px; font-weight: 600; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
`;

export function jobDetailPath(issueNumber: number): string {
  return `jobs/${issueNumber}.html`;
}

export function buildIndex(records: SiteRow[], repo: string): string {
  const generatedAtIso = new Date().toISOString();

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
    <section class="jobs" id="jobs"></section>
    <button id="load-more" class="load-more" type="button" hidden>Load more jobs</button>
    <p id="status" class="meta-line"></p>
    <noscript><p class="meta-line">Enable JavaScript to load jobs from the static JSON feed.</p></noscript>
  </main>
  <script>
    (function () {
      const PAGE_SIZE = 24;
      const jobsRoot = document.getElementById('jobs');
      const loadMore = document.getElementById('load-more');
      const status = document.getElementById('status');
      const updated = document.getElementById('updated-at');
      let jobs = [];
      let cursor = 0;

      if (updated && updated.dateTime) {
        const dt = new Date(updated.dateTime);
        if (!Number.isNaN(dt.getTime())) {
          updated.textContent = dt.toLocaleString();
        }
      }

      function escapeHtml(input) {
        return String(input)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderBatch() {
        if (!jobsRoot) return;
        const next = jobs.slice(cursor, cursor + PAGE_SIZE);
        if (!next.length) return;

        const html = next.map((row) => {
          const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
          const grade = row.completeness_grade || 'F';
          const missing = Array.isArray(row.missing_fields) ? row.missing_fields : [];
          const missingText = missing.length ? escapeHtml(missing.join(', ')) : 'none';
          const contacts = Array.isArray(row.contact_channels) && row.contact_channels.length
            ? escapeHtml(row.contact_channels.join(', '))
            : '-';
          const timezone = row.timezone ? escapeHtml(row.timezone) : '-';
          const employmentType = row.employment_type ? escapeHtml(row.employment_type) : '-';
          const created = escapeHtml(String(row.created_at || '').slice(0, 10));
          const summary = escapeHtml(String(row.summary || '').trim());
          const detailPath = escapeHtml('jobs/' + row.number + '.html');

          return '<article>' +
            '<div class="top"><a href="' + detailPath + '"><strong>' + escapeHtml(row.title || 'Untitled role') + '</strong></a><span class="meta-line">#' + escapeHtml(row.number) + ' · ' + created + '</span></div>' +
            '<p>' +
              (row.company ? '<span class="pill">Company: ' + escapeHtml(row.company) + '</span>' : '') +
              (row.location ? '<span class="pill">Location: ' + escapeHtml(row.location) + '</span>' : '') +
              (row.salary ? '<span class="pill">Salary: ' + escapeHtml(row.salary) + '</span>' : '') +
              (row.remote ? '<span class="pill">Remote</span>' : '') +
            '</p>' +
            '<p class="quality"><span class="pill grade-' + grade + '">Quality ' + grade + ' (' + score + ')</span><span class="pill">Missing: ' + missingText + '</span><span class="pill">Timezone: ' + timezone + '</span><span class="pill">Employment: ' + employmentType + '</span></p>' +
            '<p class="meta-line">Contact: ' + contacts + '</p>' +
            '<p class="summary">' + summary + '</p>' +
          '</article>';
        }).join('');

        jobsRoot.insertAdjacentHTML('beforeend', html);
        cursor += next.length;

        if (status) {
          status.textContent = 'Showing ' + cursor + ' of ' + jobs.length + ' open jobs';
        }

        if (loadMore) {
          loadMore.hidden = cursor >= jobs.length;
          loadMore.disabled = cursor >= jobs.length;
        }
      }

      fetch('jobs.normalized.json')
        .then((response) => {
          if (!response.ok) {
            throw new Error('Failed to load jobs');
          }
          return response.json();
        })
        .then((payload) => {
          jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
          renderBatch();
          if (loadMore) {
            loadMore.hidden = jobs.length <= PAGE_SIZE;
            loadMore.addEventListener('click', renderBatch);
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'Unable to load jobs right now. Please refresh in a moment.';
          }
        });
    })();
  </script>
</body>
</html>
`;
}

export function buildJobDetailPage(row: SiteRow, repo: string): string {
  const generatedAtIso = new Date().toISOString();
  const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
  const grade = row.completeness_grade || "F";
  const missing = row.missing_fields || [];
  const missingText = missing.length ? escapeHtml(missing.join(", ")) : "none";
  const contacts = row.contact_channels?.length ? escapeHtml(row.contact_channels.join("\n")) : "-";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(row.title)} · Who is Hiring</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <a class="back-link" href="../index.html">← Back to jobs</a>
    <h1>${escapeHtml(row.title || "Untitled role")}</h1>
    <p class="meta">Issue #${row.number} · Updated <time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time></p>

    <section class="detail-grid">
      ${detailCard("Company", row.company)}
      ${detailCard("Role", row.title)}
      ${detailCard("Location", row.location)}
      ${detailCard("Salary", row.salary)}
      ${detailCard("Employment Type", row.employment_type)}
      ${detailCard("Timezone", row.timezone)}
      ${detailCard("Remote", row.remote ? "Yes" : "No")}
    </section>

    ${detailBlock("Responsibilities", row.responsibilities || selectDisplaySummary(row.summary, row.raw_body))}
    ${detailBlock("Contact", contacts)}

    <section>
      <h2 class="section-title">Completeness Metadata</h2>
      <p class="section-body">Score: ${score} · Grade: <span class="grade-${grade}">${grade}</span></p>
      <p class="section-body">Missing fields: ${missingText}</p>
      <p class="section-body">Labels: ${escapeHtml((row.labels || []).join(", ") || "none")}</p>
    </section>

    <p class="cta"><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer noopener">View original GitHub issue</a></p>
    <p class="meta-line">Source repository: <a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a></p>
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

function detailCard(label: string, value?: string | null): string {
  return `<article><h2 class="section-title">${escapeHtml(label)}</h2><p class="section-body">${escapeHtml(value || "-")}</p></article>`;
}

function detailBlock(label: string, body: string): string {
  return `<section><h2 class="section-title">${escapeHtml(label)}</h2><p class="section-body">${escapeHtml(body || "-")}</p></section>`;
}

export function selectDisplaySummary(summary?: string, rawBody?: string): string {
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

export function pickMeaningfulParagraph(body: string): string {
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

function escapeHtml(input: string | number): string {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
