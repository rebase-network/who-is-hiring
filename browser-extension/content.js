(() => {
  if (window.__REBASE_HIRE_FILTER__) {
    return;
  }
  window.__REBASE_HIRE_FILTER__ = true;

  const JOBS_JSON = new URL("jobs.normalized.json", location.href).href;
  let jobsCache = null;
  let activeQuery = "";
  let activeIds = new Set();

  function normalize(value) {
    return String(value ?? "").toLowerCase();
  }

  function tokens(query) {
    return normalize(query)
      .split(/[\s,，;；|/]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function jobText(job) {
    const fields = [
      job.number,
      job.title,
      job.company,
      job.location,
      job.salary,
      job.work_mode,
      job.timezone,
      job.employment_type,
      job.summary,
      job.responsibilities,
      job.requirements,
      job.author,
      Array.isArray(job.contact_channels) ? job.contact_channels.join(" ") : "",
      Array.isArray(job.labels) ? job.labels.join(" ") : "",
      Array.isArray(job.risk_flags) ? job.risk_flags.join(" ") : ""
    ];
    return normalize(fields.join("\n"));
  }

  function articleNumber(article) {
    const text = article.querySelector(".top .meta-line")?.textContent || "";
    const match = text.match(/#(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function articles() {
    return Array.from(document.querySelectorAll("#jobs article"));
  }

  async function loadJobs() {
    if (jobsCache) return jobsCache;
    const response = await fetch(JOBS_JSON, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`无法加载职位数据: HTTP ${response.status}`);
    }
    const payload = await response.json();
    jobsCache = Array.isArray(payload.jobs)
      ? payload.jobs.filter((job) => normalize(job.state) === "open")
      : [];
    return jobsCache;
  }

  function scoreJob(job, queryTokens) {
    const haystack = jobText(job);
    if (!queryTokens.every((token) => haystack.includes(token))) {
      return 0;
    }
    let score = 1;
    const title = normalize(job.title);
    const company = normalize(job.company);
    const location = normalize(job.location);
    for (const token of queryTokens) {
      if (title.includes(token)) score += 4;
      if (company.includes(token)) score += 3;
      if (location.includes(token)) score += 2;
      if (String(job.number) === token) score += 10;
    }
    if (job.remote) score += 0.5;
    score += Number(job.decision_value_score || 0) / 100;
    score += Number(job.credibility_score || 0) / 200;
    return score;
  }

  function salaryValue(job) {
    const max = Number(job.salary_max);
    if (Number.isFinite(max) && max > 0) return max;
    const min = Number(job.salary_min);
    if (Number.isFinite(min) && min > 0) return min;
    return 0;
  }

  function createdTime(job) {
    const time = Date.parse(job.created_at || "");
    return Number.isFinite(time) ? time : 0;
  }

  function compareJobs(a, b, sortBy) {
    if (sortBy === "credibility") {
      return Number(b.job.credibility_score || 0) - Number(a.job.credibility_score || 0)
        || b.score - a.score
        || createdTime(b.job) - createdTime(a.job);
    }
    if (sortBy === "salary") {
      return salaryValue(b.job) - salaryValue(a.job)
        || Number(b.job.credibility_score || 0) - Number(a.job.credibility_score || 0)
        || createdTime(b.job) - createdTime(a.job);
    }
    if (sortBy === "created") {
      return createdTime(b.job) - createdTime(a.job)
        || b.score - a.score;
    }
    return b.score - a.score
      || createdTime(b.job) - createdTime(a.job);
  }

  async function searchJobs(query, sortBy = "relevance") {
    const queryTokens = tokens(query);
    const jobs = await loadJobs();
    const mapped = jobs
      .map((job) => ({ job, score: queryTokens.length ? scoreJob(job, queryTokens) : 1 }))
      .filter((item) => !queryTokens.length || item.score > 0)
      .sort((a, b) => compareJobs(a, b, sortBy));

    if (!queryTokens.length) {
      return {
        total: jobs.length,
        results: mapped.slice(0, 80).map((item) => formatResult(item.job, item.score))
      };
    }
    const results = mapped
      .slice(0, 80)
      .map((item) => formatResult(item.job, item.score));
    return { total: jobs.length, results };
  }

  function formatResult(job, score) {
    return {
      id: Number(job.number),
      title: job.title || "未命名职位",
      company: job.company || "",
      location: job.location || "",
      salary: job.salary || "",
      salary_min: Number(job.salary_min) || 0,
      salary_max: Number(job.salary_max) || 0,
      salary_sort_value: salaryValue(job),
      credibility_score: Number(job.credibility_score) || 0,
      decision_value_score: Number(job.decision_value_score) || 0,
      remote: Boolean(job.remote),
      created_at: job.created_at || "",
      created_ts: createdTime(job),
      summary: String(job.summary || "").replace(/\s+/g, " ").slice(0, 180),
      score
    };
  }

  function applyPageFilter(ids) {
    activeIds = new Set(ids.map(Number));
    for (const article of articles()) {
      const number = articleNumber(article);
      const matched = activeIds.size === 0 || activeIds.has(number);
      article.classList.toggle("rhf-hidden", !matched);
      article.classList.toggle("rhf-match", matched && activeIds.size > 0);
    }
  }

  function clearFilter() {
    activeQuery = "";
    activeIds = new Set();
    for (const article of articles()) {
      article.classList.remove("rhf-hidden", "rhf-match", "rhf-target");
    }
  }

  async function filterByQuery(query) {
    activeQuery = query;
    const { results } = await searchJobs(query);
    applyPageFilter(results.map((result) => result.id));
    return { count: results.length, ids: results.map((result) => result.id) };
  }

  async function ensureArticleVisible(jobId) {
    const targetId = Number(jobId);
    const loadMore = document.getElementById("load-more");
    for (let i = 0; i < 80; i += 1) {
      const found = articles().find((article) => articleNumber(article) === targetId);
      if (found) return found;
      if (!loadMore || loadMore.hidden || loadMore.disabled) break;
      loadMore.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return null;
  }

  async function jumpToJob(jobId) {
    const article = await ensureArticleVisible(jobId);
    if (!article) {
      throw new Error(`页面上未找到 #${jobId}，可能数据尚未渲染。`);
    }
    if (activeIds.size > 0) {
      article.classList.remove("rhf-hidden");
      article.classList.add("rhf-match");
    }
    article.scrollIntoView({ behavior: "smooth", block: "center" });
    article.classList.remove("rhf-target");
    void article.offsetWidth;
    article.classList.add("rhf-target");
    return true;
  }

  const observer = new MutationObserver(() => {
    if (activeQuery) {
      applyPageFilter([...activeIds]);
    }
  });

  function startObserver() {
    const root = document.getElementById("jobs");
    if (!root) return;
    observer.observe(root, { childList: true });
  }

  async function restorePersistedFilter() {
    const { preferences } = await chrome.storage.local.get("preferences");
    if (preferences?.filterActive) {
      await filterByQuery(preferences.query || "");
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      switch (message?.type) {
        case "RHF_SEARCH":
          return searchJobs(message.query || "", message.sortBy || "relevance");
        case "RHF_FILTER":
          return filterByQuery(message.query || "");
        case "RHF_CLEAR":
          clearFilter();
          return { ok: true };
        case "RHF_JUMP":
          await jumpToJob(message.id);
          return { ok: true };
        default:
          throw new Error("未知命令");
      }
    };

    run()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  startObserver();
  restorePersistedFilter().catch(() => {});
})();
