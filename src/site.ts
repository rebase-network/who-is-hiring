type ScoreBreakdownValue = {
  earned?: number;
  max?: number;
  source?: string | null;
};

type ListRow = {
  number: number;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
  rss_updated_at?: string | null;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  remote?: boolean;
  completeness_score?: number;
  completeness_grade?: "A" | "B" | "C" | "D" | "F";
  missing_fields?: string[];
  weak_fields?: string[];
  risk_flags?: string[];
  contact_channels?: string[];
  timezone?: string | null;
  employment_type?: string | null;
  decision_value_score?: number;
  credibility_score?: number;
  summary?: string;
};

type DetailSection = {
  title: string;
  paragraphs: string[];
  bullets: string[];
};

type DetailRow = {
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
  narrative?: string[];
  responsibilities?: string[];
  requirements?: string[];
  compensation_notes?: string[];
  contact_details?: string[];
  sections?: DetailSection[];
  completeness_score?: number;
  completeness_grade?: "A" | "B" | "C" | "D" | "F";
  missing_fields?: string[];
  weak_fields?: string[];
  risk_flags?: string[];
  comment_supplemented_fields?: string[];
  score_breakdown?: Record<string, ScoreBreakdownValue>;
  decision_value_score?: number;
  credibility_score?: number;
  timezone?: string | null;
  employment_type?: string | null;
};

const BRAND = "谁在招聘 Who Is Hiring";
const INDEX_TITLE = `${BRAND} - 职位列表`;
const DISCLAIMER = "免责声明：Rebase 社区的所有招聘信息均由招聘方自行发布，平台仅负责排版与编辑，不对其合法性与真实性承担责任，请注意甄别。";

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
  overflow-x: hidden;
}
.top { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; flex-wrap: wrap; }
.top a { min-width: 0; overflow-wrap: anywhere; }
.meta-line { color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }
.summary { margin: 10px 0 0; color: #3f3933; white-space: pre-wrap; line-height: 1.45; overflow-wrap: anywhere; }
.pill {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
  margin-right: 6px;
  margin-bottom: 6px;
  font-size: 0.8rem;
  background: #fff;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.quality { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.grade-A, .grade-B { color: var(--ok); }
.grade-C { color: var(--warn); }
.grade-D, .grade-F { color: var(--bad); }
.mini-list { margin: 8px 0 0; color: var(--muted); font-size: 0.9rem; line-height: 1.45; }
.score-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 10px; }
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
.section-title { margin: 0 0 8px; font-size: 1rem; overflow-wrap: anywhere; }
.section-body { margin: 0; white-space: pre-wrap; line-height: 1.5; overflow-wrap: anywhere; }
.back-link { display: inline-block; margin-bottom: 14px; }
.cta { margin-top: 14px; font-weight: 600; }
ul.section-body { padding-left: 20px; }
a { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
a:hover { text-decoration: underline; }

@media (max-width: 720px) {
  main {
    padding: 20px 12px 40px;
  }

  h1 {
    font-size: 1.35rem;
    line-height: 1.25;
  }

  article {
    padding: 12px;
    border-radius: 12px;
  }

  .top {
    align-items: flex-start;
    gap: 6px;
  }

  .top .meta-line {
    width: 100%;
    font-size: 0.84rem;
  }

  .meta,
  .summary,
  .section-body {
    font-size: 0.93rem;
    line-height: 1.5;
  }

  .pill {
    font-size: 0.76rem;
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .quality {
    gap: 4px;
  }

  .detail-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  button.load-more {
    width: 100%;
  }
}

@media (max-width: 420px) {
  main {
    padding: 16px 10px 30px;
  }

  h1 {
    font-size: 1.2rem;
  }

  .meta-line,
  .meta,
  .summary,
  .section-body {
    font-size: 0.88rem;
  }

  ul.section-body {
    padding-left: 18px;
  }
}
`;

export function jobDetailPath(issueNumber: number): string {
  return `jobs/${issueNumber}.html`;
}

export function buildIndex(records: ListRow[], repo: string, siteUrl: string): string {
  const generatedAtIso = new Date().toISOString();
  const canonical = absoluteUrl(siteUrl, "index.html");
  const description = `基于 GitHub Issue 的招聘信息看板，实时聚合 ${repo} 的开放岗位。`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(INDEX_TITLE)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(BRAND)} RSS" href="${escapeHtml(absoluteUrl(siteUrl, "feed.xml"))}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:site_name" content="${escapeHtml(BRAND)}" />
  <meta property="og:title" content="${escapeHtml(INDEX_TITLE)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(INDEX_TITLE)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="last-modified" content="${generatedAtIso}" />
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(BRAND)}</h1>
    <p class="meta">这个仓库是由 Rebase 社区创建的，为区块链行业以及其他各行各业的企业和团队提供招聘信息披露机会，所有招聘信息都将在 Rebase 社区的所有媒体上进行发表。这是免费的！最近更新时间：<time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time>。</p>
    <p class="meta-line"><a href="feed.xml">RSS 订阅</a> · <a href="jobs.normalized.json">JSON 数据</a> · <a href="sitemap.xml">Sitemap</a></p>
    <p class="meta-line">支持通过 RSS 订阅最新开放岗位：将 <a href="feed.xml">feed.xml</a> 添加到你的阅读器即可。</p>
    <p class="meta-line">${escapeHtml(DISCLAIMER)}</p>
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
          const weak = Array.isArray(row.weak_fields) ? row.weak_fields : [];
          const riskFlags = Array.isArray(row.risk_flags) ? row.risk_flags : [];
          const missingText = missing.length ? escapeHtml(missing.join(', ')) : '无';
          const weakText = weak.length ? escapeHtml(weak.join(', ')) : '无';
          const riskText = riskFlags.length ? escapeHtml(riskFlags.join(', ')) : '无';
          const contacts = Array.isArray(row.contact_channels) && row.contact_channels.length
            ? escapeHtml(row.contact_channels.join(', '))
            : '-';
          const timezone = row.timezone ? escapeHtml(row.timezone) : '-';
          const employmentType = row.employment_type ? escapeHtml(row.employment_type) : '-';
          const decisionValue = Number.isFinite(row.decision_value_score) ? row.decision_value_score : 0;
          const credibility = Number.isFinite(row.credibility_score) ? row.credibility_score : 0;
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
            '<p class="quality"><span class="pill grade-' + grade + '">质量 ' + grade + ' (' + score + ')</span><span class="pill">决策分：' + decisionValue + '</span><span class="pill">可信分：' + credibility + '</span><span class="pill">时区：' + timezone + '</span><span class="pill">雇佣类型：' + employmentType + '</span></p>' +
            '<p class="meta-line">联系方式：' + contacts + '</p>' +
            '<p class="mini-list">缺失字段：' + missingText + ' · 薄弱字段：' + weakText + ' · 风险标记：' + riskText + '</p>' +
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
          jobs = Array.isArray(payload.jobs)
            ? payload.jobs.filter((row) => String(row.state || '').toLowerCase() === 'open')
            : [];
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

export function buildJobDetailPage(row: DetailRow, repo: string, siteUrl: string): string {
  const generatedAtIso = new Date().toISOString();
  const score = Number.isFinite(row.completeness_score) ? row.completeness_score : 0;
  const grade = row.completeness_grade || "F";
  const missing = row.missing_fields || [];
  const weak = row.weak_fields || [];
  const riskFlags = row.risk_flags || [];
  const commentSupplemented = row.comment_supplemented_fields || [];
  const missingText = missing.length ? escapeHtml(missing.join(", ")) : "无";
  const weakText = weak.length ? escapeHtml(weak.join(", ")) : "无";
  const riskText = riskFlags.length ? escapeHtml(riskFlags.join(", ")) : "无";
  const commentSupplementedText = commentSupplemented.length ? escapeHtml(commentSupplemented.join(", ")) : "无";

  const detailPath = jobDetailPath(row.number);
  const canonical = absoluteUrl(siteUrl, detailPath);
  const description = toDescription(
    row.summary || row.narrative?.[0] || row.responsibilities?.[0] || "",
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
    hiringOrganization: row.company ? { "@type": "Organization", name: row.company } : undefined,
    jobLocationType: row.remote ? "TELECOMMUTE" : undefined,
    jobLocation: row.location ? { "@type": "Place", address: row.location } : undefined,
    baseSalary: row.salary ? { "@type": "MonetaryAmount", value: row.salary } : undefined,
    validThrough: generatedAtIso,
    url: canonical,
    sameAs: row.url,
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(row.title)} - ${escapeHtml(BRAND)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:site_name" content="${escapeHtml(BRAND)}" />
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
    <a class="back-link" href="../index.html">← 返回 ${escapeHtml(BRAND)}</a>
    <h1>${escapeHtml(row.title || "未命名职位")}</h1>
    <p class="meta">${escapeHtml(BRAND)} · Issue #${row.number} · 最近更新时间：<time id="updated-at" datetime="${generatedAtIso}">${generatedAtIso}</time></p>

    <section class="detail-grid">
      ${detailCard("公司", row.company)}
      ${detailCard("职位", row.title)}
      ${detailCard("地点", row.location)}
      ${detailCard("薪资", row.salary)}
      ${detailCard("雇佣类型", row.employment_type)}
      ${detailCard("时区", row.timezone)}
      ${detailCard("远程", row.remote ? "是" : "否")}
    </section>

    ${detailBlock("职位概述", row.summary || row.narrative?.[0] || "-")}
    ${renderListBlock("职责描述", row.responsibilities || [])}
    ${renderListBlock("任职要求", row.requirements || [])}
    ${renderListBlock("薪酬说明", row.compensation_notes || [])}
    ${renderListBlock("联系方式", row.contact_details || [])}
    ${renderNarrative(row.narrative || [])}
    ${renderSections(row.sections || [])}

    <section>
      <h2 class="section-title">完整度元数据</h2>
      <div class="score-grid">
        ${detailCard("总分", `${score}`)}
        ${detailCard("等级", grade)}
        ${detailCard("候选人决策分", String(row.decision_value_score ?? 0))}
        ${detailCard("可信度分", String(row.credibility_score ?? 0))}
      </div>
      <p class="section-body">缺失字段：${missingText}</p>
      <p class="section-body">薄弱字段：${weakText}</p>
      <p class="section-body">风险标记：${riskText}</p>
      <p class="section-body">仅评论补充字段：${commentSupplementedText}</p>
      ${renderScoreBreakdown(row.score_breakdown || {})}
      <p class="section-body">标签：${escapeHtml((row.labels || []).join(", ") || "无")}</p>
    </section>

    <p class="cta"><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer noopener">查看原始 GitHub Issue</a></p>
    <p class="meta-line">${escapeHtml(DISCLAIMER)}</p>
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

function renderListBlock(label: string, items: string[]): string {
  if (!items.length) {
    return detailBlock(label, "-");
  }
  const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<section><h2 class="section-title">${escapeHtml(label)}</h2><ul class="section-body">${list}</ul></section>`;
}

function renderScoreBreakdown(breakdown: Record<string, ScoreBreakdownValue>): string {
  const rows = Object.entries(breakdown)
    .filter(([, value]) => value && (value.max ?? 0) > 0)
    .map(([key, value]) => {
      const earned = typeof value.earned === "number" ? value.earned : 0;
      const max = typeof value.max === "number" ? value.max : 0;
      const source = value.source ? ` · 来源：${escapeHtml(value.source)}` : "";
      return `<li>${escapeHtml(key)}：${earned}/${max}${source}</li>`;
    })
    .join("");

  if (!rows) {
    return "";
  }
  return `<section><h2 class="section-title">评分明细</h2><ul class="section-body">${rows}</ul></section>`;
}

function renderNarrative(items: string[]): string {
  const narrative = items.filter((item) => item.length > 80).slice(0, 4);
  if (!narrative.length) {
    return "";
  }
  return detailBlock("项目叙述", narrative.join("\n\n"));
}

function renderSections(sections: DetailSection[]): string {
  const output = sections
    .filter((section) => !/Responsibilities|Requirements|Contact/i.test(section.title))
    .map((section) => {
      const paragraphs = section.paragraphs.join("\n");
      const bullets = section.bullets.map((bullet) => `- ${bullet}`).join("\n");
      const body = [paragraphs, bullets].filter(Boolean).join("\n").trim();
      if (!body) {
        return "";
      }
      return detailBlock(section.title, body);
    })
    .filter(Boolean)
    .join("\n");

  return output;
}

export function buildRssFeed(rows: ListRow[], repo: string, siteUrl: string, generatedAt = new Date().toISOString()): string {
  const indexUrl = absoluteUrl(siteUrl, "index.html");
  const feedUrl = absoluteUrl(siteUrl, "feed.xml");
  const sortedRows = [...rows].sort((a, b) => {
    const left = effectiveRssTimestamp(a) ?? "";
    const right = effectiveRssTimestamp(b) ?? "";
    return right.localeCompare(left);
  });
  const lastBuildDate = toRfc822Date(generatedAt) ?? new Date().toUTCString();

  const items = sortedRows
    .map((row) => {
      const link = absoluteUrl(siteUrl, jobDetailPath(row.number));
      const pubDate = toRfc822Date(effectiveRssTimestamp(row) ?? generatedAt) ?? new Date().toUTCString();
      const description = [
        row.company ? `公司：${row.company}` : null,
        row.location ? `地点：${row.location}` : null,
        row.salary ? `薪资：${row.salary}` : null,
        row.remote ? "支持远程" : null,
        row.summary ? row.summary.trim() : null,
      ].filter(Boolean).join("\n");

      return [
        "<item>",
        `<title>${escapeXml(row.title || "未命名职位")}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid>${escapeXml(link)}</guid>`,
        `<pubDate>${escapeXml(pubDate)}</pubDate>`,
        `<description>${escapeXml(description || "职位详情请打开链接查看。")}</description>`,
        "</item>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escapeXml(BRAND)}</title>`,
    `<link>${escapeXml(indexUrl)}</link>`,
    `<description>${escapeXml(`${BRAND} 开放职位总订阅，数据来自 ${repo}。`)}</description>`,
    '<language>zh-CN</language>',
    `<lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    '</channel>',
    '</rss>',
    '',
  ].join("\n");
}

export function buildSitemap(rows: Array<{ number: number; created_at?: string | null }>, siteUrl: string): string {
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
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${absoluteUrl(siteUrl, "sitemap.xml")}`, ""].join(
    "\n",
  );
}

export function selectDisplaySummary(summary?: string): string {
  return (summary ?? "").trim();
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

function toRfc822Date(value?: string | null): string | null {
  const iso = normalizeIsoTimestamp(value);
  return iso ? new Date(iso).toUTCString() : null;
}

function effectiveRssTimestamp(row: Pick<ListRow, "created_at" | "updated_at" | "rss_updated_at">): string | null {
  return normalizeIsoTimestamp(row.rss_updated_at) ?? normalizeIsoTimestamp(row.updated_at) ?? normalizeIsoTimestamp(row.created_at);
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
