const DEFAULT_PREFERENCES = {
  query: "",
  sortBy: "relevance",
  filterActive: false
};

const query = document.getElementById("query");
const sortBy = document.getElementById("sortBy");
const searchBtn = document.getElementById("searchBtn");
const filterBtn = document.getElementById("filterBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let preferences = { ...DEFAULT_PREFERENCES };
let searchTimer = null;

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadPreferences() {
  const stored = await chrome.storage.local.get("preferences");
  preferences = { ...DEFAULT_PREFERENCES, ...(stored.preferences || {}) };
  query.value = preferences.query;
  sortBy.value = preferences.sortBy;
  renderFilterState();
}

async function savePreferences(patch = {}) {
  preferences = {
    ...preferences,
    ...patch,
    query: query.value,
    sortBy: sortBy.value
  };
  await chrome.storage.local.set({ preferences });
  renderFilterState();
}

function renderFilterState() {
  filterBtn.textContent = preferences.filterActive ? "取消页面筛选" : "只显示匹配";
  filterBtn.classList.toggle("active", preferences.filterActive);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/hire\.rebase\.network\//.test(tab.url || "")) {
    throw new Error("请先打开 https://hire.rebase.network");
  }
  return tab;
}

async function send(message) {
  const tab = await getActiveTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) throw new Error(response?.error || "页面脚本无响应");
    return response.data;
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) throw new Error(response?.error || error.message);
    return response.data;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(results) {
  if (!results.length) {
    resultsEl.innerHTML = '<div class="empty">没有匹配结果</div>';
    return;
  }
  resultsEl.innerHTML = results.map((item) => {
    const chips = [
      `#${item.id}`,
      item.company,
      item.location,
      item.salary,
      item.remote ? "远程" : "",
      `可信 ${item.credibility_score}`,
      item.salary_sort_value ? `薪资排序 ${item.salary_sort_value}` : "",
      item.created_at ? new Date(item.created_at).toLocaleDateString() : ""
    ].filter(Boolean).map(escapeHtml).join(" · ");
    return `
      <article class="result" data-id="${item.id}">
        <div class="title">${escapeHtml(item.title)}</div>
        <div class="meta">${chips}</div>
        <div class="summary">${escapeHtml(item.summary)}</div>
      </article>
    `;
  }).join("");
}

async function search({ persist = true } = {}) {
  if (persist) {
    await savePreferences();
  }
  setStatus("搜索中...");
  try {
    const data = await send({ type: "RHF_SEARCH", query: query.value, sortBy: sortBy.value });
    render(data.results || []);
    setStatus(`${(data.results || []).length} / ${data.total}`);
  } catch (error) {
    setStatus("错误");
    resultsEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function toggleFilter() {
  const filterActive = !preferences.filterActive;
  setStatus(filterActive ? "筛选中..." : "恢复页面...");
  try {
    const data = filterActive
      ? await send({ type: "RHF_FILTER", query: query.value })
      : await send({ type: "RHF_CLEAR" });
    await savePreferences({ filterActive });
    setStatus(filterActive ? `页面显示 ${data.count}` : "已取消页面筛选");
  } catch (error) {
    setStatus("错误");
    resultsEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function reset() {
  query.value = "";
  sortBy.value = DEFAULT_PREFERENCES.sortBy;
  preferences = { ...DEFAULT_PREFERENCES };
  await chrome.storage.local.set({ preferences });
  renderFilterState();
  try {
    await send({ type: "RHF_CLEAR" });
  } catch {
    // Reset remains valid even when the supported page is not the active tab.
  }
  await search({ persist: false });
}

async function jump(id) {
  setStatus(`跳转 #${id}...`);
  try {
    await send({ type: "RHF_JUMP", id });
    setStatus(`已跳转 #${id}`);
  } catch (error) {
    setStatus("错误");
    resultsEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

query.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 180);
});

sortBy.addEventListener("change", search);

query.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    search();
  }
});

resultsEl.addEventListener("click", (event) => {
  const card = event.target.closest(".result");
  if (!card) return;
  jump(Number(card.dataset.id));
});

searchBtn.addEventListener("click", search);
filterBtn.addEventListener("click", toggleFilter);
resetBtn.addEventListener("click", reset);

chrome.tabs.onActivated.addListener(() => search({ persist: false }));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    search({ persist: false });
  }
});

async function init() {
  await loadPreferences();
  await search({ persist: false });
}

init();
