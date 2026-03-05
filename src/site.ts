const STYLE = `
:root {
  --bg: #f7fafc;
  --ink: #0f172a;
  --muted: #475569;
  --card: #ffffff;
  --line: #d7e0ea;
  --accent: #0284c7;
  --ok: #15803d;
  --warn: #b45309;
  --bad: #b91c1c;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, -apple-system, sans-serif;
  color: var(--ink);
  background: radial-gradient(circle at 12% 15%, #dbeafe, var(--bg));
}
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 56px; }
h1 { margin: 0 0 8px; }
.meta { color: var(--muted); margin: 0 0 18px; }
.controls {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin-bottom: 16px;
}
.control {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
}
.control label {
  display: block;
  font-size: 0.82rem;
  color: var(--muted);
  margin-bottom: 6px;
}
select, input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  font-size: 0.95rem;
}
.jobs { display: grid; gap: 12px; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.top { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; flex-wrap: wrap; }
.labels { color: var(--muted); font-size: 0.9rem; }
.summary { margin: 10px 0 0; color: var(--muted); white-space: pre-wrap; }
.pill { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; margin-right: 6px; margin-bottom: 6px; font-size: 0.8rem; }
.quality { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.grade-A, .grade-B { color: var(--ok); }
.grade-C { color: var(--warn); }
.grade-D, .grade-F { color: var(--bad); }
.hidden { display: none !important; }
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
  completeness_score?: number;
  completeness_grade?: "A" | "B" | "C" | "D" | "F";
  missing_fields?: string[];
  contact_channels?: string[];
  timezone?: string | null;
  employment_type?: string | null;
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
    <section class="controls">
      <div class="control"><label for="sort">Sort</label><select id="sort"><option value="latest">Latest</option><option value="quality">Highest quality</option><option value="quality-asc">Lowest quality</option></select></div>
      <div class="control"><label for="grade">Minimum quality grade</label><select id="grade"><option value="all">All grades</option><option value="A">A+</option><option value="B">B+</option><option value="C">C+</option><option value="D">D+</option><option value="F">F only</option></select></div>
      <div class="control"><label for="missing">Missing field</label><select id="missing"><option value="all">Any</option><option value="company">company</option><option value="location">location</option><option value="salary">salary</option><option value="responsibilities">responsibilities</option><option value="contact">contact</option></select></div>
      <div class="control"><label for="search">Search</label><input id="search" placeholder="company, title, labels" /></div>
    </section>
    <section class="jobs" id="jobs">${cards}</section>
  </main>
  <script>
    (function () {
      const order = { A: 5, B: 4, C: 3, D: 2, F: 1 };
      const jobs = document.getElementById('jobs');
      const cards = Array.from(jobs.querySelectorAll('article'));
      const sortEl = document.getElementById('sort');
      const gradeEl = document.getElementById('grade');
      const missingEl = document.getElementById('missing');
      const searchEl = document.getElementById('search');

      function apply() {
        const minGrade = gradeEl.value;
        const missingField = missingEl.value;
        const q = searchEl.value.trim().toLowerCase();

        cards.forEach((card) => {
          const grade = card.dataset.grade || 'F';
          const missing = (card.dataset.missing || '').split(',').filter(Boolean);
          const text = (card.dataset.search || '').toLowerCase();

          const gradeOk = minGrade === 'all' || (minGrade === 'F' ? grade === 'F' : order[grade] >= order[minGrade]);
          const missingOk = missingField === 'all' || missing.includes(missingField);
          const searchOk = !q || text.includes(q);

          card.classList.toggle('hidden', !(gradeOk && missingOk && searchOk));
        });

        const visible = cards.filter((card) => !card.classList.contains('hidden'));
        const sorted = visible.slice().sort((a, b) => {
          const aTime = Date.parse(a.dataset.created || '') || 0;
          const bTime = Date.parse(b.dataset.created || '') || 0;
          const aScore = Number(a.dataset.score || 0);
          const bScore = Number(b.dataset.score || 0);
          if (sortEl.value === 'quality') return bScore - aScore || bTime - aTime;
          if (sortEl.value === 'quality-asc') return aScore - bScore || bTime - aTime;
          return bTime - aTime;
        });
        sorted.forEach((node) => jobs.appendChild(node));
      }

      [sortEl, gradeEl, missingEl].forEach((el) => el.addEventListener('change', apply));
      searchEl.addEventListener('input', apply);
      apply();
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
  const labels = escapeHtml((row.labels || []).join(", ") || "-");
  const summary = escapeHtml((row.summary || "").trim());
  const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
  const grade = row.completeness_grade || "F";
  const missing = row.missing_fields || [];
  const missingText = missing.length ? escapeHtml(missing.join(", ")) : "none";
  const contacts = row.contact_channels?.length ? escapeHtml(row.contact_channels.join(", ")) : "-";
  const timezone = row.timezone ? escapeHtml(row.timezone) : "-";
  const employmentType = row.employment_type ? escapeHtml(row.employment_type) : "-";
  const search = [row.title, row.company, row.location, row.labels?.join(" "), row.summary].filter(Boolean).join(" ");

  return `<article data-score="${score}" data-grade="${grade}" data-missing="${escapeHtml(missing.join(","))}" data-created="${escapeHtml(row.created_at || "")}" data-search="${escapeHtml(search)}"><div class="top"><a href="${url}"><strong>${title}</strong></a><span class="labels">#${row.number} · ${created}</span></div><p>${company}${location}${salary}${remote}</p><p class="quality"><span class="pill grade-${grade}">Quality ${grade} (${score})</span><span class="pill">Missing: ${missingText}</span><span class="pill">Timezone: ${timezone}</span><span class="pill">Employment: ${employmentType}</span></p><p class="labels">Contact: ${contacts}</p><p class="labels">Labels: ${labels}</p><p class="summary">${summary}</p></article>`;
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
