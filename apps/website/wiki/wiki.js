const wikiGroups = [
  {
    label: "从这里开始",
    links: [
      { page: "home", href: "index.html", label: "什么是 OIO", mark: "○" },
      { page: "card", href: "card.html", label: "制作第一张 Card", mark: "+", keywords: "卡片 新建" },
      { page: "download", href: "download.html", label: "下载 OIO", mark: "↓", keywords: "iPhone iPad iOS Android 安卓" },
    ],
  },
  {
    label: "学习理念",
    links: [
      { page: "philosophy", href: "philosophy.html#life", label: "为什么从生活开始", mark: "↘" },
      { page: "philosophy", href: "philosophy.html#personal", label: "属于自己的英文", mark: "✦" },
      { page: "philosophy", href: "philosophy.html#memory", label: "记忆不是背诵", mark: "↻" },
      { page: "philosophy", href: "philosophy.html#difference", label: "与背单词的不同", mark: "≠" },
    ],
  },
  {
    label: "OIO App",
    links: [
      { page: "card", href: "card.html#capture", label: "捕捉生活", mark: "□" },
      { page: "card", href: "card.html#expression", label: "形成自然表达", mark: "Aa", keywords: "改写 图片描述 OIO 的发现 查词 挖空" },
      { page: "card", href: "card.html#collection", label: "生活集", mark: "⌑" },
      { page: "encounter", href: "encounter.html#photo", label: "用照片唤醒记忆", mark: "◫", keywords: "图片 回忆" },
      { page: "encounter", href: "encounter.html#related", label: "相关记录", mark: "∞" },
      { page: "encounter", href: "encounter.html#practice", label: "偶遇与记忆游戏", mark: "◇", keywords: "填空 选词 听写 朗读 练习" },
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
  <nav class="wiki-global-nav">${wikiGroups.map((group) => `
    <section>
      <h2>${group.label}</h2>
      <div>${group.links.map((link) => `<a href="${link.href}" data-title="${link.label} ${link.keywords || ""}"${link.action === "group" ? " data-join-group" : ""}${link.page === currentPage ? ' class="active"' : ""}><i aria-hidden="true">${link.mark}</i><span>${link.label}</span></a>`).join("")}</div>
    </section>`).join("")}
  </nav>
  <p class="wiki-search-empty" hidden>没有找到相关页面</p>`;

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

const search = document.querySelector(".wiki-search input");
const empty = sidebar.querySelector(".wiki-search-empty");
function filterWiki() {
  const query = search.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  sidebar.querySelectorAll(".wiki-global-nav section").forEach((group) => {
    let groupCount = 0;
    group.querySelectorAll("a").forEach((link) => {
      const visible = !query || link.dataset.title.toLocaleLowerCase().includes(query);
      link.hidden = !visible;
      if (visible) groupCount += 1;
    });
    group.hidden = groupCount === 0;
    visibleCount += groupCount;
  });
  empty.hidden = visibleCount !== 0;
}
search.addEventListener("input", filterWiki);
search.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  sidebar.querySelector(".wiki-global-nav a:not([hidden])")?.click();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    if (matchMedia("(max-width: 920px)").matches) openMenu();
    search.focus();
  }
});

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
