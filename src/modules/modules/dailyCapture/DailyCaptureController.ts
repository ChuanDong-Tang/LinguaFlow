import { getCapturePracticeBlankIndexes, getCapturePracticeCorrectBlankIndexes } from "../../domain/capture";
import { getPhraseTier, normalizePhraseKey } from "../../domain/proficiency";
import { addMonthsClamp, dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { confirmDialog } from "../../shared/confirmDialog";
import { escapeHtml } from "../../shared/html";
import { renderTextWithKeyPhraseHighlight } from "../../shared/keyPhraseHighlight";
import { deleteCaptureItems, pullCaptureIndex, pullCaptureRecordByDate, pushCaptureRecord } from "../../services/cloud/cloudSyncService";
import { fetchPhraseProficiencyScores } from "../../services/proficiency/phraseProficiencyService";
import { getI18n, t } from "../../i18n/i18n";
import { onDailyCaptureUpdated } from "./dailyCaptureEvents";
import { type CaptureItem, type DailyCaptureRecord, listCaptureRecords, saveCaptureRecord } from "./dailyCaptureStore";

const PRACTICE_RUNTIME_READY_EVENT = "practice-runtime-ready";

type PendingPracticeLaunch = {
  practiceText: string;
  cardChunks?: string[];
  cardPhraseChunks?: string[][];
  captureItemId?: string;
  blankIndexes?: number[];
  correctBlankIndexes?: number[];
};

export class DailyCaptureController {
  private readonly root: HTMLElement | null;
  private readonly gridEl: HTMLElement | null;
  private readonly monthLabelEl: HTMLElement | null;
  private readonly monthChipEl: HTMLElement | null;
  private readonly prevBtnEl: HTMLButtonElement | null;
  private readonly nextBtnEl: HTMLButtonElement | null;
  private readonly practiceSelectedDayBtnEl: HTMLButtonElement | null;
  private readonly dayDetailPanelEl: HTMLElement | null;
  private readonly dayDialogTitleEl: HTMLElement | null;
  private readonly dayDialogMetaEl: HTMLElement | null;
  private readonly dayDialogBodyEl: HTMLElement | null;
  private readonly dayPracticeCurrentEl: HTMLButtonElement | null;
  private readonly dayDeleteCurrentEl: HTMLButtonElement | null;
  private readonly dayDialogPrevEl: HTMLButtonElement | null;
  private readonly dayDialogNextEl: HTMLButtonElement | null;
  private readonly practiceHostEl: HTMLElement | null;
  private records: DailyCaptureRecord[] = [];
  private monthCursor = new Date();
  private selectedDateKey = "";
  private dialogDateKey = "";
  private dialogItemIndex = 0;
  private cloudCountByDate = new Map<string, number>();
  private phraseScoreByNorm = new Map<string, number>();
  private practiceRuntimeReady = false;
  private pendingPracticeLaunch: PendingPracticeLaunch | null = null;
  private practiceLoadingNoticeEl: HTMLDivElement | null = null;
  private syncingDateKeys = new Set<string>();

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-daily-capture"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.gridEl = root?.querySelector<HTMLElement>("[data-daily-capture-grid]") ?? null;
    this.monthLabelEl = root?.querySelector<HTMLElement>("[data-daily-capture-month-label]") ?? null;
    this.monthChipEl = root?.querySelector<HTMLElement>("[data-daily-capture-month-chip]") ?? null;
    this.prevBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-prev-month], [data-daily-capture-prev]") ?? null;
    this.nextBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-next-month], [data-daily-capture-next]") ?? null;
    this.practiceSelectedDayBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-practice-selected-day]") ?? null;
    this.dayDetailPanelEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-panel]") ?? null;
    this.dayDialogTitleEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-title]") ?? null;
    this.dayDialogMetaEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-meta]") ?? null;
    this.dayDialogBodyEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-body]") ?? null;
    this.dayPracticeCurrentEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-practice-current]") ?? null;
    this.dayDeleteCurrentEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-delete-current]") ?? null;
    this.dayDialogPrevEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-item-prev]") ?? null;
    this.dayDialogNextEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-item-next]") ?? null;
    this.practiceHostEl = root?.querySelector<HTMLElement>("[data-daily-capture-practice-host]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.gridEl) return;
    this.practiceRuntimeReady = this.getPracticeRuntimeReadyFlag();
    this.embedPracticePanel();
    await this.cleanupLegacyPreviewMockRecords();
    await this.loadRecords();
    this.bindEvents();
    getI18n().subscribe(() => {
      this.renderCalendar();
      this.renderDayDialog();
    });
    this.renderCalendar();
    this.renderDayDialog();
    void this.syncRecordsFromCloud();
  }

  private bindEvents(): void {
    document.addEventListener(PRACTICE_RUNTIME_READY_EVENT, () => {
      this.practiceRuntimeReady = true;
      this.hidePracticeLoadingNotice();
      const pending = this.pendingPracticeLaunch;
      this.pendingPracticeLaunch = null;
      if (!pending) return;
      this.commitPracticeLaunch(pending);
    });

    this.prevBtnEl?.addEventListener("click", () => {
      this.monthCursor = addMonthsClamp(this.monthCursor, -1);
      this.renderCalendar();
    });

    this.nextBtnEl?.addEventListener("click", () => {
      this.monthCursor = addMonthsClamp(this.monthCursor, 1);
      this.renderCalendar();
    });

    this.root?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const dayBtn = target?.closest<HTMLButtonElement>("[data-capture-day]");
      if (dayBtn) {
        const dateKey = dayBtn.dataset.captureDay?.trim() ?? "";
        const hasData = dayBtn.dataset.captureHasData === "1";
        if (!dateKey || !hasData) return;
        this.selectedDateKey = dateKey;
        this.renderCalendar();
        void this.openDayDialog(dateKey);
        return;
      }

      const oioBtn = target?.closest<HTMLButtonElement>("[data-capture-practice-oio]");
      if (oioBtn) {
        const itemId = oioBtn.dataset.capturePracticeOio?.trim() ?? "";
        if (!itemId) return;
        const item = this.findItemById(itemId);
        if (!item) return;
        this.launchOioPractice(item);
        return;
      }

      const practiceCurrentBtn = target?.closest<HTMLButtonElement>("[data-daily-capture-practice-current]");
      if (practiceCurrentBtn) {
        const currentItem = this.getCurrentDialogItem();
        if (!currentItem) return;
        this.launchOioPractice(currentItem);
        return;
      }

      const deleteCurrentBtn = target?.closest<HTMLButtonElement>("[data-daily-capture-delete-current]");
      if (deleteCurrentBtn) {
        const currentItem = this.getCurrentDialogItem();
        if (!currentItem) return;
        void this.removeCaptureItem(currentItem.id);
        return;
      }

      const practiceSelectedDayBtn = target?.closest<HTMLButtonElement>("[data-daily-capture-practice-selected-day]");
      if (practiceSelectedDayBtn) {
        this.launchSelectedDayPractice();
        return;
      }

      const deleteBtn = target?.closest<HTMLButtonElement>("[data-capture-delete]");
      if (deleteBtn) {
        const itemId = deleteBtn.dataset.captureDelete?.trim() ?? "";
        if (!itemId) return;
        void this.removeCaptureItem(itemId);
      }
    });

    this.dayDialogPrevEl?.addEventListener("click", () => {
      this.shiftDialogItem(-1);
    });
    this.dayDialogNextEl?.addEventListener("click", () => {
      this.shiftDialogItem(1);
    });
    onDailyCaptureUpdated(async ({ dateKey }) => {
      await this.refreshFromStore(dateKey);
    });

    document.addEventListener("app-tab-change", async (event) => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail;
      if (detail?.tabId !== "daily-capture") return;
      await this.syncRecordsFromCloud();
    });
    document.addEventListener("daily-capture-practice-blanks-updated", (event) => {
      const detail = (event as CustomEvent<{ itemId?: string; blankIndexes?: number[] }>).detail;
      const itemId = detail?.itemId?.trim() ?? "";
      const indexes = Array.isArray(detail?.blankIndexes) ? detail.blankIndexes : [];
      if (!itemId) return;
      void this.updatePracticeBlankIndexes(itemId, indexes);
    });
    document.addEventListener("daily-capture-practice-correct-blanks-updated", (event) => {
      const detail = (event as CustomEvent<{ itemId?: string; correctBlankIndexes?: number[] }>).detail;
      const itemId = detail?.itemId?.trim() ?? "";
      const indexes = Array.isArray(detail?.correctBlankIndexes) ? detail.correctBlankIndexes : [];
      if (!itemId) return;
      void this.updatePracticeCorrectBlankIndexes(itemId, indexes);
    });
  }

  private async syncRecordsFromCloud(): Promise<void> {
    try {
      const index = await pullCaptureIndex();
      this.cloudCountByDate = new Map((index ?? []).map((item) => [item.dateKey, item.cardCount]));
      await this.loadRecords();
      this.renderCalendar();
      this.renderDayDialog();
    } catch {
      // ignore cloud sync failures
    }
  }

  private async loadRecords(): Promise<void> {
    this.records = await listCaptureRecords();
    void this.refreshPhraseProficiencyMap();
    if (this.selectedDateKey && !this.records.find((record) => record.dateKey === this.selectedDateKey)) {
      this.selectedDateKey = "";
    }
    if (this.dialogDateKey && !this.records.find((record) => record.dateKey === this.dialogDateKey)) {
      this.dialogDateKey = "";
      this.dialogItemIndex = 0;
    }
  }

  private async refreshFromStore(preferredDateKey?: string): Promise<void> {
    await this.loadRecords();
    if (preferredDateKey && this.records.find((record) => record.dateKey === preferredDateKey)) {
      this.selectedDateKey = preferredDateKey;
      this.dialogDateKey = preferredDateKey;
      const [year, month] = preferredDateKey.split("-").map(Number);
      if (year && month) {
        this.monthCursor = new Date(year, month - 1, 1);
      }
    }
    this.renderCalendar();
    this.renderDayDialog();
  }

  private renderCalendar(): void {
    if (!this.gridEl) return;
    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const monthLabel = `${year} 年 ${month + 1} 月`;
    if (this.monthLabelEl) this.monthLabelEl.textContent = monthLabel;
    if (this.monthChipEl) this.monthChipEl.textContent = monthLabel;

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const countMap = new Map<string, number>();
    const dayScoreMap = new Map<string, number>();
    for (const record of this.records) {
      countMap.set(record.dateKey, Array.isArray(record.items) ? record.items.length : 0);
      dayScoreMap.set(record.dateKey, this.computeRecordAverageAccuracy(record));
    }
    for (const [dateKey, count] of this.cloudCountByDate.entries()) {
      countMap.set(dateKey, Math.max(countMap.get(dateKey) ?? 0, count));
    }

    const cells: string[] = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dateKey = dateToLocalKey(date);
      const count = countMap.get(dateKey) ?? 0;
      const outside = date.getMonth() !== month;
      const hasData = count > 0;
      const active = hasData && dateKey === this.selectedDateKey;
      const dayScore = dayScoreMap.get(dateKey) ?? 0;
      const tier = this.getPracticeAccuracyTier(dayScore);
      const normalizedDayScore = Math.max(0, Math.min(100, Number.isFinite(dayScore) ? dayScore : 0));
      const dayFillStrength = (0.08 + normalizedDayScore * 0.0042).toFixed(3);
      cells.push(`
        <button
          type="button"
          class="daily-capture-day${active ? " is-selected" : ""}${outside ? " is-muted" : ""}${hasData ? " is-marked" : " is-empty"}${hasData ? ` is-tier-${tier}` : ""}"
          data-capture-day="${escapeHtml(dateKey)}"
          data-capture-has-data="${hasData ? "1" : "0"}"
          data-capture-accuracy="${normalizedDayScore}"
          style="${hasData ? `--capture-day-fill:${dayFillStrength};` : ""}"
          ${hasData ? "" : "disabled"}
        >
          <span class="daily-capture-day-date">${date.getDate()}</span>
          <span class="daily-capture-day-count">${hasData ? `${count}` : ""}</span>
        </button>
      `);
    }
    this.gridEl.innerHTML = cells.join("");
    this.syncPracticeSelectedDayButton();
  }

  private async openDayDialog(dateKey: string): Promise<void> {
    const record = this.findRecord(dateKey);
    const localCount = record?.items?.length ?? 0;
    const cloudCount = this.cloudCountByDate.get(dateKey) ?? 0;
    if (cloudCount > localCount) {
      await this.syncSingleDayFromCloud(dateKey);
    }
    const latestRecord = this.findRecord(dateKey);
    if (!latestRecord?.items?.length) return;
    this.dialogDateKey = dateKey;
    this.dialogItemIndex = 0;
    this.renderDayDialog();
  }

  private async syncSingleDayFromCloud(dateKey: string): Promise<void> {
    if (this.syncingDateKeys.has(dateKey)) return;
    this.syncingDateKeys.add(dateKey);
    try {
      await pullCaptureRecordByDate(dateKey);
      await this.loadRecords();
      this.renderCalendar();
      if (this.dialogDateKey === dateKey) {
        this.renderDayDialog();
      }
    } catch {
      // ignore
    } finally {
      this.syncingDateKeys.delete(dateKey);
    }
  }

  private shiftDialogItem(delta: number): void {
    const record = this.findRecord(this.dialogDateKey);
    const total = record?.items?.length ?? 0;
    if (!total) return;
    const next = this.dialogItemIndex + delta;
    if (next < 0 || next >= total) return;
    this.dialogItemIndex = next;
    this.renderDayDialog();
  }

  private renderDayDialog(): void {
    if (!this.dayDetailPanelEl || !this.dayDialogBodyEl || !this.dayDialogTitleEl || !this.dayDialogMetaEl) return;
    if (!this.dialogDateKey) {
      this.dayDialogTitleEl.textContent = "";
      this.dayDialogMetaEl.textContent = "";
      this.dayDialogBodyEl.innerHTML = "";
      if (this.dayPracticeCurrentEl) {
        this.dayPracticeCurrentEl.textContent = t("daily_capture.practice_oio");
        this.dayPracticeCurrentEl.disabled = true;
      }
      if (this.dayDeleteCurrentEl) {
        this.dayDeleteCurrentEl.textContent = t("daily_capture.delete");
        this.dayDeleteCurrentEl.disabled = true;
      }
      if (this.dayDialogPrevEl) this.dayDialogPrevEl.disabled = true;
      if (this.dayDialogNextEl) this.dayDialogNextEl.disabled = true;
      return;
    }
    const record = this.findRecord(this.dialogDateKey);
    if (!record?.items?.length) {
      this.dayDialogTitleEl.textContent = "";
      this.dayDialogMetaEl.textContent = "";
      this.dayDialogBodyEl.innerHTML = "";
      if (this.dayPracticeCurrentEl) {
        this.dayPracticeCurrentEl.textContent = t("daily_capture.practice_oio");
        this.dayPracticeCurrentEl.disabled = true;
      }
      if (this.dayDeleteCurrentEl) {
        this.dayDeleteCurrentEl.textContent = t("daily_capture.delete");
        this.dayDeleteCurrentEl.disabled = true;
      }
      if (this.dayDialogPrevEl) this.dayDialogPrevEl.disabled = true;
      if (this.dayDialogNextEl) this.dayDialogNextEl.disabled = true;
      return;
    }

    const total = record.items.length;
    const index = Math.max(0, Math.min(this.dialogItemIndex, total - 1));
    this.dialogItemIndex = index;
    const item = record.items[index];
    const itemNaturalVersion = (item.naturalVersion || item.sourceText || "").trim() || "-";
    const itemReply = (item.reply || item.note || "").trim() || "-";
    const itemKeyPhrases = this.normalizeItemKeyPhrases(item.keyPhrases);
    const itemAccuracy = this.computeItemFillblankAccuracy(item);
    const itemTier = this.getPracticeAccuracyTier(itemAccuracy);
    this.dayDialogTitleEl.textContent = formatKeyToSlashDisplay(record.dateKey);
    this.dayDialogMetaEl.textContent = `${t("daily_capture.card")} ${index + 1} / ${total}`;
    if (this.dayPracticeCurrentEl) {
      this.dayPracticeCurrentEl.textContent = t("daily_capture.practice_oio");
      this.dayPracticeCurrentEl.disabled = false;
    }
    if (this.dayDeleteCurrentEl) {
      this.dayDeleteCurrentEl.textContent = t("daily_capture.delete");
      this.dayDeleteCurrentEl.disabled = false;
    }
    if (this.dayDialogPrevEl) this.dayDialogPrevEl.disabled = index <= 0;
    if (this.dayDialogNextEl) this.dayDialogNextEl.disabled = index >= total - 1;

    this.dayDialogBodyEl.innerHTML = `
      <article class="daily-capture-entry daily-capture-entry--dialog daily-capture-entry--tier-${itemTier}">
        <div class="daily-capture-entry-block">
          <span class="daily-capture-entry-label">${t("daily_capture.label_rewritten")}</span>
          <p class="daily-capture-entry-copy">${renderTextWithKeyPhraseHighlight(itemNaturalVersion, itemKeyPhrases)}</p>
        </div>
        <div class="daily-capture-entry-block">
          <span class="daily-capture-entry-label">${t("daily_capture.label_reply_comment")}</span>
          <p class="daily-capture-entry-copy">${renderTextWithKeyPhraseHighlight(itemReply, itemKeyPhrases)}</p>
        </div>
        <div class="daily-capture-entry-block">
          <span class="daily-capture-entry-label">${t("daily_capture.label_core_phrases")}</span>
          ${this.renderKeyPhrases(itemKeyPhrases)}
        </div>
      </article>
    `;
  }

  private getCurrentDialogItem(): CaptureItem | null {
    const record = this.findRecord(this.dialogDateKey);
    if (!record?.items?.length) return null;
    const index = Math.max(0, Math.min(this.dialogItemIndex, record.items.length - 1));
    return record.items[index] ?? null;
  }

  private findRecord(dateKey: string): DailyCaptureRecord | null {
    return this.records.find((item) => item.dateKey === dateKey) ?? null;
  }

  private findItemById(itemId: string): CaptureItem | null {
    for (const record of this.records) {
      const match = record.items.find((item) => item.id === itemId);
      if (match) return match;
    }
    return null;
  }

  private launchOioPractice(item: CaptureItem): void {
    const practiceText = (item.naturalVersion || item.sourceText || "").trim();
    const keyPhrases = this.normalizeItemKeyPhrases(item.keyPhrases);
    const blankIndexes = getCapturePracticeBlankIndexes(item);
    const correctBlankIndexes = getCapturePracticeCorrectBlankIndexes(item);
    if (!practiceText || practiceText === "-") return;
    this.startPracticeWithText(
      practiceText,
      practiceText ? [practiceText] : undefined,
      keyPhrases.length ? [keyPhrases] : undefined,
      item.id,
      blankIndexes,
      correctBlankIndexes,
    );
  }

  private launchSelectedDayPractice(): void {
    if (!this.selectedDateKey) return;
    const record = this.findRecord(this.selectedDateKey);
    const items = Array.isArray(record?.items) ? record.items : [];
    if (!items.length) return;
    const cardEntries = items
      .map((item) => {
        const text = (item.naturalVersion || item.sourceText || "").trim();
        if (!text || text === "-") return null;
        return {
          text,
          keyPhrases: this.normalizeItemKeyPhrases(item.keyPhrases),
        };
      })
      .filter((entry): entry is { text: string; keyPhrases: string[] } => !!entry);
    if (!cardEntries.length) return;
    const cardChunks = cardEntries.map((entry) => entry.text);
    const cardPhraseChunks = cardEntries.map((entry) => entry.keyPhrases);
    this.startPracticeWithText(cardChunks.join("\n"), cardChunks, cardPhraseChunks, undefined, []);
  }

  private startPracticeWithText(
    practiceText: string,
    cardChunks?: string[],
    cardPhraseChunks?: string[][],
    captureItemId?: string,
    blankIndexes?: number[],
    correctBlankIndexes?: number[],
  ): void {
    const text = practiceText.trim();
    if (!text) return;
    const request: PendingPracticeLaunch = {
      practiceText: text,
      cardChunks,
      cardPhraseChunks,
      captureItemId,
      blankIndexes,
      correctBlankIndexes,
    };
    if (!this.practiceRuntimeReady) {
      this.pendingPracticeLaunch = request;
      this.showPracticeLoadingNotice();
      return;
    }
    this.hidePracticeLoadingNotice();
    this.commitPracticeLaunch(request);
  }

  private commitPracticeLaunch({
    practiceText,
    cardChunks,
    cardPhraseChunks,
    captureItemId,
    blankIndexes,
    correctBlankIndexes,
  }: PendingPracticeLaunch): void {
    const inputEl = document.querySelector<HTMLTextAreaElement>("#text");
    const generateBtn = document.querySelector<HTMLButtonElement>("#generate");
    if (inputEl) {
      inputEl.value = practiceText;
      if (Array.isArray(cardChunks) && cardChunks.length > 0) {
        inputEl.dataset.practiceCardChunks = JSON.stringify(cardChunks);
      } else {
        delete inputEl.dataset.practiceCardChunks;
      }
      if (Array.isArray(cardPhraseChunks) && cardPhraseChunks.length > 0) {
        inputEl.dataset.practiceCardKeyPhrases = JSON.stringify(cardPhraseChunks);
      } else {
        delete inputEl.dataset.practiceCardKeyPhrases;
      }
      if (captureItemId) {
        inputEl.dataset.practiceCaptureItemId = captureItemId;
      } else {
        delete inputEl.dataset.practiceCaptureItemId;
      }
      if (Array.isArray(blankIndexes) && blankIndexes.length > 0) {
        inputEl.dataset.practiceBlankIndexes = JSON.stringify(blankIndexes);
      } else {
        delete inputEl.dataset.practiceBlankIndexes;
      }
      if (Array.isArray(correctBlankIndexes) && correctBlankIndexes.length > 0) {
        inputEl.dataset.practiceCorrectBlankIndexes = JSON.stringify(correctBlankIndexes);
      } else {
        delete inputEl.dataset.practiceCorrectBlankIndexes;
      }
      inputEl.dataset.practiceOpeningHint = "daily";
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    generateBtn?.click();
    const practiceSection = this.root?.querySelector<HTMLElement>("#subs-section");
    practiceSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private getPracticeRuntimeReadyFlag(): boolean {
    const globalWindow = window as Window & { __practiceRuntimeReady?: boolean };
    return globalWindow.__practiceRuntimeReady === true;
  }

  private showPracticeLoadingNotice(): void {
    if (!this.practiceLoadingNoticeEl) {
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.position = "fixed";
      el.style.top = "20px";
      el.style.right = "20px";
      el.style.zIndex = "9999";
      el.style.maxWidth = "320px";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "10px";
      el.style.border = "1px solid var(--v2-border)";
      el.style.background = "var(--v2-surface)";
      el.style.color = "var(--v2-text)";
      el.style.fontSize = "14px";
      el.style.lineHeight = "1.4";
      el.style.boxShadow = "var(--v2-shadow-raised)";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
      this.practiceLoadingNoticeEl = el;
    }
    this.practiceLoadingNoticeEl.textContent = "练习引擎正在加载，马上就好...";
    this.practiceLoadingNoticeEl.hidden = false;
  }

  private hidePracticeLoadingNotice(): void {
    if (!this.practiceLoadingNoticeEl) return;
    this.practiceLoadingNoticeEl.hidden = true;
  }

  private renderKeyPhrases(keyPhrases: string[]): string {
    if (!keyPhrases.length) {
      return `<p class="daily-capture-entry-copy">-</p>`;
    }
    return `<div class="daily-capture-phrase-list">${keyPhrases
      .map((phrase) => this.renderSinglePhraseItem(phrase))
      .join("")}</div>`;
  }

  private renderSinglePhraseItem(phrase: string): string {
    const score = this.getPhraseScore(phrase);
    const tier = getPhraseTier(score);
    const normalizedScore = Number.isFinite(score) ? Math.max(0, score) : 0;
    const strength = Math.max(0, Math.min(1, normalizedScore / 10));
    return `
      <div class="daily-capture-phrase-item">
        <span
          class="chat-highlight-chip daily-capture-phrase-chip is-tier-${tier}"
          style="--phrase-strength:${strength.toFixed(3)};"
        >
          <span>${escapeHtml(phrase)}</span>
          <span class="daily-capture-phrase-score">${Math.max(0, Math.floor(score))}</span>
        </span>
      </div>
    `;
  }

  private async refreshPhraseProficiencyMap(): Promise<void> {
    const phrases: string[] = [];
    for (const record of this.records) {
      for (const item of record.items) {
        for (const phrase of this.normalizeItemKeyPhrases(item.keyPhrases)) {
          phrases.push(phrase);
        }
      }
    }
    if (!phrases.length) {
      this.phraseScoreByNorm = new Map();
      return;
    }
    try {
      const fetched = await fetchPhraseProficiencyScores(phrases);
      this.phraseScoreByNorm = fetched;
    } catch {
      this.phraseScoreByNorm = new Map();
    }
  }

  private getPhraseScore(phrase: string): number {
    const key = normalizePhraseKey(phrase);
    if (!key) return 0;
    const score = this.phraseScoreByNorm.get(key);
    return Number.isFinite(Number(score)) ? Number(score) : 0;
  }

  private computeItemFillblankAccuracy(item: CaptureItem): number {
    const blanks = getCapturePracticeBlankIndexes(item);
    if (!blanks.length) return 0;
    const correctSet = new Set(getCapturePracticeCorrectBlankIndexes(item));
    let correct = 0;
    for (const blankIndex of blanks) {
      if (correctSet.has(blankIndex)) correct += 1;
    }
    return Math.round((correct / blanks.length) * 100);
  }

  private computeRecordAverageAccuracy(record: DailyCaptureRecord): number {
    const items = Array.isArray(record.items) ? record.items : [];
    if (!items.length) return 0;
    const total = items.reduce((sum, item) => sum + this.computeItemFillblankAccuracy(item), 0);
    return Math.round(total / items.length);
  }

  private getPracticeAccuracyTier(percent: number): "level_1" | "level_2" | "level_3" {
    const safe = Number.isFinite(Number(percent)) ? Number(percent) : 0;
    if (safe >= 70) return "level_3";
    if (safe >= 30) return "level_2";
    return "level_1";
  }

  private normalizeItemKeyPhrases(value: CaptureItem["keyPhrases"]): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((phrase) => String(phrase ?? "").trim().replace(/\s+/g, " "))
      .filter(Boolean);
  }

  private syncPracticeSelectedDayButton(): void {
    if (!this.practiceSelectedDayBtnEl) return;
    this.practiceSelectedDayBtnEl.textContent = t("daily_capture.practice_selected_day");
    const record = this.selectedDateKey ? this.findRecord(this.selectedDateKey) : null;
    const hasItems = Array.isArray(record?.items) && record.items.length > 0;
    this.practiceSelectedDayBtnEl.disabled = !hasItems;
  }

  private embedPracticePanel(): void {
    if (!this.practiceHostEl) return;
    const sourcePanel = document.querySelector<HTMLElement>("#tab-panel-rewrite");
    const practiceSection = sourcePanel?.querySelector<HTMLElement>(".module-card--oio-practice");
    if (!practiceSection) return;
    this.practiceHostEl.replaceChildren(practiceSection);
  }

  private async cleanupLegacyPreviewMockRecords(): Promise<void> {
    const legacyMockPrefix = "mock-preview-2026-04";
    const existingRecords = await listCaptureRecords();
    for (const record of existingRecords) {
      const items = Array.isArray(record.items) ? record.items : [];
      const nextItems = items.filter((item) => !String(item.id ?? "").startsWith(legacyMockPrefix));
      if (nextItems.length === items.length) continue;
      const nextRecord = {
        ...record,
        items: nextItems,
        updatedAt: new Date().toISOString(),
      };
      await saveCaptureRecord(nextRecord);
    }
  }

  private async removeCaptureItem(itemId: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t("daily_capture.confirm_delete_title"),
      message: t("daily_capture.confirm_delete_message"),
      confirmText: t("daily_capture.delete"),
      cancelText: t("daily_capture.cancel"),
    });
    if (!confirmed) return;
    const record = this.findRecord(this.dialogDateKey || this.selectedDateKey);
    if (!record) return;
    const nextItems = record.items.filter((item) => item.id !== itemId);
    if (nextItems.length === record.items.length) return;
    const updatedRecord = {
      ...record,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    await saveCaptureRecord(updatedRecord);
    this.cloudCountByDate.set(record.dateKey, nextItems.length);
    void deleteCaptureItems([itemId]);
    await this.refreshFromStore(record.dateKey);
    if (!nextItems.length) {
      this.selectedDateKey = "";
      this.dialogDateKey = "";
      this.dialogItemIndex = 0;
      this.renderDayDialog();
      this.renderCalendar();
      return;
    }
    this.dialogDateKey = record.dateKey;
    this.dialogItemIndex = Math.min(this.dialogItemIndex, nextItems.length - 1);
    this.renderDayDialog();
  }

  private async updatePracticeBlankIndexes(itemId: string, blankIndexes: number[]): Promise<void> {
    const target = this.findItemById(itemId);
    if (!target) return;
    const normalized = Array.from(
      new Set(
        blankIndexes
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .map((value) => Math.floor(value)),
      ),
    ).sort((left, right) => left - right);
    const current = getCapturePracticeBlankIndexes(target);
    if (current.length === normalized.length && current.every((value, index) => value === normalized[index])) {
      return;
    }
    const record = this.records.find((entry) => entry.items.some((item) => item.id === itemId));
    if (!record) return;
    const nextItems = record.items.map((item) => item.id === itemId ? { ...item, practiceBlankIndexes: normalized } : item);
    const nextRecord = {
      ...record,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    await saveCaptureRecord(nextRecord);
    this.cloudCountByDate.set(record.dateKey, nextItems.length);
    void pushCaptureRecord(nextRecord);
    await this.refreshFromStore(record.dateKey);
  }

  private async updatePracticeCorrectBlankIndexes(itemId: string, correctBlankIndexes: number[]): Promise<void> {
    const target = this.findItemById(itemId);
    if (!target) return;
    const normalized = Array.from(
      new Set(
        correctBlankIndexes
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .map((value) => Math.floor(value)),
      ),
    ).sort((left, right) => left - right);
    const current = getCapturePracticeCorrectBlankIndexes(target);
    if (current.length === normalized.length && current.every((value, index) => value === normalized[index])) {
      return;
    }
    const record = this.records.find((entry) => entry.items.some((item) => item.id === itemId));
    if (!record) return;
    const nextItems = record.items.map((item) => item.id === itemId ? { ...item, practiceCorrectBlankIndexes: normalized } : item);
    const nextRecord = {
      ...record,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    await saveCaptureRecord(nextRecord);
    this.cloudCountByDate.set(record.dateKey, nextItems.length);
    void pushCaptureRecord(nextRecord);
    await this.refreshFromStore(record.dateKey);
  }
}
