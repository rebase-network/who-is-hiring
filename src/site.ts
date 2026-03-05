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

export function buildIndex(records: SiteRow[], repo: string, siteUrl: string): string {
  const generatedAtIso = new Date().toISOString();
  const canonical = absoluteUrl(siteUrl, "index.html");
  const description = `基于 GitHub Issue 的招聘信息看板，实时聚合 ${repo} 的开放岗位。`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>谁在招聘 - 职位列表</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:site_name" content="谁在招聘" />
  <meta property="og:title" content="谁在招聘 - 职位列表" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="谁在招聘 - 职位列表" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="last-modified" content="${generatedAtIso}" />
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>谁在招聘</h1>
    <p class="meta">来自 <a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a> 的 Issue 驱动职位看板。最近更新时间：<time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time>。</p>
    <section class="jobs" id="jobs"></section>
    <button id="load-more" class="load-more" type="button" hidden>加载更多职位</button>
    <p id="status" class="meta-line"></p>
    <noscript><p class="meta-line">请启用 JavaScript，以从静态 JSON 数据源加载职位。</p></noscript>
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

      function toLocalDateTime(value) {
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) return value;
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(dt);
      }

      if (updated && updated.dateTime) {
        updated.textContent = toLocalDateTime(updated.dateTime);
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
          const missingText = missing.length ? escapeHtml(missing.join(', ')) : '无';
          const contacts = Array.isArray(row.contact_channels) && row.contact_channels.length
            ? escapeHtml(row.contact_channels.join(', '))
            : '-';
          const timezone = row.timezone ? escapeHtml(row.timezone) : '-';
          const employmentType = row.employment_type ? escapeHtml(row.employment_type) : '-';
          const createdIso = String(row.created_at || '');
          const createdLabel = createdIso ? toLocalDateTime(createdIso) : '-';
          const summary = escapeHtml(String(row.summary || '').trim());
          const detailPath = escapeHtml('jobs/' + row.number + '.html');

          return '<article>' +
            '<div class="top"><a href="' + detailPath + '"><strong>' + escapeHtml(row.title || '未命名职位') + '</strong></a><span class="meta-line">#' + escapeHtml(row.number) + ' · ' + escapeHtml(createdLabel) + '</span></div>' +
            '<p>' +
              (row.company ? '<span class="pill">公司：' + escapeHtml(row.company) + '</span>' : '') +
              (row.location ? '<span class="pill">地点：' + escapeHtml(row.location) + '</span>' : '') +
              (row.salary ? '<span class="pill">薪资：' + escapeHtml(row.salary) + '</span>' : '') +
              (row.remote ? '<span class="pill">远程</span>' : '') +
            '</p>' +
            '<p class="quality"><span class="pill grade-' + grade + '">质量 ' + grade + ' (' + score + ')</span><span class="pill">缺失字段：' + missingText + '</span><span class="pill">时区：' + timezone + '</span><span class="pill">雇佣类型：' + employmentType + '</span></p>' +
            '<p class="meta-line">联系方式：' + contacts + '</p>' +
            '<p class="summary">' + summary + '</p>' +
          '</article>';
        }).join('');

        jobsRoot.insertAdjacentHTML('beforeend', html);
        cursor += next.length;

        if (status) {
          status.textContent = '已显示 ' + cursor + ' / ' + jobs.length + ' 个开放职位';
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
            status.textContent = '职位加载失败，请稍后刷新重试。';
          }
        });
    })();
  </script>
</body>
</html>
`;
}

export function buildJobDetailPage(row: SiteRow, repo: string, siteUrl: string): string {
  const generatedAtIso = new Date().toISOString();
  const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
  const grade = row.completeness_grade || "F";
  const missing = row.missing_fields || [];
  const missingText = missing.length ? escapeHtml(missing.join(", ")) : "无";
  const contacts = row.contact_channels?.length ? escapeHtml(row.contact_channels.join("\n")) : "-";

  const detailPath = jobDetailPath(row.number);
  const canonical = absoluteUrl(siteUrl, detailPath);
  const description = toDescription(
    row.summary || row.responsibilities || row.raw_body || "",
    row.company,
    row.location,
  );
  const postedIso = normalizeIsoTimestamp(row.created_at) ?? generatedAtIso;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: row.title || "未命名职位",
    description,
    datePosted: postedIso,
    dateModified: generatedAtIso,
    directApply: false,
    employmentType: row.employment_type || undefined,
    hiringOrganization: row.company
      ? {
          "@type": "Organization",
          name: row.company,
        }
      : undefined,
    jobLocationType: row.remote ? "TELECOMMUTE" : undefined,
    jobLocation: row.location
      ? {
          "@type": "Place",
          address: row.location,
        }
      : undefined,
    baseSalary: row.salary
      ? {
          "@type": "MonetaryAmount",
          value: row.salary,
        }
      : undefined,
    validThrough: generatedAtIso,
    url: canonical,
    sameAs: row.url,
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(row.title)} - 职位详情</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:site_name" content="谁在招聘" />
  <meta property="og:title" content="${escapeHtml(row.title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="article:published_time" content="${postedIso}" />
  <meta property="article:modified_time" content="${generatedAtIso}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(row.title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <style>${STYLE}</style>
  <script type="application/ld+json">${toJsonLd(structuredData)}</script>
</head>
<body>
  <main>
    <a class="back-link" href="../index.html">← 返回职位列表</a>
    <h1>${escapeHtml(row.title || "未命名职位")}</h1>
    <p class="meta">Issue #${row.number} · 最近更新时间：<time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time></p>

    <section class="detail-grid">
      ${detailCard("公司", row.company)}
      ${detailCard("职位", row.title)}
      ${detailCard("地点", row.location)}
      ${detailCard("薪资", row.salary)}
      ${detailCard("雇佣类型", row.employment_type)}
      ${detailCard("时区", row.timezone)}
      ${detailCard("远程", row.remote ? "是" : "否")}
    </section>

    ${detailBlock("职责描述", row.responsibilities || selectDisplaySummary(row.summary, row.raw_body))}
    ${detailBlock("联系方式", contacts)}

    <section>
      <h2 class="section-title">完整度元数据</h2>
      <p class="section-body">评分：${score} · 等级：<span class="grade-${grade}">${grade}</span></p>
      <p class="section-body">缺失字段：${missingText}</p>
      <p class="section-body">标签：${escapeHtml((row.labels || []).join(", ") || "无")}</p>
    </section>

    <p class="cta"><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer noopener">查看原始 GitHub Issue</a></p>
    <p class="meta-line">来源仓库：<a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a></p>
  </main>
  <script>
    (function () {
      const updated = document.getElementById('updated-at');
      if (updated && updated.dateTime) {
        const dt = new Date(updated.dateTime);
        if (!Number.isNaN(dt.getTime())) {
          updated.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(dt);
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

export function buildSitemap(rows: SiteRow[], siteUrl: string): string {
  const urls = [
    {
      loc: absoluteUrl(siteUrl, "index.html"),
      lastmod: new Date().toISOString(),
    },
    ...rows.map((row) => ({
      loc: absoluteUrl(siteUrl, jobDetailPath(row.number)),
      lastmod: normalizeIsoTimestamp(row.created_at) ?? new Date().toISOString(),
    })),
  ];

  const entries = urls
    .map(
      (item) =>
        `<url><loc>${escapeXml(item.loc)}</loc><lastmod>${escapeXml(item.lastmod)}</lastmod></url>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>\n`;
}

export function buildRobots(siteUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${absoluteUrl(siteUrl, "sitemap.xml")}`,
    "",
  ].join("\n");
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

function toDescription(text: string, company?: string | null, location?: string | null): string {
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 130);
  const parts = [company, location, excerpt].filter(Boolean);
  return (parts.join(" | ") || "职位详情页").slice(0, 160);
}

function normalizeIsoTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt.toISOString();
}

function absoluteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return new URL(path, base).toString();
}

function escapeHtml(input: string | number): string {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toJsonLd(input: unknown): string {
  return JSON.stringify(input)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}
