import { getCapturePracticeBlankIndexes } from "../../domain/capture";
import { calcCardAverageScore, getPhraseTier, normalizePhraseKey } from "../../domain/proficiency";
import { addMonthsClamp, dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { confirmDialog } from "../../shared/confirmDialog";
import { escapeHtml } from "../../shared/html";
import { renderTextWithKeyPhraseHighlight } from "../../shared/keyPhraseHighlight";
import { pullCaptureIndex, pullCaptureRecordByDate, pushCaptureRecord } from "../../services/cloud/cloudSyncService";
import { fetchPhraseProficiencyScores } from "../../services/proficiency/phraseProficiencyService";
import { getI18n, t } from "../../i18n/i18n";
import { onDailyCaptureUpdated } from "./dailyCaptureEvents";
import { type CaptureItem, type DailyCaptureRecord, listCaptureRecords, saveCaptureRecord } from "./dailyCaptureStore";

export class DailyCaptureController {
  private readonly root: HTMLElement | null;
  private readonly gridEl: HTMLElement | null;
  private readonly captionEl: HTMLElement | null;
  private readonly prevBtnEl: HTMLButtonElement | null;
  private readonly nextBtnEl: HTMLButtonElement | null;
  private readonly yearSelectEl: HTMLSelectElement | null;
  private readonly monthSelectEl: HTMLSelectElement | null;
  private readonly selectedDayEl: HTMLElement | null;
  private readonly dayDialogEl: HTMLDialogElement | null;
  private readonly dayDialogTitleEl: HTMLElement | null;
  private readonly dayDialogMetaEl: HTMLElement | null;
  private readonly dayDialogBodyEl: HTMLElement | null;
  private readonly dayDialogCloseEl: HTMLButtonElement | null;
  private readonly dayDialogPrevEl: HTMLButtonElement | null;
  private readonly dayDialogNextEl: HTMLButtonElement | null;
  private readonly practiceHostEl: HTMLElement | null;
  private readonly practiceSelectedDayBtnEl: HTMLButtonElement | null;
  private records: DailyCaptureRecord[] = [];
  private monthCursor = new Date();
  private selectedDateKey = dateToLocalKey(new Date());
  private dialogDateKey = "";
  private dialogItemIndex = 0;
  private cloudCountByDate = new Map<string, number>();
  private phraseScoreByNorm = new Map<string, number>();

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-daily-capture"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.gridEl = root?.querySelector<HTMLElement>("[data-daily-capture-grid]") ?? null;
    this.captionEl = root?.querySelector<HTMLElement>("[data-daily-capture-caption]") ?? null;
    this.prevBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-prev]") ?? null;
    this.nextBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-next]") ?? null;
    this.yearSelectEl = root?.querySelector<HTMLSelectElement>("[data-daily-capture-year]") ?? null;
    this.monthSelectEl = root?.querySelector<HTMLSelectElement>("[data-daily-capture-month]") ?? null;
    this.selectedDayEl = root?.querySelector<HTMLElement>("[data-daily-capture-selected-day]") ?? null;
    this.dayDialogEl = root?.querySelector<HTMLDialogElement>("[data-daily-capture-day-dialog]") ?? null;
    this.dayDialogTitleEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-title]") ?? null;
    this.dayDialogMetaEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-meta]") ?? null;
    this.dayDialogBodyEl = root?.querySelector<HTMLElement>("[data-daily-capture-day-body]") ?? null;
    this.dayDialogCloseEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-day-close]") ?? null;
    this.dayDialogPrevEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-item-prev]") ?? null;
    this.dayDialogNextEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-item-next]") ?? null;
    this.practiceHostEl = root?.querySelector<HTMLElement>("[data-daily-capture-practice-host]") ?? null;
    this.practiceSelectedDayBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-practice-selected-day]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.gridEl) return;
    this.embedPracticePanel();
    await this.loadRecords();
    this.populateCalendarSelectors();
    this.syncPracticeCtaCopy();
    this.bindEvents();
    getI18n().subscribe(() => {
      this.populateCalendarSelectors();
      this.syncPracticeCtaCopy();
      this.renderCalendar();
      this.renderDayDialog();
    });
    this.renderCalendar();
    this.renderDayDialog();
    void this.syncRecordsFromCloud();
  }

  private bindEvents(): void {
    this.prevBtnEl?.addEventListener("click", () => {
      this.monthCursor = addMonthsClamp(this.monthCursor, -1);
      this.renderCalendar();
    });

    this.nextBtnEl?.addEventListener("click", () => {
      this.monthCursor = addMonthsClamp(this.monthCursor, 1);
      this.renderCalendar();
    });

    this.yearSelectEl?.addEventListener("change", () => {
      this.applyYearMonthSelection();
    });

    this.monthSelectEl?.addEventListener("change", () => {
      this.applyYearMonthSelection();
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
        this.closeDayDialog();
        this.launchOioPractice(item);
        return;
      }

      const aiPhraseBtn = target?.closest<HTMLButtonElement>("[data-capture-practice-ai-phrase]");
      if (aiPhraseBtn) {
        const itemId = aiPhraseBtn.dataset.capturePracticeAiItem?.trim() ?? "";
        const encodedPhrase = aiPhraseBtn.dataset.capturePracticeAiPhrase?.trim() ?? "";
        if (!itemId || !encodedPhrase) return;
        const item = this.findItemById(itemId);
        if (!item) return;
        let phrase = "";
        try {
          phrase = decodeURIComponent(encodedPhrase);
        } catch {
          phrase = encodedPhrase;
        }
        this.closeDayDialog();
        this.launchAiPractice(item, phrase);
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

    this.dayDialogCloseEl?.addEventListener("click", () => {
      this.closeDayDialog();
    });
    this.dayDialogPrevEl?.addEventListener("click", () => {
      this.shiftDialogItem(-1);
    });
    this.dayDialogNextEl?.addEventListener("click", () => {
      this.shiftDialogItem(1);
    });
    this.dayDialogEl?.addEventListener("cancel", () => {
      this.dialogDateKey = "";
      this.dialogItemIndex = 0;
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
    await this.refreshPhraseProficiencyMap();
    if (!this.records.find((record) => record.dateKey === this.selectedDateKey) && this.records[0]) {
      this.selectedDateKey = this.records[0].dateKey;
    }
    if (this.yearSelectEl && this.monthSelectEl) {
      this.populateCalendarSelectors();
    }
  }

  private async refreshFromStore(preferredDateKey?: string): Promise<void> {
    await this.loadRecords();
    if (preferredDateKey && this.records.find((record) => record.dateKey === preferredDateKey)) {
      this.selectedDateKey = preferredDateKey;
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
    const locale = getI18n().getLocale() === "zh-CN" ? "zh-CN" : "en-US";
    if (this.captionEl) {
      this.captionEl.textContent = this.monthCursor.toLocaleDateString(locale, { month: "long", year: "numeric" });
    }

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const countMap = new Map<string, number>();
    const dayScoreMap = new Map<string, number>();
    for (const record of this.records) {
      countMap.set(record.dateKey, Array.isArray(record.items) ? record.items.length : 0);
      dayScoreMap.set(record.dateKey, this.computeRecordAverageScore(record));
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
      const active = dateKey === this.selectedDateKey;
      const outside = date.getMonth() !== month;
      const hasData = count > 0;
      const dayScore = dayScoreMap.get(dateKey) ?? 0;
      const tier = getPhraseTier(dayScore);
      cells.push(`
        <button
          type="button"
          class="daily-capture-day${active ? " is-active" : ""}${outside ? " is-outside" : ""}${hasData ? " is-marked" : " is-empty"}${hasData ? ` is-tier-${tier}` : ""}"
          data-capture-day="${escapeHtml(dateKey)}"
          data-capture-has-data="${hasData ? "1" : "0"}"
        >
          <span class="daily-capture-day-date">${date.getDate()}</span>
          <span class="daily-capture-day-count">${hasData ? `${count}` : "·"}</span>
        </button>
      `);
    }
    this.gridEl.innerHTML = cells.join("");
    this.renderSelectedDaySummary();
    this.syncCalendarSelectors();
  }

  private async openDayDialog(dateKey: string): Promise<void> {
    const cloudCount = this.cloudCountByDate.get(dateKey) ?? 0;
    if (cloudCount > 0 && !this.findRecord(dateKey)) {
      await pullCaptureRecordByDate(dateKey);
      await this.loadRecords();
      this.renderCalendar();
    }
    const record = this.findRecord(dateKey);
    if (!record?.items?.length) return;
    this.dialogDateKey = dateKey;
    this.dialogItemIndex = 0;
    this.renderDayDialog();
    if (!this.dayDialogEl?.open) {
      this.dayDialogEl?.showModal();
    }
  }

  private closeDayDialog(): void {
    if (this.dayDialogEl?.open) {
      this.dayDialogEl.close();
    }
    this.dialogDateKey = "";
    this.dialogItemIndex = 0;
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
    if (!this.dayDialogBodyEl || !this.dayDialogTitleEl || !this.dayDialogMetaEl) return;
    const record = this.findRecord(this.dialogDateKey);
    if (!record?.items?.length) {
      this.dayDialogTitleEl.textContent = "";
      this.dayDialogMetaEl.textContent = "";
      this.dayDialogBodyEl.innerHTML = `<p class="daily-capture-day-dialog-empty">${escapeHtml(t("daily_capture.no_cards_day"))}</p>`;
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
    const itemScore = this.computePhraseAverageScore(itemKeyPhrases);
    const itemTier = getPhraseTier(itemScore);
    this.dayDialogTitleEl.textContent = formatKeyToSlashDisplay(record.dateKey);
    this.dayDialogMetaEl.textContent = `${t("daily_capture.card")} ${index + 1} / ${total}`;
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
          ${this.renderKeyPhrases(itemKeyPhrases, item.id)}
        </div>
        <div class="daily-capture-entry-actions">
          <button type="button" class="secondary" data-capture-practice-oio="${escapeHtml(item.id)}">${t("daily_capture.practice_oio")}</button>
          <button type="button" class="secondary" data-capture-delete="${escapeHtml(item.id)}">${t("daily_capture.delete")}</button>
        </div>
      </article>
    `;
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
    if (!practiceText || practiceText === "-") return;
    this.startPracticeWithText(
      practiceText,
      practiceText ? [practiceText] : undefined,
      keyPhrases.length ? [keyPhrases] : undefined,
      item.id,
      blankIndexes,
    );
  }

  private launchAiPractice(item: CaptureItem, targetPhraseOverride?: string): void {
    const keyPhrases = this.normalizeItemKeyPhrases(item.keyPhrases);
    const normalizedNaturalVersion = (item.naturalVersion || "").trim();
    const normalizedReply = (item.reply || item.note || "").trim();
    const contextText = normalizedNaturalVersion && normalizedNaturalVersion !== "-"
      ? normalizedNaturalVersion
      : (item.sourceText ?? "").trim();
    const targetPhrase = (targetPhraseOverride ?? keyPhrases[0] ?? "").trim();
    if (!contextText || !targetPhrase) return;

    const practiceItem: CaptureItem = {
      ...item,
      naturalVersion: contextText,
      sourceText: contextText,
      keyPhrases: [targetPhrase],
      reply: normalizedReply && normalizedReply !== "-" ? normalizedReply : item.reply,
    };

    document.dispatchEvent(new CustomEvent("app-request-tab-change", { detail: { tabId: "oio-chat" } }));
    document.dispatchEvent(new CustomEvent("oio-chat-start-practice", { detail: { item: practiceItem } }));
  }

  private launchSelectedDayPractice(): void {
    const selectedDateKey = this.selectedDateKey;
    const record = this.findRecord(selectedDateKey);
    const items = Array.isArray(record?.items) ? record.items : [];
    if (!items.length) {
      window.alert(t("daily_capture.practice_selected_empty"));
      return;
    }
    const cardTexts = items
      .map((item) => (item.naturalVersion || item.sourceText || "").trim())
      .map((text) => text.trim())
      .filter((text) => text && text !== "-")
      .filter(Boolean);
    if (!cardTexts.length) {
      window.alert(t("daily_capture.practice_selected_empty"));
      return;
    }
    this.startPracticeWithText(cardTexts.join("\n"), undefined, undefined, undefined, []);
  }

  private startPracticeWithText(
    practiceText: string,
    cardChunks?: string[],
    cardPhraseChunks?: string[][],
    captureItemId?: string,
    blankIndexes?: number[],
  ): void {
    const text = practiceText.trim();
    if (!text) return;
    const inputEl = document.querySelector<HTMLTextAreaElement>("#text");
    const generateBtn = document.querySelector<HTMLButtonElement>("#generate");
    document.dispatchEvent(new CustomEvent("app-block-ui", { detail: { message: "正在打开练习..." } }));
    if (inputEl) {
      inputEl.value = text;
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
      inputEl.dataset.practiceOpeningHint = "daily";
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.focus();
    }
    generateBtn?.click();
    if (!generateBtn) {
      document.dispatchEvent(new CustomEvent("app-unblock-ui"));
    }
    const practiceSection = this.root?.querySelector<HTMLElement>("#subs-section");
    practiceSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private renderKeyPhrases(keyPhrases: string[], itemId: string): string {
    if (!keyPhrases.length) {
      return `<p class="daily-capture-entry-copy">-</p>`;
    }
    return `<div class="daily-capture-phrase-list">${keyPhrases
      .map((phrase) => {
        const score = this.getPhraseScore(phrase);
        const tier = getPhraseTier(score);
        const encodedPhrase = encodeURIComponent(phrase);
        return `
          <div class="daily-capture-phrase-item">
            <span class="chat-highlight-chip daily-capture-phrase-chip is-tier-${tier}">
              <span>${escapeHtml(phrase)}</span>
              <span class="daily-capture-phrase-score">${Math.max(0, Math.floor(score))}</span>
            </span>
            <button
              type="button"
              class="secondary daily-capture-phrase-ai-btn"
              data-capture-practice-ai-phrase="${escapeHtml(encodedPhrase)}"
              data-capture-practice-ai-item="${escapeHtml(itemId)}"
            >
              ${t("daily_capture.practice_ai")}
            </button>
          </div>
        `;
      })
      .join("")}</div>`;
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
      this.phraseScoreByNorm = await fetchPhraseProficiencyScores(phrases);
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

  private computePhraseAverageScore(phrases: string[]): number {
    if (!phrases.length) return 0;
    return calcCardAverageScore(phrases.map((phrase) => this.getPhraseScore(phrase)));
  }

  private computeRecordAverageScore(record: DailyCaptureRecord): number {
    const phraseScores: number[] = [];
    for (const item of record.items) {
      for (const phrase of this.normalizeItemKeyPhrases(item.keyPhrases)) {
        phraseScores.push(this.getPhraseScore(phrase));
      }
    }
    return calcCardAverageScore(phraseScores);
  }

  private normalizeItemKeyPhrases(value: CaptureItem["keyPhrases"]): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((phrase) => String(phrase ?? "").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 3);
  }

  private syncPracticeCtaCopy(): void {
    if (this.practiceSelectedDayBtnEl) {
      this.practiceSelectedDayBtnEl.textContent = t("daily_capture.practice_selected_day");
    }
  }

  private renderSelectedDaySummary(): void {
    if (!this.selectedDayEl) return;
    this.selectedDayEl.textContent = `${t("daily_capture.selected_day_label")}: ${formatKeyToSlashDisplay(this.selectedDateKey)}`;
  }

  private embedPracticePanel(): void {
    if (!this.practiceHostEl) return;
    const sourcePanel = document.querySelector<HTMLElement>("#tab-panel-rewrite");
    const practiceSection = sourcePanel?.querySelector<HTMLElement>(".module-card--oio-practice");
    if (!practiceSection) return;
    practiceSection.querySelector("#history-section")?.remove();
    this.practiceHostEl.replaceChildren(practiceSection);
  }

  private populateCalendarSelectors(): void {
    if (!this.yearSelectEl || !this.monthSelectEl) return;
    const years = this.buildYearOptions();
    this.yearSelectEl.innerHTML = years
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
    this.monthSelectEl.innerHTML = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return `<option value="${month}">${month.toString().padStart(2, "0")}</option>`;
    }).join("");
    this.syncCalendarSelectors();
  }

  private buildYearOptions(): number[] {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>([currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2]);
    for (const record of this.records) {
      const year = Number.parseInt(record.dateKey.slice(0, 4), 10);
      if (Number.isFinite(year)) {
        years.add(year);
      }
    }
    return Array.from(years).sort((a, b) => a - b);
  }

  private syncCalendarSelectors(): void {
    if (!this.yearSelectEl || !this.monthSelectEl) return;
    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth() + 1;
    if (!Array.from(this.yearSelectEl.options).some((option) => Number(option.value) === year)) {
      this.populateCalendarSelectors();
      return;
    }
    this.yearSelectEl.value = String(year);
    this.monthSelectEl.value = String(month);
  }

  private applyYearMonthSelection(): void {
    const year = Number.parseInt(this.yearSelectEl?.value ?? "", 10);
    const month = Number.parseInt(this.monthSelectEl?.value ?? "", 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
    this.monthCursor = new Date(year, month - 1, 1);
    this.renderCalendar();
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
    void pushCaptureRecord(updatedRecord);
    await this.refreshFromStore(record.dateKey);
    if (!nextItems.length) {
      this.closeDayDialog();
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
}
