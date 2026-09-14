const wikiGroups = [
  {
    label: "从这里开始",
    links: [
      { page: "home", href: "index.html", label: "什么是 OIO", mark: "○" },
      { page: "card", href: "card.html", label: "制作第一张 Card", mark: "+", keywords: "卡片 新建" },
    ],
  },
  {
    label: "学习与思考",
    links: [
      { page: "philosophy", href: "philosophy.html#life", label: "为什么从生活开始", mark: "↘" },
      { page: "philosophy", href: "philosophy.html#personal", label: "属于自己的英文", mark: "✦" },
      { page: "philosophy", href: "philosophy.html#memory", label: "记忆不是背诵", mark: "↻" },
      { page: "philosophy", href: "philosophy.html#difference", label: "与背单词的不同", mark: "≠" },
    ],
  },
  {
    label: "使用 OIO",
    links: [
      { page: "card", href: "card.html#capture", label: "捕捉生活", mark: "□" },
      { page: "card", href: "card.html#expression", label: "形成自然表达", mark: "Aa", keywords: "改写 图片描述 OIO 的发现 查词 挖空" },
      { page: "card", href: "card.html#collection", label: "生活集", mark: "⌑" },
      { page: "encounter", href: "encounter.html#photo", label: "用照片唤醒记忆", mark: "◫", keywords: "图片 回忆" },
      { page: "encounter", href: "encounter.html#related", label: "相关记录", mark: "∞" },
      { page: "encounter", href: "encounter.html#practice", label: "偶遇与记忆游戏", mark: "◇", keywords: "填空 选词 听写 朗读 练习" },
      { page: "download", href: "download.html", label: "下载 OIO", mark: "↓", keywords: "iPhone iPad iOS Android 安卓" },
    ],
  },
  {
    label: "产品动态",
    links: [
      { page: "changelog", href: "changelog.html", label: "更新日志", mark: "↗", keywords: "版本 新功能 修复 release version" },
    ],
  },
  {
    label: "帮助",
    links: [
      { page: "faq", href: "faq.html", label: "常见问题", mark: "?", keywords: "点数 图片流量 同步 换设备 注销 账号 iOS Android 额度 Card 生活集 回忆" },
    ],
  },
  {
    label: "联系",
    links: [
      { page: "contact", href: "contact.html", label: "加入群聊", mark: "↗", keywords: "微信 联系 资讯 反馈" },
    ],
  },
];

const sidebar = document.getElementById("wiki-sidebar");
const currentPage = document.body.dataset.wikiPage;
const topbarNav = document.querySelector(".wiki-topbar nav");
const topbarBrand = document.querySelector(".wiki-brand");

topbarBrand.outerHTML = '<a class="wiki-product-link" href="../app.html" aria-label="返回 OIO 官网"><strong>OIO</strong><span>Life × Language</span></a>';
document.querySelector(".wiki-what")?.remove();
topbarNav.innerHTML = '<a href="download.html">App</a><a href="contact.html">加入群聊</a>';

sidebar.innerHTML = `
  <div class="wiki-sidebar-head">
    <a href="index.html"><strong>OIO Wiki</strong><span>Life grows language.</span></a>
    <button type="button" data-wiki-close aria-label="关闭目录">×</button>
  </div>
  <div class="wiki-sidebar-search-wrap">
    <label class="wiki-sidebar-search"><span aria-hidden="true"></span><input type="search" placeholder="搜索 Wiki" aria-label="搜索 Wiki" autocomplete="off"></label>
    <div class="wiki-search-results" data-search-results hidden></div>
  </div>
  <nav class="wiki-global-nav">${wikiGroups.map((group) => `
    <section>
      <h2>${group.label}</h2>
      <div>${group.links.map((link) => `<a href="${link.href}" data-title="${link.label} ${link.keywords || ""}"${link.action === "group" ? " data-join-group" : ""}${link.page === currentPage ? ' class="active"' : ""}><i aria-hidden="true">${link.mark}</i><span>${link.label}</span></a>`).join("")}</div>
    </section>`).join("")}
  </nav>`;

function markCurrentLink() {
  const currentFile = location.pathname.split("/").pop() || "index.html";
  const currentPath = `${currentFile}${location.hash}`;
  const links = [...sidebar.querySelectorAll(".wiki-global-nav a")];
  const selected = links.find((link) => link.getAttribute("href") === currentPath)
    || links.find((link) => link.getAttribute("href") === currentFile)
    || links.find((link) => link.getAttribute("href")?.startsWith(`${currentFile}#`));
  links.forEach((link) => {
    link.classList.toggle("active", link === selected);
    if (link === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
markCurrentLink();
window.addEventListener("hashchange", markCurrentLink);

const toc = document.querySelector("[data-wiki-toc]");
const sectionHeadings = [...document.querySelectorAll(".wiki-article > section[id] > h2")];
toc.innerHTML = sectionHeadings.map((heading) => `<a href="#${heading.parentElement.id}">${heading.textContent}</a>`).join("");

const menuButton = document.querySelector("[data-wiki-menu]");
const scrim = document.querySelector(".wiki-scrim");
let menuInvoker;
function openMenu() {
  menuInvoker = document.activeElement;
  document.body.classList.add("wiki-menu-open");
  menuButton.setAttribute("aria-expanded", "true");
  scrim.hidden = false;
}
function closeMenu() {
  document.body.classList.remove("wiki-menu-open");
  menuButton.setAttribute("aria-expanded", "false");
  scrim.hidden = true;
  menuInvoker?.focus?.();
}
menuButton.addEventListener("click", () => openMenu());
document.querySelectorAll("[data-wiki-close]").forEach((control) => control.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("wiki-menu-open")) closeMenu();
});

const desktopSearchLabel = document.querySelector(".wiki-topbar .wiki-search");
const desktopSearchWrap = document.createElement("div");
desktopSearchWrap.className = "wiki-search-wrap";
desktopSearchLabel.replaceWith(desktopSearchWrap);
desktopSearchWrap.append(desktopSearchLabel);
const desktopSearchResults = document.createElement("div");
desktopSearchResults.className = "wiki-search-results";
desktopSearchResults.hidden = true;
desktopSearchWrap.append(desktopSearchResults);

const searchSources = [
  { input: desktopSearchLabel.querySelector("input"), results: desktopSearchResults },
  { input: sidebar.querySelector(".wiki-sidebar-search input"), results: sidebar.querySelector("[data-search-results]") },
];
let searchIndex = wikiGroups.flatMap((group) => group.links.map((link) => ({
  href: link.href,
  title: link.label,
  context: group.label,
  text: link.keywords || "",
})));

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function searchWiki(query) {
  const normalizedQuery = normalizeText(query).toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(" ").filter(Boolean);
  return searchIndex
    .map((entry) => {
      const title = entry.title.toLocaleLowerCase();
      const context = entry.context.toLocaleLowerCase();
      const text = entry.text.toLocaleLowerCase();
      const haystack = `${title} ${context} ${text}`;
      if (!terms.every((term) => haystack.includes(term))) return null;
      let score = 0;
      if (title === normalizedQuery) score += 120;
      if (title.startsWith(normalizedQuery)) score += 80;
      if (title.includes(normalizedQuery)) score += 55;
      if (context.includes(normalizedQuery)) score += 20;
      if (text.includes(normalizedQuery)) score += 8;
      return { ...entry, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 8);
}

function bindWikiSearch({ input, results }) {
  let activeIndex = -1;
  function setActive(nextIndex) {
    const links = [...results.querySelectorAll("a")];
    activeIndex = links.length ? (nextIndex + links.length) % links.length : -1;
    links.forEach((link, index) => link.classList.toggle("active", index === activeIndex));
    links[activeIndex]?.scrollIntoView({ block: "nearest" });
  }
  function render() {
    const query = input.value;
    if (!query.trim()) {
      results.hidden = true;
      results.innerHTML = "";
      activeIndex = -1;
      return;
    }
    const matches = searchWiki(query);
    results.innerHTML = matches.length
      ? matches.map((entry) => `<a href="${escapeHtml(entry.href)}"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.context)}</span></a>`).join("")
      : '<p>没有找到相关内容</p>';
    results.hidden = false;
    activeIndex = -1;
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (event) => {
    const links = [...results.querySelectorAll("a")];
    if (event.key === "ArrowDown" && links.length) {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp" && links.length) {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (event.key === "Enter" && links.length) {
      event.preventDefault();
      (links[activeIndex >= 0 ? activeIndex : 0]).click();
    } else if (event.key === "Escape") {
      results.hidden = true;
      input.blur();
    }
  });
  results.addEventListener("click", () => {
    results.hidden = true;
    if (document.body.classList.contains("wiki-menu-open")) closeMenu();
  });
}
searchSources.forEach(bindWikiSearch);

document.addEventListener("click", (event) => {
  searchSources.forEach(({ input, results }) => {
    if (!input.contains(event.target) && !results.contains(event.target)) results.hidden = true;
  });
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    const useSidebarSearch = matchMedia("(max-width: 620px)").matches;
    if (useSidebarSearch) openMenu();
    (useSidebarSearch ? searchSources[1] : searchSources[0]).input.focus();
  }
});

function revealHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (target?.tagName === "DETAILS") target.open = true;
}
revealHashTarget();
window.addEventListener("hashchange", revealHashTarget);

async function buildSearchIndex() {
  const files = [...new Set(wikiGroups.flatMap((group) => group.links.map((link) => link.href.split("#")[0])))];
  const documents = await Promise.all(files.map(async (file) => {
    try {
      const response = await fetch(file);
      if (!response.ok) return [];
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      const pageTitle = normalizeText(page.querySelector(".wiki-article h1")?.textContent || file);
      const entries = [{
        href: file,
        title: pageTitle,
        context: "页面",
        text: normalizeText(page.querySelector(".wiki-article-head p")?.textContent || ""),
      }];
      page.querySelectorAll(".wiki-article > section[id]").forEach((section) => {
        const heading = normalizeText(section.querySelector(":scope > h2")?.textContent || "");
        if (heading) entries.push({
          href: `${file}#${section.id}`,
          title: heading,
          context: pageTitle,
          text: normalizeText(section.textContent || ""),
        });
        section.querySelectorAll("details[id] > summary").forEach((summary) => {
          const details = summary.parentElement;
          entries.push({
            href: `${file}#${details.id}`,
            title: normalizeText(summary.textContent || ""),
            context: heading || pageTitle,
            text: normalizeText(details.textContent || ""),
          });
        });
      });
      return entries;
    } catch {
      return [];
    }
  }));
  const unique = new Map();
  [...searchIndex, ...documents.flat()].forEach((entry) => unique.set(`${entry.href}|${entry.title}`, entry));
  searchIndex = [...unique.values()];
}
void buildSearchIndex();

const groupDialog = document.getElementById("group-dialog");
let groupInvoker;
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-join-group]");
  if (!trigger) return;
  event.preventDefault();
  groupInvoker = trigger;
  groupDialog.showModal();
});
groupDialog.querySelector(".dialog-close").addEventListener("click", () => groupDialog.close());
groupDialog.addEventListener("click", (event) => { if (event.target === groupDialog) groupDialog.close(); });
groupDialog.addEventListener("close", () => groupInvoker?.focus());
