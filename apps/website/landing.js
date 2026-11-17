// OIO landing motion (2026-11). Every loop runs only while its block is on
// screen, and nothing moves when the system asks for reduced motion.
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Header hairline after scrolling.
  const header = document.querySelector(".lp-header");
  const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Group QR dialog (kept from the old page).
  const groupDialog = document.getElementById("group-dialog");
  if (groupDialog) {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-join-group]")) return;
      event.preventDefault(); // the href (Wiki contact page) is only the no-script fallback
      groupDialog.showModal();
    });
    groupDialog.querySelector(".dialog-close")?.addEventListener("click", () => groupDialog.close());
    groupDialog.addEventListener("click", (event) => { if (event.target === groupDialog) groupDialog.close(); });
  }

  // In-page links scroll by script (no CSS smooth scrolling, no hash left in
  // the address bar: Safari could get stuck at an anchor). 下载 glows its buttons.
  const jumpTo = (id) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.classList.add("in");
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (id === "download") {
      target.classList.remove("arrived");
      void target.offsetWidth;
      setTimeout(() => target.classList.add("arrived"), reduce ? 0 : 450);
    }
  };
  document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener("click", (event) => {
    const id = link.getAttribute("href").slice(1);
    if (!id || !document.getElementById(id)) return;
    event.preventDefault();
    jumpTo(id);
  }));
  if (location.hash) {
    const id = location.hash.slice(1);
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => jumpTo(id), 60);
  }

  // Reveal on scroll.
  const revealer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("in"); revealer.unobserve(entry.target); }
  }, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal").forEach((element) => reduce ? element.classList.add("in") : revealer.observe(element));

  // Loops tied to visibility.
  const visible = new Map();
  const loops = new Map();
  const player = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visible.set(entry.target, entry.isIntersecting);
      entry.target.classList.toggle("playing", entry.isIntersecting);
      const start = loops.get(entry.target);
      if (entry.isIntersecting && start && !entry.target.dataset.running) {
        entry.target.dataset.running = "1";
        start(() => visible.get(entry.target)).finally(() => { delete entry.target.dataset.running; });
      }
    }
  }, { threshold: 0.35 });
  const loop = (element, run) => {
    if (!element) return;
    if (reduce) { element.classList.add("playing"); return; }
    loops.set(element, async (isOn) => { while (isOn()) await run(); });
    player.observe(element);
  };

  // ---------- Hero phone: compose → rewrite → practice ----------
  const phone = document.getElementById("hero-phone");
  const typing = document.getElementById("demo-typing");
  const count = document.getElementById("demo-count");
  const send = document.getElementById("demo-send");
  const en = document.getElementById("demo-en");
  const slots = document.getElementById("tray-slots");
  const tiles = document.getElementById("tray-tiles");
  const check = document.getElementById("tray-check");
  const zh = "今天带豆豆去河边散步，它一看到水就冲过去，拉都拉不住 😂";
  const english = "Took Doudou for a walk by the river today — the second he saw the water he [bolted], and I couldn't hold him back 😂";

  const renderEnglish = () => {
    en.innerHTML = english.split(" ").map((word) => {
      // "[bolted]," → the blank holds the word only; punctuation stays outside.
      const match = /^\[(.+)\](.*)$/u.exec(word);
      return `<span class="w">${match ? `<span class="blank">${match[1]}</span>${match[2]}` : word}</span>`;
    }).join(" ");
  };
  const showStatic = () => {
    phone.dataset.scene = "practice";
    renderEnglish();
    en.querySelectorAll(".w").forEach((word) => word.classList.add("on"));
    en.querySelector(".blank")?.classList.add("right");
    phone.classList.add("checked");
  };

  const heroRun = async () => {
    phone.classList.remove("checked");
    phone.dataset.scene = "compose";
    send.classList.remove("ready", "press");
    typing.innerHTML = '<span class="caret"></span>';
    count.textContent = "0/5000";
    await wait(700);
    const chars = Array.from(zh);
    for (let i = 0; i < chars.length; i += 1) {
      typing.innerHTML = `${chars.slice(0, i + 1).join("")}<span class="caret"></span>`;
      count.textContent = `${i + 1}/5000`;
      await wait(chars[i] === "，" ? 260 : 70);
    }
    send.classList.add("ready");
    await wait(600);
    send.classList.add("press");
    await wait(180);
    send.classList.remove("press");
    await wait(300);
    renderEnglish();
    phone.dataset.scene = "card";
    await wait(450);
    for (const word of en.querySelectorAll(".w")) { word.classList.add("on"); await wait(85); }
    await wait(1400);
    // Practice: the blank empties, tiles assemble the answer.
    phone.dataset.scene = "practice";
    en.querySelector(".blank")?.classList.add("active");
    const letters = ["ed", "bol", "t"];
    slots.innerHTML = "";
    tiles.innerHTML = letters.map((part) => `<span class="tile">${part}</span>`).join("");
    check.classList.remove("go");
    await wait(1100);
    for (const part of ["bol", "t", "ed"]) {
      const tile = [...tiles.children].find((item) => item.textContent === part);
      tile?.remove();
      slots.insertAdjacentHTML("beforeend", `<span class="tile">${part}</span>`);
      await wait(420);
    }
    check.classList.add("go");
    await wait(600);
    phone.classList.add("checked");
    const blank = en.querySelector(".blank");
    blank?.classList.remove("active");
    blank?.classList.add("right");
    await wait(3200);
  };
  if (phone) {
    if (reduce) showStatic();
    else loop(phone, heroRun);
  }

  // ---------- Photo flow: the note appears while in view ----------
  loop(document.querySelector('[data-play="flow"]'), () => wait(4000));

  // ---------- Rewrite toggle ----------
  const toggle = document.getElementById("toggle-demo");
  const pill = document.getElementById("toggle-pill");
  const modes = [["en", "英文"], ["bi", "双语对照"], ["orig", "原文"]];
  loop(toggle?.closest(".stage"), async () => {
    for (const [mode, label] of modes) {
      toggle.dataset.mode = mode;
      pill.textContent = label;
      pill.classList.toggle("on", mode !== "en");
      await wait(2200);
    }
  });

  // ---------- Cloze colours ----------
  const clozeStage = document.querySelector('[data-play="cloze"]');
  if (clozeStage && reduce) clozeStage.querySelectorAll(".cz").forEach((blank) => { blank.className = `cz ${blank.dataset.final}`; });
  loop(clozeStage, async () => {
    const blanks = [...clozeStage.querySelectorAll(".cz")];
    const buttons = [...clozeStage.querySelectorAll(".cloze-buttons span")];
    blanks.forEach((blank) => { blank.className = "cz gray"; });
    await wait(1000);
    const steps = [[0, 1], [1, 0]];
    for (const [index, button] of steps) {
      buttons[button].classList.add("tap");
      await wait(200);
      buttons[button].classList.remove("tap");
      blanks[index].className = `cz ${blanks[index].dataset.final}`;
      await wait(1100);
    }
    await wait(2600);
  });

  // ---------- Blind box deck ----------
  const deck = document.getElementById("deck");
  const deckProgress = document.getElementById("deck-progress");
  let dealt = 1;
  loop(deck?.closest(".stage"), async () => {
    await wait(1800);
    const cards = [...deck.querySelectorAll(".deck-card")];
    const top = cards.find((card) => card.classList.contains("s0"));
    top.classList.add("out");
    top.classList.remove("s0");
    const s1 = cards.find((card) => card.classList.contains("s1"));
    const s2 = cards.find((card) => card.classList.contains("s2"));
    s1?.classList.replace("s1", "s0");
    s2?.classList.replace("s2", "s1");
    dealt = dealt % 5 + 1;
    deckProgress.style.width = `${dealt * 20}%`;
    await wait(650);
    top.classList.remove("out");
    top.classList.add("s2");
  });

  // ---------- Memories chips ----------
  const memStage = document.querySelector('[data-play="memories"]');
  loop(memStage, async () => {
    const chips = [...memStage.querySelectorAll(".chips span")];
    for (const chip of chips) {
      chips.forEach((item) => item.classList.toggle("lit", item === chip));
      await wait(1800);
    }
  });

  // ---------- Podcast lines ----------
  const line = document.getElementById("podcast-line");
  const lines = [
    "Took Doudou for a walk by the river today.",
    "The second he saw the water, he bolted.",
    "We both ended up soaked — totally worth it.",
  ];
  let lineIndex = 0;
  loop(line?.closest(".stage"), async () => {
    await wait(2600);
    line.style.opacity = "0";
    await wait(350);
    lineIndex = (lineIndex + 1) % lines.length;
    line.textContent = lines[lineIndex];
    line.style.opacity = "1";
  });

  // ---------- OIO AI chat → card ----------
  const chat = document.getElementById("chat");
  const offer = document.getElementById("save-offer");
  const card = document.getElementById("dialogue-card");
  const showChat = () => {
    chat.querySelectorAll(".bubble").forEach((bubble) => bubble.classList.add("on"));
    offer.classList.add("on", "done");
    offer.textContent = "✓ 已存为卡片 · 查看";
    card.classList.add("on");
  };
  if (chat && reduce) showChat();
  loop(chat?.closest(".stage"), async () => {
    const bubbles = [...chat.querySelectorAll(".bubble")];
    bubbles.forEach((bubble) => bubble.classList.remove("on"));
    offer.classList.remove("on", "done");
    offer.textContent = "▢ 把这段对话存成卡片";
    card.classList.remove("on");
    await wait(500);
    for (const bubble of bubbles) { bubble.classList.add("on"); await wait(900); }
    offer.classList.add("on");
    await wait(1200);
    offer.classList.add("done");
    offer.textContent = "✓ 已存为卡片 · 查看";
    card.classList.add("on");
    await wait(4200);
  });
})();
