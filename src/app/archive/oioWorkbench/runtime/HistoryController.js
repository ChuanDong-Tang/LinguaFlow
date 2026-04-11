import {
  startOfLocalDay,
  dateToLocalKey,
  toLocalDateKeyFromSaved,
  startOfLocalWeekMonday,
  addDaysDate,
  addMonthsClamp,
  addYearsClamp,
  formatKeyToSlashDisplay,
  parseSlashDateInput,
  formatZhDateLong,
} from "../../../dateUtils.js";
import { WEEK_LABELS_MON } from "./constants.js";

export class HistoryController {
  constructor({
    dom,
    getState,
    setState,
    listSessions,
    buildEntryRow,
    getDayAverage,
    createAverageRing,
    attachDayRing,
    setGranularitySelectValue,
    onStorageError,
  }) {
    this.dom = dom;
    this.getState = getState;
    this.setState = setState;
    this.listSessions = listSessions;
    this.buildEntryRow = buildEntryRow;
    this.getDayAverage = getDayAverage;
    this.createAverageRing = createAverageRing;
    this.attachDayRing = attachDayRing;
    this.setGranularitySelectValue = setGranularitySelectValue;
    this.onStorageError = onStorageError;
    this.eventsBound = false;
  }

  wireEvents({ onLoad, onDownload, onDelete } = {}) {
    if (this.eventsBound) return;
    this.eventsBound = true;

    const {
      granularityEl,
      navRoot,
      magicCard,
      quickJumpBtn,
      jumpText,
      jumpCancel,
      jumpConfirm,
    } = this.dom;

    granularityEl?.addEventListener("change", () => {
      const mode = granularityEl.value;
      if (mode !== "today" && mode !== "week" && mode !== "month" && mode !== "all") return;
      this.setGranularity(mode);
      this.renderHistoryList().catch(() => {});
    });

    navRoot?.addEventListener("click", (evt) => {
      const weekBtn = evt.target.closest("[data-history-week-delta]");
      if (weekBtn && navRoot.contains(weekBtn)) {
        const delta = Number(weekBtn.dataset.historyWeekDelta);
        if (Number.isFinite(delta)) {
          this.shiftWeek(delta);
          this.renderHistoryList().catch(() => {});
        }
        return;
      }

      const monthBtn = evt.target.closest("[data-history-month-delta]");
      if (monthBtn && navRoot.contains(monthBtn)) {
        const delta = Number(monthBtn.dataset.historyMonthDelta);
        if (Number.isFinite(delta)) {
          this.shiftMonth(delta);
          this.renderHistoryList().catch(() => {});
        }
        return;
      }

      const dayBtn = evt.target.closest("[data-history-day-key]");
      if (dayBtn && navRoot.contains(dayBtn)) {
        const key = dayBtn.dataset.historyDayKey;
        if (key) {
          this.selectDay(key);
          this.renderHistoryList().catch(() => {});
        }
      }
    });

    navRoot?.addEventListener("change", (evt) => {
      const target = evt.target;
      if (target?.classList.contains("history-cal-year-sel")) {
        const y = Number(target.value);
        if (Number.isFinite(y)) {
          this.setCalendarYear(y);
          this.renderHistoryList().catch(() => {});
        }
        return;
      }
      if (target?.classList.contains("history-cal-month-sel")) {
        const m = Number(target.value) - 1;
        if (Number.isFinite(m) && m >= 0 && m <= 11) {
          this.setCalendarMonth(m);
          this.renderHistoryList().catch(() => {});
        }
      }
    });

    magicCard?.addEventListener("click", async (evt) => {
      const loadId = evt.target.closest("[data-history-load]")?.dataset?.historyLoad;
      const dlId = evt.target.closest("[data-history-download]")?.dataset?.historyDownload;
      const delId = evt.target.closest("[data-history-delete]")?.dataset?.historyDelete;

      if (loadId) {
        await onLoad?.(loadId);
        return;
      }
      if (dlId) {
        await onDownload?.(dlId);
        return;
      }
      if (delId) {
        await onDelete?.(delId);
      }
    });

    quickJumpBtn?.addEventListener("click", () => {
      this.openJumpDialog();
    });

    jumpText?.addEventListener("blur", () => {
      this.handleJumpTextBlur(jumpText.value ?? "");
    });

    jumpCancel?.addEventListener("click", () => {
      this.dom.jumpDialog?.close();
    });

    jumpConfirm?.addEventListener("click", () => {
      if (this.applyJumpFromText(jumpText?.value ?? "")) {
        this.renderHistoryList().catch(() => {});
      }
    });
  }

  initDateState() {
    const now = startOfLocalDay(new Date());
    this.setState({
      weekStart: startOfLocalWeekMonday(now),
      year: now.getFullYear(),
      month: now.getMonth(),
      selectedDay: dateToLocalKey(now),
    });
  }

  setCurrentHistoryEntryId(id) {
    this.setState({ currentEntryId: id || null });
  }

  getCurrentHistoryEntryId() {
    return this.getState().currentEntryId;
  }

  clearCurrentHistoryEntryId() {
    this.setState({ currentEntryId: null });
  }

  markSessionSaved(savedAt, id) {
    const dt = new Date(savedAt);
    if (Number.isNaN(dt.getTime())) return;
    this.setState({
      selectedDay: dateToLocalKey(dt),
      weekStart: startOfLocalWeekMonday(dt),
      year: dt.getFullYear(),
      month: dt.getMonth(),
      currentEntryId: id || null,
    });
  }

  setGranularity(mode, { align = true } = {}) {
    if (mode !== "today" && mode !== "week" && mode !== "month" && mode !== "all") return;
    this.setState({ granularity: mode });
    this.setGranularitySelectValue?.(mode);
    if (align) this.alignHistoryStateToGranularity(mode);
  }

  getGranularity() {
    return this.getState().granularity;
  }

  alignHistoryStateToGranularity(mode) {
    const now = startOfLocalDay(new Date());
    if (mode === "week") {
      this.setState({ weekStart: startOfLocalWeekMonday(now), selectedDay: dateToLocalKey(now) });
      return;
    }
    if (mode === "month") {
      this.setState({
        year: now.getFullYear(),
        month: now.getMonth(),
        selectedDay: dateToLocalKey(now),
      });
    }
  }

  ensureWeekSelectionInRange() {
    const s = this.getState();
    const start = s.weekStart;
    for (let i = 0; i < 7; i++) {
      if (dateToLocalKey(addDaysDate(start, i)) === s.selectedDay) return;
    }
    this.setState({ selectedDay: dateToLocalKey(start) });
  }

  ensureMonthSelectionInMonth() {
    const s = this.getState();
    const parts = String(s.selectedDay || "").split("-");
    if (parts.length !== 3) {
      this.setState({ selectedDay: dateToLocalKey(new Date(s.year, s.month, 1)) });
      return;
    }
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    if (y === s.year && m === s.month) return;
    const now = startOfLocalDay(new Date());
    this.setState({
      selectedDay:
        now.getFullYear() === s.year && now.getMonth() === s.month
          ? dateToLocalKey(now)
          : dateToLocalKey(new Date(s.year, s.month, 1)),
    });
  }

  shiftWeek(delta) {
    const s = this.getState();
    this.setState({ weekStart: addDaysDate(s.weekStart, 7 * delta) });
  }

  shiftMonth(delta) {
    const s = this.getState();
    const d = addMonthsClamp(new Date(s.year, s.month, 1), delta);
    this.setState({ year: d.getFullYear(), month: d.getMonth() });
  }

  setCalendarYear(year) {
    if (!Number.isFinite(year)) return;
    this.setState({ year });
    this.ensureMonthSelectionInMonth();
  }

  setCalendarMonth(month) {
    if (!Number.isFinite(month) || month < 0 || month > 11) return;
    this.setState({ month });
    this.ensureMonthSelectionInMonth();
  }

  selectDay(dayKey) {
    if (!dayKey) return;
    this.setState({ selectedDay: dayKey });
  }

  syncJumpInput() {
    const { jumpText } = this.dom;
    if (jumpText) jumpText.value = formatKeyToSlashDisplay(this.getState().jumpDay);
  }

  syncJumpConfirmState() {
    const { jumpConfirm } = this.dom;
    if (jumpConfirm) jumpConfirm.disabled = !this.getState().jumpDay;
  }

  openJumpDialog() {
    const { selectedDay } = this.getState();
    const parsed = String(selectedDay || "").split("-").map(Number);
    const valid = parsed.length === 3 && parsed.every((v) => Number.isFinite(v));
    this.setState({ jumpDay: valid ? selectedDay : dateToLocalKey(new Date()) });
    this.syncJumpInput();
    this.syncJumpConfirmState();
    this.dom.jumpDialog?.showModal();
  }

  handleJumpTextBlur(raw) {
    const parsed = parseSlashDateInput(raw || "");
    if (parsed) this.setState({ jumpDay: parsed });
    this.syncJumpInput();
    this.syncJumpConfirmState();
  }

  applyJumpFromText(raw) {
    const parsed = parseSlashDateInput(raw || "");
    if (parsed) this.setState({ jumpDay: parsed });
    const { jumpDay } = this.getState();
    if (!jumpDay) return false;

    this.setState({ selectedDay: jumpDay, granularity: "month" });
    this.setGranularitySelectValue?.("month");

    const p = jumpDay.split("-").map(Number);
    if (p.length === 3 && p.every((v) => Number.isFinite(v))) {
      const [y, m, d] = p;
      this.setState({
        weekStart: startOfLocalWeekMonday(new Date(y, m - 1, d)),
        year: y,
        month: m - 1,
      });
    }

    this.dom.jumpDialog?.close();
    return true;
  }

  groupByLocalDate(rows) {
    const out = new Map();
    for (const row of rows) {
      const key = toLocalDateKeyFromSaved(row.savedAt);
      if (!key) continue;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(row);
    }
    for (const list of out.values()) list.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    return out;
  }

  getDayRows(map, key) {
    return map.get(key) || [];
  }

  renderEntries(title, rows, labeler) {
    const { entriesRoot } = this.dom;
    if (!entriesRoot) return;

    entriesRoot.replaceChildren();

    if (title) {
      const titleEl = document.createElement("p");
      titleEl.className = "history-entries-title";
      titleEl.textContent = title;
      entriesRoot.appendChild(titleEl);
    }

    if (!rows.length) {
      const emptyEl = document.createElement("p");
      emptyEl.className = "history-entries-empty";
      emptyEl.textContent = "暂无记录";
      entriesRoot.appendChild(emptyEl);
      return;
    }

    const currentId = this.getState().currentEntryId;
    for (const row of rows) {
      entriesRoot.appendChild(this.buildEntryRow(row, labeler(row), currentId));
    }
  }

  renderToday(grouped) {
    const { navRoot, contextLabel } = this.dom;
    if (!navRoot) return;

    navRoot.replaceChildren();
    if (contextLabel) contextLabel.textContent = "今日回顾";

    const stack = document.createElement("div");
    stack.className = "history-today-stack";

    const now = startOfLocalDay(new Date());
    const blocks = [
      { title: "今日生成", date: now },
      { title: "上周今日", date: addDaysDate(now, -7) },
      { title: "上月今日", date: addMonthsClamp(now, -1) },
      { title: "去年今日", date: addYearsClamp(now, -1) },
    ];

    for (const { title, date } of blocks) {
      const rows = this.getDayRows(grouped, dateToLocalKey(date));
      const block = document.createElement("div");
      block.className = "history-today-block";

      const titleRow = document.createElement("p");
      titleRow.className = "history-today-block-title";

      const titleText = document.createElement("span");
      titleText.textContent = `${title} `;

      const dateText = document.createElement("span");
      dateText.className = "history-today-block-date";
      dateText.textContent = `（${formatZhDateLong(date)}）`;

      titleRow.appendChild(titleText);
      titleRow.appendChild(dateText);

      const head = document.createElement("div");
      head.className = "history-today-block-head";
      head.appendChild(titleRow);

      if (rows.length) {
        const avg = this.getDayAverage(rows);
        if (avg) {
          const ring = this.createAverageRing(avg.percent, avg.count, {
            size: 30,
            wrapClass: "history-today-fb-ring-wrap",
          });
          if (ring) head.appendChild(ring);
        }
      }

      block.appendChild(head);

      if (rows.length) {
        const currentId = this.getState().currentEntryId;
        for (const row of rows) {
          const wrap = document.createElement("div");
          wrap.style.marginTop = "0.35rem";
          wrap.appendChild(this.buildEntryRow(row, row.basename || "（未命名）", currentId));
          block.appendChild(wrap);
        }
      } else {
        const empty = document.createElement("p");
        empty.className = "history-entries-empty";
        empty.style.margin = "0";
        empty.textContent = "该日暂无记录";
        block.appendChild(empty);
      }

      stack.appendChild(block);
    }

    navRoot.appendChild(stack);
  }

  renderWeek(grouped) {
    const { navRoot, contextLabel } = this.dom;
    if (!navRoot) return;

    navRoot.replaceChildren();

    const s = this.getState();
    const weekStart = s.weekStart;
    const weekEnd = addDaysDate(weekStart, 6);
    if (contextLabel) contextLabel.textContent = `${formatZhDateLong(weekStart)} ～ ${formatZhDateLong(weekEnd)}`;

    const toolbar = document.createElement("div");
    toolbar.className = "history-week-toolbar";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "secondary";
    prevBtn.dataset.historyWeekDelta = "-1";
    prevBtn.textContent = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "secondary";
    nextBtn.dataset.historyWeekDelta = "1";
    nextBtn.textContent = "›";

    const spacer = document.createElement("div");
    spacer.className = "history-week-spacer";

    toolbar.appendChild(prevBtn);
    toolbar.appendChild(spacer);
    toolbar.appendChild(nextBtn);
    navRoot.appendChild(toolbar);

    const dow = document.createElement("div");
    dow.className = "history-cal-dow-row";
    for (let i = 0; i < 7; i++) {
      const cell = document.createElement("div");
      cell.className = "history-cal-dow-cell";
      cell.textContent = WEEK_LABELS_MON[i];
      dow.appendChild(cell);
    }
    navRoot.appendChild(dow);

    const strip = document.createElement("div");
    strip.className = "history-week-strip";
    const todayKey = dateToLocalKey(new Date());
    const selectedKey = this.getState().selectedDay;

    for (let i = 0; i < 7; i++) {
      const day = addDaysDate(weekStart, i);
      const key = dateToLocalKey(day);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-day-cell";
      btn.dataset.historyDayKey = key;
      if (key === selectedKey) btn.classList.add("history-day-cell--selected");
      if (key === todayKey) btn.classList.add("history-day-cell--today");

      const rows = this.getDayRows(grouped, key);
      if (rows.length > 0) btn.classList.add("history-day-cell--has-sessions");

      const n = document.createElement("span");
      n.className = "history-day-cell-num";
      n.textContent = String(day.getDate());
      btn.appendChild(n);

      this.attachDayRing(btn, rows);
      strip.appendChild(btn);
    }

    navRoot.appendChild(strip);
  }

  renderMonth(grouped) {
    const { navRoot, contextLabel } = this.dom;
    if (!navRoot) return;

    navRoot.replaceChildren();

    const s = this.getState();
    const y = s.year;
    const m = s.month;
    if (contextLabel) contextLabel.textContent = "练习日历";

    const calendar = document.createElement("div");
    calendar.className = "daily-capture-calendar history-calendar-shared";

    const top = document.createElement("div");
    top.className = "daily-capture-calendar-top";

    const jump = document.createElement("div");
    jump.className = "daily-capture-calendar-jump";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "secondary daily-capture-calendar-nav-arrow";
    prevBtn.dataset.historyMonthDelta = "-1";
    prevBtn.setAttribute("aria-label", "Previous month");
    prevBtn.textContent = "←";

    const yearSel = document.createElement("select");
    yearSel.className = "history-cal-ym-sel history-cal-year-sel daily-capture-calendar-select";
    yearSel.setAttribute("aria-label", "Year");

    const thisYear = new Date().getFullYear();
    for (let v = thisYear + 1; v >= thisYear - 20; v--) {
      const op = document.createElement("option");
      op.value = String(v);
      op.textContent = `${v} 年`;
      if (v === y) op.selected = true;
      yearSel.appendChild(op);
    }

    const monthSel = document.createElement("select");
    monthSel.className = "history-cal-ym-sel history-cal-month-sel daily-capture-calendar-select";
    monthSel.setAttribute("aria-label", "Month");
    for (let v = 0; v < 12; v++) {
      const op = document.createElement("option");
      op.value = String(v + 1);
      op.textContent = `${v + 1} 月`;
      if (v === m) op.selected = true;
      monthSel.appendChild(op);
    }

    jump.appendChild(yearSel);
    jump.appendChild(monthSel);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "secondary daily-capture-calendar-nav-arrow";
    nextBtn.dataset.historyMonthDelta = "1";
    nextBtn.setAttribute("aria-label", "Next month");
    nextBtn.textContent = "→";

    const caption = document.createElement("strong");
    caption.className = "daily-capture-calendar-caption";
    caption.textContent = `${y} 年 ${m + 1} 月`;

    top.appendChild(jump);
    top.appendChild(caption);
    calendar.appendChild(top);

    const dowRow = document.createElement("div");
    dowRow.className = "daily-capture-calendar-dow history-cal-dow-row";
    for (let i = 0; i < 7; i++) {
      const cell = document.createElement("span");
      cell.className = "history-cal-dow-cell";
      cell.textContent = WEEK_LABELS_MON[i];
      dowRow.appendChild(cell);
    }
    calendar.appendChild(dowRow);

    let firstDow = new Date(y, m, 1).getDay();
    firstDow = firstDow === 0 ? 6 : firstDow - 1;
    const days = new Date(y, m + 1, 0).getDate();

    const grid = document.createElement("div");
    grid.className = "history-cal-grid daily-capture-calendar-grid";

    for (let i = 0; i < firstDow; i++) {
      const empty = document.createElement("div");
      empty.className = "history-cal-cell history-cal-cell--empty";
      grid.appendChild(empty);
    }

    const todayKey = dateToLocalKey(new Date());
    const selectedKey = this.getState().selectedDay;

    for (let day = 1; day <= days; day++) {
      const key = dateToLocalKey(new Date(y, m, day));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-cal-cell";
      btn.dataset.historyDayKey = key;
      if (key === selectedKey) btn.classList.add("history-cal-cell--selected");
      if (key === todayKey) btn.classList.add("history-cal-cell--today");

      const rows = this.getDayRows(grouped, key);
      if (rows.length > 0) btn.classList.add("history-cal-cell--has-sessions");

      const num = document.createElement("span");
      num.className = "history-cal-cell-num";
      num.textContent = String(day);
      btn.appendChild(num);

      this.attachDayRing(btn, rows);
      grid.appendChild(btn);
    }

    const used = firstDow + days;
    const tail = used % 7 === 0 ? 0 : 7 - (used % 7);
    for (let i = 0; i < tail; i++) {
      const empty = document.createElement("div");
      empty.className = "history-cal-cell history-cal-cell--empty";
      grid.appendChild(empty);
    }

    calendar.appendChild(grid);

    const nav = document.createElement("div");
    nav.className = "daily-capture-calendar-nav";
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    calendar.appendChild(nav);

    navRoot.appendChild(calendar);
  }

  renderAllNav(total) {
    const { navRoot, contextLabel } = this.dom;
    if (!navRoot) return;

    navRoot.replaceChildren();
    if (contextLabel) contextLabel.textContent = "全部历史";

    const bar = document.createElement("div");
    bar.className = "history-all-nav-bar";

    const p = document.createElement("p");
    p.className = "history-all-nav-summary";
    p.textContent =
      total === 0
        ? "暂无记录"
        : `共 ${total} 条，见下方列表。`;

    bar.appendChild(p);
    navRoot.appendChild(bar);
  }

  async renderHistoryList(opts = {}) {
    const { navRoot, entriesRoot, granularityEl, magicCard } = this.dom;
    if (!navRoot || !entriesRoot) return;

    const granularity = this.getState().granularity;
    if (granularityEl && granularityEl.value !== granularity) granularityEl.value = granularity;

    let rows;
    try {
      rows = await this.listSessions();
    } catch (err) {
      console.error(err);
      this.onStorageError?.();
      navRoot.replaceChildren();
      const p = document.createElement("p");
      p.className = "history-nav-error";
      p.textContent = "无法读取本地历史（IndexedDB 不可用）。";
      navRoot.appendChild(p);
      entriesRoot.replaceChildren();
      return;
    }

    const grouped = this.groupByLocalDate(rows);
    const scrollToId = opts.scrollToId ?? this.getState().currentEntryId;

    switch (granularity) {
      case "today": {
        this.renderToday(grouped);
        entriesRoot.replaceChildren();
        break;
      }
      case "week": {
        this.ensureWeekSelectionInRange();
        this.renderWeek(grouped);
        this.renderEntries("当日记录", this.getDayRows(grouped, this.getState().selectedDay), (r) => r.basename || "（未命名）");
        break;
      }
      case "month": {
        this.ensureMonthSelectionInMonth();
        this.renderMonth(grouped);
        this.renderEntries("所选日期", this.getDayRows(grouped, this.getState().selectedDay), (r) => r.basename || "（未命名）");
        break;
      }
      case "all": {
        this.renderAllNav(rows.length);
        entriesRoot.replaceChildren();

        if (rows.length) {
          const title = document.createElement("p");
          title.className = "history-entries-title";
          title.textContent = "全部条目";
          entriesRoot.appendChild(title);

          const byDay = new Map();
          for (const row of rows) {
            const day = toLocalDateKeyFromSaved(row.savedAt) || "未知日期";
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(row);
          }

          const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
          const currentId = this.getState().currentEntryId;

          for (const day of days) {
            const list = byDay.get(day);
            for (let i = 0; i < list.length; i++) {
              const row = list[i];
              const idx = i + 1;
              let label = day;
              try {
                const [yy, mm, dd] = day.split("-").map(Number);
                label = new Date(yy, mm - 1, dd).toLocaleDateString("zh-Hans-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });
              } catch {}
              entriesRoot.appendChild(this.buildEntryRow(row, `${label} 第${idx}条`, currentId));
            }
          }
        } else {
          const empty = document.createElement("p");
          empty.className = "history-entries-empty";
          empty.textContent = "暂无记录";
          entriesRoot.appendChild(empty);
        }

        break;
      }
      default:
        break;
    }

    if (scrollToId && magicCard) {
      requestAnimationFrame(() => {
        [...magicCard.querySelectorAll("[data-history-entry-id]")]
          .find((el) => el.dataset.historyEntryId === scrollToId)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }
}

