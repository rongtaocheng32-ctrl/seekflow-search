"use strict";

const STORAGE_KEYS = Object.freeze({
  history: "seekflow.history.v1",
  favorites: "seekflow.favorites.v1",
});

const SOURCE_ORDER = ["wikipedia", "github", "openalex", "hackernews"];

const SOURCES = Object.freeze({
  wikipedia: {
    label: "中文维基百科",
    shortLabel: "维基百科",
    color: "#526a67",
    search: searchWikipedia,
  },
  github: {
    label: "GitHub",
    shortLabel: "GitHub",
    color: "#1f2c2c",
    search: searchGitHub,
  },
  openalex: {
    label: "OpenAlex",
    shortLabel: "OpenAlex",
    color: "#799c24",
    search: searchOpenAlex,
  },
  hackernews: {
    label: "Hacker News",
    shortLabel: "Hacker News",
    color: "#d96335",
    search: searchHackerNews,
  },
});

const elements = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#search-input"),
  searchButton: document.querySelector("#search-button"),
  sourceInputs: [...document.querySelectorAll('input[name="sources"]')],
  toggleSourcesButton: document.querySelector("#toggle-sources-button"),
  resultSummary: document.querySelector("#result-summary"),
  resultsList: document.querySelector("#results-list"),
  filterBar: document.querySelector("#filter-bar"),
  emptyState: document.querySelector("#empty-state"),
  loadingList: document.querySelector("#loading-list"),
  historyList: document.querySelector("#history-list"),
  favoritesList: document.querySelector("#favorites-list"),
  favoritesCount: document.querySelector("#favorites-count"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  clearFavoritesButton: document.querySelector("#clear-favorites-button"),
  exportFavoritesButton: document.querySelector("#export-favorites-button"),
  clearAllButton: document.querySelector("#clear-all-button"),
  toast: document.querySelector("#toast"),
};

const state = {
  results: [],
  history: loadStoredArray(STORAGE_KEYS.history, 10),
  favorites: new Map(
    loadStoredArray(STORAGE_KEYS.favorites, 200)
      .filter(isStoredResult)
      .map((item) => [item.id, item]),
  ),
  activeFilter: "all",
  controller: null,
  requestId: 0,
  loading: false,
};

let toastTimer = 0;

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

elements.toggleSourcesButton.addEventListener("click", () => {
  const shouldSelectAll = elements.sourceInputs.some((input) => !input.checked);
  elements.sourceInputs.forEach((input) => {
    input.checked = shouldSelectAll;
    setSourceStatus(input.value, "idle", shouldSelectAll ? "待命" : "未选择");
  });
  updateSourceToggleLabel();
});

elements.sourceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!state.loading) {
      setSourceStatus(input.value, "idle", input.checked ? "待命" : "未选择");
    }
    updateSourceToggleLabel();
  });
});

document.querySelectorAll("[data-suggestion]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.input.value = button.dataset.suggestion || "";
    elements.input.focus();
    elements.form.requestSubmit();
  });
});

elements.filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.activeFilter = button.dataset.filter || "all";
  renderFilters();
  renderResults();
});

elements.resultsList.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest("[data-favorite-id]");
  if (favoriteButton) {
    toggleFavorite(favoriteButton.dataset.favoriteId);
    return;
  }

  const copyButton = event.target.closest("[data-copy-id]");
  if (copyButton) {
    const result = state.results.find((item) => item.id === copyButton.dataset.copyId);
    if (result) copyResultAsMarkdown(result);
  }
});

elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-index]");
  if (!button) return;

  const item = state.history[Number(button.dataset.historyIndex)];
  if (!item || typeof item.query !== "string") return;

  elements.input.value = item.query;
  const sourceSet = new Set(Array.isArray(item.sources) ? item.sources : SOURCE_ORDER);
  elements.sourceInputs.forEach((input) => {
    input.checked = sourceSet.has(input.value);
  });
  updateSourceToggleLabel();
  elements.form.requestSubmit();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

elements.favoritesList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-favorite]");
  if (!button) return;
  removeFavorite(button.dataset.removeFavorite);
});

elements.clearHistoryButton.addEventListener("click", () => {
  if (!state.history.length) return;
  if (!window.confirm("确认清空全部搜索历史？")) return;
  state.history = [];
  removeStoredItem(STORAGE_KEYS.history);
  renderHistory();
  showToast("搜索历史已清空");
});

elements.clearFavoritesButton.addEventListener("click", () => {
  if (!state.favorites.size) return;
  if (!window.confirm("确认清空全部收藏？")) return;
  state.favorites.clear();
  removeStoredItem(STORAGE_KEYS.favorites);
  renderFavorites();
  renderResults();
  showToast("收藏已清空");
});

elements.exportFavoritesButton.addEventListener("click", exportFavorites);
elements.clearAllButton.addEventListener("click", clearAllLocalData);

initialize();

function initialize() {
  updateSourceToggleLabel();
  renderHistory();
  renderFavorites();
}

async function runSearch() {
  const query = cleanText(elements.input.value, 160);
  const selectedSources = getSelectedSources();

  if (!query) {
    showToast("请先输入要寻找的关键词");
    elements.input.focus();
    return;
  }

  if (!selectedSources.length) {
    showToast("请至少选择一个信息源");
    return;
  }

  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  state.requestId += 1;
  const currentRequestId = state.requestId;
  state.loading = true;
  state.results = [];
  state.activeFilter = "all";

  setLoadingState(true, query, selectedSources);
  addHistory(query, selectedSources);

  const groups = new Map();
  const failedSources = [];

  const tasks = selectedSources.map(async (sourceKey) => {
    setSourceStatus(sourceKey, "loading", "检索中");
    try {
      const results = await SOURCES[sourceKey].search(query, state.controller.signal);
      if (currentRequestId !== state.requestId) return;
      groups.set(sourceKey, results);
      setSourceStatus(sourceKey, "success", `${results.length} 条`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (currentRequestId !== state.requestId) return;
      failedSources.push(sourceKey);
      setSourceStatus(sourceKey, "error", "失败");
      console.warn(`[SeekFlow] ${sourceKey} search failed`, error);
    }
  });

  await Promise.allSettled(tasks);
  if (currentRequestId !== state.requestId) return;

  state.results = interleaveGroups(groups, selectedSources);
  state.loading = false;
  setLoadingState(false, query, selectedSources);
  renderFilters();
  renderResults();

  const successCount = selectedSources.length - failedSources.length;
  const failureNote = failedSources.length ? `，${failedSources.length} 个来源暂时失败` : "";
  elements.resultSummary.textContent = `“${query}” 找到 ${state.results.length} 条线索，来自 ${successCount} 个来源${failureNote}。`;

  if (failedSources.length) {
    showToast(`${failedSources.map((key) => SOURCES[key].shortLabel).join("、")} 暂时无法访问，其他结果已显示`);
  }
}

function setLoadingState(isLoading, query, selectedSources) {
  elements.searchButton.disabled = isLoading;
  elements.searchButton.querySelector("span").textContent = isLoading ? "正在汇流…" : "开始寻找";
  elements.loadingList.hidden = !isLoading;
  elements.emptyState.hidden = isLoading;
  elements.resultsList.replaceChildren();
  elements.filterBar.hidden = true;
  elements.resultsList.setAttribute("aria-busy", String(isLoading));

  if (isLoading) {
    elements.resultSummary.textContent = `正在 ${selectedSources.length} 个信息源中检索“${query}”…`;
    elements.sourceInputs.forEach((input) => {
      if (!selectedSources.includes(input.value)) setSourceStatus(input.value, "idle", "未选择");
    });
  }
}

async function searchWikipedia(query, signal) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "8",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    inprop: "url",
  });
  const data = await fetchJson(`https://zh.wikipedia.org/w/api.php?${params}`, { signal });
  const pages = Object.values(data?.query?.pages || {}).sort(
    (a, b) => Number(a.index || 0) - Number(b.index || 0),
  );

  return pages.map((page) => ({
    id: `wikipedia:${page.pageid}`,
    source: "wikipedia",
    title: cleanText(page.title, 180) || "未命名词条",
    summary: cleanText(page.extract, 360) || "该词条暂无摘要，可打开原页面查看。",
    url: safeExternalUrl(page.fullurl) || `https://zh.wikipedia.org/?curid=${encodeURIComponent(page.pageid)}`,
    meta: ["百科词条", "简体中文"],
  }));
}

async function searchGitHub(query, signal) {
  const params = new URLSearchParams({ q: query, per_page: "8", sort: "stars", order: "desc" });
  const response = await fetch(`https://api.github.com/search/repositories?${params}`, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("GitHub 匿名检索频率已达上限");
    }
    throw new Error(`GitHub HTTP ${response.status}`);
  }

  const data = await response.json();
  return (Array.isArray(data.items) ? data.items : []).map((repo) => ({
    id: `github:${repo.id}`,
    source: "github",
    title: cleanText(repo.full_name, 180) || "未命名仓库",
    summary: cleanText(repo.description, 360) || "该仓库暂无项目描述。",
    url: safeExternalUrl(repo.html_url),
    meta: [
      repo.language ? cleanText(repo.language, 40) : "多语言",
      `${formatNumber(repo.stargazers_count)} stars`,
      `更新 ${formatDate(repo.updated_at)}`,
    ],
  }));
}

async function searchOpenAlex(query, signal) {
  const params = new URLSearchParams({ search: query, "per-page": "8" });
  const data = await fetchJson(`https://api.openalex.org/works?${params}`, { signal });

  return (Array.isArray(data.results) ? data.results : []).map((work) => {
    const authors = (Array.isArray(work.authorships) ? work.authorships : [])
      .map((entry) => cleanText(entry?.author?.display_name, 80))
      .filter(Boolean);
    const sourceName = cleanText(work?.primary_location?.source?.display_name, 100);
    const authorText = authors.length
      ? `作者：${authors.slice(0, 3).join("、")}${authors.length > 3 ? " 等" : ""}`
      : "作者信息暂缺";
    const summary = sourceName ? `${authorText}。收录来源：${sourceName}。` : `${authorText}。`;
    const landingUrl = work.doi || work?.primary_location?.landing_page_url || work.id;

    return {
      id: `openalex:${String(work.id || work.title || Math.random())}`,
      source: "openalex",
      title: cleanText(work.display_name || work.title, 220) || "未命名研究",
      summary: cleanText(summary, 360),
      url: safeExternalUrl(landingUrl) || "https://openalex.org/",
      meta: [
        work.publication_year ? `${work.publication_year} 年` : "年份未知",
        `被引 ${formatNumber(work.cited_by_count)} 次`,
        sourceName || "学术成果",
      ],
    };
  });
}

async function searchHackerNews(query, signal) {
  const params = new URLSearchParams({ query, tags: "story", hitsPerPage: "8" });
  const data = await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`, { signal });

  return (Array.isArray(data.hits) ? data.hits : []).map((hit) => {
    const fallbackUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID || "")}`;
    const plainStory = cleanText(String(hit.story_text || "").replace(/<[^>]*>/g, " "), 300);
    const discussionSummary = `${formatNumber(hit.points)} 赞同 · ${formatNumber(hit.num_comments)} 条讨论`;
    return {
      id: `hackernews:${hit.objectID}`,
      source: "hackernews",
      title: cleanText(hit.title || hit.story_title, 220) || "未命名讨论",
      summary: plainStory || `由 ${cleanText(hit.author, 80) || "匿名用户"} 发布的技术线索，${discussionSummary}。`,
      url: safeExternalUrl(hit.url) || fallbackUrl,
      meta: [
        cleanText(hit.author, 80) || "匿名用户",
        `${formatNumber(hit.points)} points`,
        `${formatNumber(hit.num_comments)} comments`,
        formatDate(hit.created_at),
      ],
    };
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function interleaveGroups(groups, selectedSources) {
  const output = [];
  const longest = Math.max(0, ...selectedSources.map((key) => (groups.get(key) || []).length));
  for (let index = 0; index < longest; index += 1) {
    selectedSources.forEach((sourceKey) => {
      const item = groups.get(sourceKey)?.[index];
      if (item) output.push(item);
    });
  }
  return output;
}

function renderFilters() {
  elements.filterBar.replaceChildren();
  if (!state.results.length) {
    elements.filterBar.hidden = true;
    return;
  }

  const counts = state.results.reduce((map, result) => {
    map.set(result.source, (map.get(result.source) || 0) + 1);
    return map;
  }, new Map());

  elements.filterBar.append(createFilterButton("all", `全部 ${state.results.length}`));
  SOURCE_ORDER.forEach((sourceKey) => {
    const count = counts.get(sourceKey);
    if (count) {
      elements.filterBar.append(createFilterButton(sourceKey, `${SOURCES[sourceKey].shortLabel} ${count}`));
    }
  });
  elements.filterBar.hidden = false;
}

function createFilterButton(filterKey, label) {
  const button = createElement("button", "filter-button", label);
  button.type = "button";
  button.dataset.filter = filterKey;
  button.setAttribute("aria-pressed", String(state.activeFilter === filterKey));
  return button;
}

function renderResults() {
  elements.resultsList.replaceChildren();
  if (state.loading) return;

  elements.emptyState.hidden = true;
  const filteredResults = state.activeFilter === "all"
    ? state.results
    : state.results.filter((result) => result.source === state.activeFilter);

  if (!state.results.length) {
    elements.emptyState.hidden = false;
    const title = elements.emptyState.querySelector("h3");
    const description = elements.emptyState.querySelector("p");
    title.textContent = "这次没有找到线索";
    description.textContent = "可以尝试更短的关键词、英文词组，或稍后重试暂时失败的数据源。";
    return;
  }

  if (!filteredResults.length) {
    const empty = createElement("div", "no-results");
    empty.append(
      createElement("strong", "", "该来源暂无结果"),
      document.createTextNode("切换到“全部”查看其他线索。"),
    );
    elements.resultsList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  filteredResults.forEach((result) => fragment.append(createResultCard(result)));
  elements.resultsList.append(fragment);
}

function createResultCard(result) {
  const source = SOURCES[result.source];
  const article = createElement("article", "result-card");
  article.style.setProperty("--source-color", source.color);

  const topLine = createElement("div", "result-topline");
  topLine.append(createElement("span", "result-source", source.label));

  const actions = createElement("div", "result-actions");
  const copyButton = createElement("button", "icon-button", "⎘");
  copyButton.type = "button";
  copyButton.dataset.copyId = result.id;
  copyButton.title = "复制为 Markdown";
  copyButton.setAttribute("aria-label", `复制“${result.title}”为 Markdown`);

  const isFavorite = state.favorites.has(result.id);
  const favoriteButton = createElement("button", `icon-button${isFavorite ? " is-active" : ""}`, isFavorite ? "★" : "☆");
  favoriteButton.type = "button";
  favoriteButton.dataset.favoriteId = result.id;
  favoriteButton.title = isFavorite ? "取消收藏" : "收藏线索";
  favoriteButton.setAttribute("aria-label", `${isFavorite ? "取消收藏" : "收藏"}“${result.title}”`);
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  actions.append(copyButton, favoriteButton);
  topLine.append(actions);

  const title = createElement("h3", "result-title");
  const titleLink = createSafeLink(result.url, result.title);
  title.append(titleLink);

  const description = createElement("p", "result-description", result.summary);
  const metadata = createElement("div", "result-meta");
  result.meta.filter(Boolean).slice(0, 4).forEach((item) => {
    metadata.append(createElement("span", "meta-pill", cleanText(item, 100)));
  });

  article.append(topLine, title, description, metadata);
  return article;
}

function toggleFavorite(resultId) {
  if (state.favorites.has(resultId)) {
    state.favorites.delete(resultId);
    showToast("已取消收藏");
  } else {
    const result = state.results.find((item) => item.id === resultId);
    if (!result) return;
    state.favorites.set(resultId, { ...result, savedAt: new Date().toISOString() });
    showToast("已收藏这条线索");
  }
  persistFavorites();
  renderFavorites();
  renderResults();
}

function removeFavorite(resultId) {
  if (!state.favorites.delete(resultId)) return;
  persistFavorites();
  renderFavorites();
  renderResults();
  showToast("已移除收藏");
}

function renderFavorites() {
  elements.favoritesList.replaceChildren();
  const favorites = [...state.favorites.values()].sort(
    (a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0),
  );

  elements.favoritesCount.textContent = String(favorites.length);
  elements.clearFavoritesButton.disabled = favorites.length === 0;
  elements.exportFavoritesButton.disabled = favorites.length === 0;

  if (!favorites.length) {
    elements.favoritesList.append(createElement("p", "mini-empty", "在结果中点击 ☆，把重要线索留在这里。"));
    return;
  }

  const fragment = document.createDocumentFragment();
  favorites.forEach((result) => {
    const item = createElement("div", "favorite-item");
    const copy = document.createElement("div");
    const link = createSafeLink(result.url, result.title, "favorite-link");
    const meta = createElement("small", "", `${SOURCES[result.source]?.shortLabel || "其他"} · ${formatDate(result.savedAt)}`);
    copy.append(link, meta);

    const removeButton = createElement("button", "remove-favorite", "×");
    removeButton.type = "button";
    removeButton.dataset.removeFavorite = result.id;
    removeButton.setAttribute("aria-label", `移除收藏“${result.title}”`);
    item.append(copy, removeButton);
    fragment.append(item);
  });
  elements.favoritesList.append(fragment);
}

function addHistory(query, selectedSources) {
  const signature = `${query.toLocaleLowerCase()}::${[...selectedSources].sort().join(",")}`;
  state.history = state.history.filter((item) => {
    const itemSignature = `${String(item.query || "").toLocaleLowerCase()}::${[...(item.sources || [])].sort().join(",")}`;
    return itemSignature !== signature;
  });
  state.history.unshift({ query, sources: [...selectedSources], searchedAt: new Date().toISOString() });
  state.history = state.history.slice(0, 10);
  saveStoredArray(STORAGE_KEYS.history, state.history);
  renderHistory();
}

function renderHistory() {
  elements.historyList.replaceChildren();
  elements.clearHistoryButton.disabled = state.history.length === 0;

  if (!state.history.length) {
    elements.historyList.append(createElement("p", "mini-empty", "你的最近 10 次寻找会出现在这里。"));
    return;
  }

  const fragment = document.createDocumentFragment();
  state.history.forEach((entry, index) => {
    const item = createElement("div", "history-item");
    const copy = document.createElement("div");
    const button = createElement("button", "history-query", cleanText(entry.query, 160));
    button.type = "button";
    button.dataset.historyIndex = String(index);
    button.title = `再次搜索：${entry.query}`;
    const sources = (Array.isArray(entry.sources) ? entry.sources : [])
      .map((key) => SOURCES[key]?.shortLabel)
      .filter(Boolean)
      .join("、");
    copy.append(button, createElement("small", "", `${sources || "未记录来源"} · ${formatDate(entry.searchedAt)}`));
    item.append(copy, createElement("span", "history-arrow", "↗"));
    fragment.append(item);
  });
  elements.historyList.append(fragment);
}

async function copyResultAsMarkdown(result) {
  const title = String(result.title).replace(/([\\\[\]])/g, "\\$1");
  const summary = cleanText(result.summary, 360);
  const markdown = `- [${title}](${result.url})\n  ${summary}\n  来源：${SOURCES[result.source]?.label || result.source}`;

  try {
    await copyText(markdown);
    showToast("已复制为 Markdown");
  } catch (error) {
    console.warn("[SeekFlow] copy failed", error);
    showToast("复制失败，请检查浏览器权限");
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  textarea.remove();
  if (!succeeded) throw new Error("document.execCommand returned false");
}

function exportFavorites() {
  const items = [...state.favorites.values()];
  if (!items.length) {
    showToast("还没有可导出的收藏");
    return;
  }

  const payload = {
    app: "寻流 SeekFlow",
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `seekflow-favorites-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${items.length} 条收藏`);
}

function clearAllLocalData() {
  const hasData = state.history.length || state.favorites.size || state.results.length;
  if (!hasData) {
    showToast("当前没有需要清空的数据");
    return;
  }
  if (!window.confirm("确认清空搜索历史、收藏和当前结果？该操作无法撤销。")) return;

  if (state.controller) state.controller.abort();
  state.requestId += 1;
  state.loading = false;
  state.results = [];
  state.history = [];
  state.favorites.clear();
  removeStoredItem(STORAGE_KEYS.history);
  removeStoredItem(STORAGE_KEYS.favorites);

  elements.input.value = "";
  elements.searchButton.disabled = false;
  elements.searchButton.querySelector("span").textContent = "开始寻找";
  elements.loadingList.hidden = true;
  elements.filterBar.hidden = true;
  elements.filterBar.replaceChildren();
  elements.resultSummary.textContent = "输入关键词，从多个来源开始寻找。";
  elements.emptyState.hidden = false;
  elements.emptyState.querySelector("h3").textContent = "线索还在等待出发";
  elements.emptyState.querySelector("p").textContent = "选择信息源并输入关键词，结果会被整理成统一的信息卡片。";
  elements.sourceInputs.forEach((input) => setSourceStatus(input.value, "idle", input.checked ? "待命" : "未选择"));

  renderResults();
  renderHistory();
  renderFavorites();
  showToast("寻流的本地数据已清空");
}

function persistFavorites() {
  saveStoredArray(STORAGE_KEYS.favorites, [...state.favorites.values()]);
}

function getSelectedSources() {
  return elements.sourceInputs.filter((input) => input.checked).map((input) => input.value);
}

function updateSourceToggleLabel() {
  const allSelected = elements.sourceInputs.every((input) => input.checked);
  elements.toggleSourcesButton.textContent = allSelected ? "取消全选" : "全选";
}

function setSourceStatus(sourceKey, status, message) {
  const element = document.querySelector(`#status-${sourceKey}`);
  if (!element) return;
  element.dataset.state = status;
  element.textContent = message;
}

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null && text !== "") element.textContent = String(text);
  return element;
}

function createSafeLink(url, text, className = "") {
  const link = createElement("a", className, text);
  const safeUrl = safeExternalUrl(url);
  if (safeUrl) {
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link.href = "#";
    link.addEventListener("click", (event) => event.preventDefault());
  }
  return link;
}

function safeExternalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function cleanText(value, maxLength = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function formatDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("zh-CN", { notation: number >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number);
}

function loadStoredArray(key, maxItems) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.slice(0, maxItems) : [];
  } catch (error) {
    console.warn(`[SeekFlow] failed to read ${key}`, error);
    return [];
  }
}

function saveStoredArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[SeekFlow] failed to write ${key}`, error);
    showToast("浏览器本地存储不可用，本次变更可能无法保存");
  }
}

function removeStoredItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[SeekFlow] failed to remove ${key}`, error);
  }
}

function isStoredResult(item) {
  return Boolean(
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.url === "string" &&
    typeof item.source === "string" &&
    SOURCES[item.source] &&
    safeExternalUrl(item.url),
  );
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
}
