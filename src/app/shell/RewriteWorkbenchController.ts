import { listRewriteRecords, saveRewriteRecord } from "../../historyIdb.js";
import { addMonthsClamp, dateToLocalKey, formatKeyToSlashDisplay } from "../dateUtils.js";
import { RewriteApiError, requestRewrite } from "./rewriteApi";

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

interface RewriteRecord {
  id: string;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  title: string;
  sourceText: string;
  rewrittenText: string;
  keyPhrases: string[];
  createdAt: string;
}

interface StoredRewriteRecord {
  id: string;
  createdAt: string;
  title: string;
  sourceText: string;
  rewrittenText: string;
  keyPhrases: string[];
}

const CALENDAR_DOW = ["一", "二", "三", "四", "五", "六", "日"];

function countWords(text: string): number {
  const matches = text.trim().match(/\b[\w'-]+\b/g);
  return matches?.length ?? 0;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function deriveDraftTitle(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return "新建改写";
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact;
}

function formatRecordLabels(createdAt: string): Pick<RewriteRecord, "dateLabel" | "timeLabel" | "dateKey"> {
  const date = new Date(createdAt);
  const dateKey = dateToLocalKey(date);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const dateLabel = sameDay ? "今天" : formatKeyToSlashDisplay(dateKey);
  const timeLabel = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return { dateLabel, timeLabel, dateKey };
}

function toViewRecord(record: StoredRewriteRecord): RewriteRecord {
  const { dateLabel, timeLabel, dateKey } = formatRecordLabels(record.createdAt);
  return {
    ...record,
    dateLabel,
    timeLabel,
    dateKey,
  };
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildCalendarDays(monthDate: Date): Date[] {
  const firstDay = startOfMonth(monthDate);
  const firstDow = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDow);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export class RewriteWorkbenchController {
  private readonly root: HTMLElement | null;
  private readonly historyListEl: HTMLElement | null;
  private readonly historyEmptyEl: HTMLElement | null;
  private readonly selectedDateEl: HTMLElement | null;
  private readonly summaryMetaEl: HTMLElement | null;
  private readonly selectedDateDialogEl: HTMLElement | null;
  private readonly calendarCaptionEl: HTMLElement | null;
  private readonly calendarDowEl: HTMLElement | null;
  private readonly calendarGridEl: HTMLElement | null;
  private readonly yearSelectEl: HTMLSelectElement | null;
  private readonly monthSelectEl: HTMLSelectElement | null;
  private readonly openCalendarBtn: HTMLButtonElement | null;
  private readonly closeCalendarBtn: HTMLButtonElement | null;
  private readonly calendarDialogEl: HTMLDialogElement | null;
  private readonly taskTitleEl: HTMLElement | null;
  private readonly sourceInputEl: HTMLTextAreaElement | null;
  private readonly sourceTitleEl: HTMLElement | null;
  private readonly sourcePreviewEl: HTMLElement | null;
  private readonly resultTitleEl: HTMLElement | null;
  private readonly resultPreviewEl: HTMLElement | null;
  private readonly keyPhrasesWrapEl: HTMLElement | null;
  private readonly keyPhrasesListEl: HTMLElement | null;
  private readonly inlineMetaEl: HTMLElement | null;
  private readonly voiceBtn: HTMLButtonElement | null;
  private readonly submitBtn: HTMLButtonElement | null;
  private readonly clearBtn: HTMLButtonElement | null;
  private allRecords: RewriteRecord[] = [];
  private visibleRecords: RewriteRecord[] = [];
  private activeRecordId = "";
  private selectedDateKey = dateToLocalKey(new Date());
  private calendarMonth = startOfMonth(new Date());
  private draftMode = false;
  private pending = false;
  private speechRecognition: SpeechRecognitionLike | null = null;
  private speechSupported = false;
  private listening = false;

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-rewrite"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.historyListEl = root?.querySelector<HTMLElement>("[data-rewrite-history-list]") ?? null;
    this.historyEmptyEl = root?.querySelector<HTMLElement>("[data-rewrite-history-empty]") ?? null;
    this.selectedDateEl = root?.querySelector<HTMLElement>("[data-rewrite-selected-date]") ?? null;
    this.summaryMetaEl = root?.querySelector<HTMLElement>("[data-rewrite-summary-meta]") ?? null;
    this.selectedDateDialogEl = root?.querySelector<HTMLElement>("[data-rewrite-selected-date-dialog]") ?? null;
    this.calendarCaptionEl = root?.querySelector<HTMLElement>("[data-rewrite-calendar-caption]") ?? null;
    this.calendarDowEl = root?.querySelector<HTMLElement>("[data-rewrite-calendar-dow]") ?? null;
    this.calendarGridEl = root?.querySelector<HTMLElement>("[data-rewrite-calendar-grid]") ?? null;
    this.yearSelectEl = root?.querySelector<HTMLSelectElement>("[data-rewrite-year-select]") ?? null;
    this.monthSelectEl = root?.querySelector<HTMLSelectElement>("[data-rewrite-month-select]") ?? null;
    this.openCalendarBtn = root?.querySelector<HTMLButtonElement>("[data-rewrite-open-calendar]") ?? null;
    this.closeCalendarBtn = root?.querySelector<HTMLButtonElement>("[data-rewrite-close-calendar]") ?? null;
    this.calendarDialogEl = root?.querySelector<HTMLDialogElement>("[data-rewrite-calendar-dialog]") ?? null;
    this.taskTitleEl = root?.querySelector<HTMLElement>("[data-rewrite-task-title]") ?? null;
    this.sourceInputEl = root?.querySelector<HTMLTextAreaElement>("[data-rewrite-source-input]") ?? null;
    this.sourceTitleEl = root?.querySelector<HTMLElement>("[data-rewrite-source-title]") ?? null;
    this.sourcePreviewEl = root?.querySelector<HTMLElement>("[data-rewrite-source-preview]") ?? null;
    this.resultTitleEl = root?.querySelector<HTMLElement>("[data-rewrite-result-title]") ?? null;
    this.resultPreviewEl = root?.querySelector<HTMLElement>("[data-rewrite-result-preview]") ?? null;
    this.keyPhrasesWrapEl = root?.querySelector<HTMLElement>("[data-rewrite-keyphrases]") ?? null;
    this.keyPhrasesListEl = root?.querySelector<HTMLElement>("[data-rewrite-keyphrases-list]") ?? null;
    this.inlineMetaEl = root?.querySelector<HTMLElement>("[data-rewrite-inline-meta]") ?? null;
    this.voiceBtn = root?.querySelector<HTMLButtonElement>("[data-rewrite-voice]") ?? null;
    this.submitBtn = root?.querySelector<HTMLButtonElement>("[data-rewrite-submit]") ?? null;
    this.clearBtn = root?.querySelector<HTMLButtonElement>("[data-rewrite-clear]") ?? null;
  }

  async init(): Promise<void> {
    if (
      !this.root ||
      !this.historyListEl ||
      !this.sourceInputEl ||
      !this.sourcePreviewEl ||
      !this.resultPreviewEl ||
      !this.calendarDowEl ||
      !this.calendarGridEl
    ) {
      return;
    }

    this.renderCalendarDow();
    this.initSpeechInput();
    await this.loadStoredRecords();
    this.syncSelectedDateFallback();
    this.updateSummaryMeta();
    this.renderCalendar();
    this.refreshVisibleRecords();
    this.bindEvents();

    const firstRecord = this.visibleRecords[0];
    if (firstRecord) {
      this.applyRecord(firstRecord);
      return;
    }

    this.renderEmptyDraft();
  }

  private async loadStoredRecords(): Promise<void> {
    try {
      const stored = await listRewriteRecords();
      this.allRecords = stored.map((record) => toViewRecord(record as StoredRewriteRecord));
    } catch {
      this.allRecords = [];
    }
  }

  private bindEvents(): void {
    this.root?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const dayBtn = target?.closest<HTMLButtonElement>("[data-rewrite-day-key]");
      if (dayBtn && !dayBtn.disabled && !this.pending) {
        this.selectedDateKey = dayBtn.dataset.rewriteDayKey || this.selectedDateKey;
        this.refreshVisibleRecords();
        const firstRecord = this.visibleRecords[0];
        if (firstRecord) {
          this.applyRecord(firstRecord);
        } else {
          this.renderEmptyDraft();
        }
        this.renderCalendar();
        this.calendarDialogEl?.close();
        return;
      }

      const item = target?.closest<HTMLButtonElement>("[data-rewrite-record-id]");
      if (item && !this.pending) {
        const record = this.visibleRecords.find((entry) => entry.id === item.dataset.rewriteRecordId);
        if (record) {
          this.applyRecord(record);
        }
      }
    });

    this.yearSelectEl?.addEventListener("change", () => {
      if (this.pending) return;
      const year = Number(this.yearSelectEl?.value);
      const month = Number(this.monthSelectEl?.value ?? this.calendarMonth.getMonth() + 1);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return;
      this.calendarMonth = startOfMonth(new Date(year, month - 1, 1));
      this.renderCalendar();
    });

    this.monthSelectEl?.addEventListener("change", () => {
      if (this.pending) return;
      const year = Number(this.yearSelectEl?.value ?? this.calendarMonth.getFullYear());
      const month = Number(this.monthSelectEl?.value);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return;
      this.calendarMonth = startOfMonth(new Date(year, month - 1, 1));
      this.renderCalendar();
    });

    this.openCalendarBtn?.addEventListener("click", () => {
      this.calendarDialogEl?.showModal();
    });

    this.closeCalendarBtn?.addEventListener("click", () => {
      this.calendarDialogEl?.close();
    });

    this.calendarDialogEl?.addEventListener("click", (event) => {
      const rect = this.calendarDialogEl?.getBoundingClientRect();
      if (!rect) return;
      const hitInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!hitInside) {
        this.calendarDialogEl?.close();
      }
    });

    this.sourceInputEl?.addEventListener("input", () => {
      const currentText = this.sourceInputEl?.value ?? "";
      this.draftMode = true;
      this.updateSelectionState(null);
      this.syncSourcePreview(currentText);
      if (this.resultTitleEl) {
        this.resultTitleEl.textContent = "改写结果";
      }
      if (this.resultPreviewEl) {
        //this.resultPreviewEl.textContent = "点击“开始改写”";
      }
      this.renderKeyPhrases([]);
      if (this.taskTitleEl) {
        this.taskTitleEl.textContent = "输入";
      }
      if (this.inlineMetaEl) {
        this.inlineMetaEl.textContent = currentText.trim() ? `${countWords(currentText)} 词` : "";
      }
      this.updateActionState();
    });

    this.voiceBtn?.addEventListener("click", () => {
      if (!this.speechSupported || !this.speechRecognition || this.pending) return;
      if (this.listening) {
        this.speechRecognition.stop();
      } else {
        this.listening = true;
        this.updateActionState();
        if (this.inlineMetaEl) {
          this.inlineMetaEl.textContent = "正在语音输入...";
        }
        this.speechRecognition.start();
      }
    });

    this.submitBtn?.addEventListener("click", async () => {
      const currentText = this.sourceInputEl?.value ?? "";
      if (!currentText.trim() || this.pending) return;

      this.pending = true;
      this.updateActionState();
      if (this.resultTitleEl) {
        this.resultTitleEl.textContent = "改写结果";
      }
      if (this.resultPreviewEl) {
        this.resultPreviewEl.textContent = "改写中...";
      }
      this.renderKeyPhrases([]);
      if (this.inlineMetaEl) {
        this.inlineMetaEl.textContent = `${countWords(currentText)} 词`;
      }

      try {
        const result = await requestRewrite(currentText);
        const createdAt = new Date().toISOString();
        const storedRecord: StoredRewriteRecord = {
          id: `rewrite-${Date.now()}`,
          createdAt,
          title: deriveDraftTitle(currentText),
          sourceText: currentText,
          rewrittenText: result.rewritten_text,
          keyPhrases: result.key_phrases,
        };
        await saveRewriteRecord(storedRecord);

        const nextRecord = toViewRecord(storedRecord);
        this.upsertRecord(nextRecord);
        this.selectedDateKey = nextRecord.dateKey;
        this.calendarMonth = startOfMonth(new Date(nextRecord.createdAt));
        this.refreshVisibleRecords();
        this.applyRecord(nextRecord);
        if (this.sourceInputEl) {
          this.sourceInputEl.value = "";
        }
        this.renderCalendar();
      } catch (error) {
        const message = error instanceof RewriteApiError ? error.message : "改写失败，请稍后重试。";
        this.draftMode = true;
        this.updateSelectionState(null);
        if (this.resultTitleEl) {
          this.resultTitleEl.textContent = "改写失败";
        }
        if (this.resultPreviewEl) {
          this.resultPreviewEl.textContent = message;
        }
        this.renderKeyPhrases([]);
        if (this.inlineMetaEl) {
          this.inlineMetaEl.textContent = "";
        }
      } finally {
        this.pending = false;
        this.updateActionState();
      }
    });

    this.clearBtn?.addEventListener("click", () => {
      if (this.pending) return;
      this.renderEmptyDraft();
    });
  }

  private renderCalendarDow(): void {
    if (!this.calendarDowEl) return;
    this.calendarDowEl.innerHTML = CALENDAR_DOW.map(
      (label) => `<div class="rewrite-calendar-dow-cell">${label}</div>`,
    ).join("");
  }

  private initSpeechInput(): void {
    const SpeechRecognition = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition || !this.voiceBtn) {
      this.speechSupported = false;
      if (this.voiceBtn) {
        this.voiceBtn.disabled = true;
        this.voiceBtn.textContent = "语音不可用";
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        }
      }

      if (!this.sourceInputEl || !finalText.trim()) return;
      const base = this.sourceInputEl.value.trimEnd();
      const nextValue = [base, finalText.trim()].filter(Boolean).join(base ? " " : "");
      this.sourceInputEl.value = nextValue;
      this.sourceInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    };
    recognition.onerror = () => {
      this.listening = false;
      this.updateActionState();
      if (this.inlineMetaEl) {
        this.inlineMetaEl.textContent = "语音输入失败";
      }
    };
    recognition.onend = () => {
      this.listening = false;
      this.updateActionState();
    };

    this.speechRecognition = recognition;
    this.speechSupported = true;
  }

  private renderCalendar(): void {
    if (!this.calendarGridEl) return;

    const daysWithRecords = new Set(this.allRecords.map((record) => record.dateKey));
    this.renderCalendarSelects();
    if (this.calendarCaptionEl) {
      this.calendarCaptionEl.textContent = `${this.calendarMonth.getFullYear()} / ${String(this.calendarMonth.getMonth() + 1).padStart(2, "0")}`;
    }
    if (this.selectedDateEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateEl.textContent = this.selectedDateKey === todayKey ? "今天" : formatKeyToSlashDisplay(this.selectedDateKey);
    }
    if (this.selectedDateDialogEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateDialogEl.textContent = this.selectedDateKey === todayKey ? "今天" : formatKeyToSlashDisplay(this.selectedDateKey);
    }

    const monthIndex = this.calendarMonth.getMonth();
    this.calendarGridEl.innerHTML = buildCalendarDays(this.calendarMonth)
      .map((date) => {
        const dayKey = dateToLocalKey(date);
        const marked = daysWithRecords.has(dayKey);
        const active = this.selectedDateKey === dayKey;
        const outside = date.getMonth() !== monthIndex;
        const classes = [
          "rewrite-calendar-cell",
          marked ? "is-marked" : "",
          active ? "is-active" : "",
          outside ? "is-outside" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<button type="button" class="${classes}" data-rewrite-day-key="${dayKey}" ${marked ? "" : "disabled"}>${date.getDate()}</button>`;
      })
      .join("");
  }

  private renderCalendarSelects(): void {
    const currentYear = new Date().getFullYear();
    const recordYears = this.allRecords.map((record) => new Date(record.createdAt).getFullYear());
    const minYear = Math.min(currentYear, ...(recordYears.length ? recordYears : [currentYear]));
    const maxYear = Math.max(currentYear, ...(recordYears.length ? recordYears : [currentYear]));

    if (this.yearSelectEl) {
      const years: number[] = [];
      for (let year = maxYear; year >= minYear; year -= 1) {
        years.push(year);
      }
      this.yearSelectEl.innerHTML = years
        .map((year) => `<option value="${year}" ${year === this.calendarMonth.getFullYear() ? "selected" : ""}>${year} 年</option>`)
        .join("");
    }

    if (this.monthSelectEl) {
      this.monthSelectEl.innerHTML = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        return `<option value="${month}" ${index === this.calendarMonth.getMonth() ? "selected" : ""}>${month} 月</option>`;
      }).join("");
    }
  }

  private refreshVisibleRecords(): void {
    this.visibleRecords = this.allRecords.filter((record) => record.dateKey === this.selectedDateKey);
    this.activeRecordId = this.visibleRecords[0]?.id ?? "";
    this.renderHistoryList();
  }

  private syncSelectedDateFallback(): void {
    const hasSelected = this.allRecords.some((record) => record.dateKey === this.selectedDateKey);
    if (hasSelected) return;
    const firstRecord = this.allRecords[0];
    if (firstRecord) {
      this.selectedDateKey = firstRecord.dateKey;
      this.calendarMonth = startOfMonth(new Date(firstRecord.createdAt));
    }
  }

  private upsertRecord(record: RewriteRecord): void {
    const existingIndex = this.allRecords.findIndex((entry) => entry.id === record.id);
    if (existingIndex >= 0) {
      this.allRecords.splice(existingIndex, 1, record);
    } else {
      this.allRecords.unshift(record);
    }
    this.updateSummaryMeta();
  }

  private updateSummaryMeta(): void {
    if (!this.summaryMetaEl) return;
    const dayCount = new Set(this.allRecords.map((record) => record.dateKey)).size;
    this.summaryMetaEl.textContent = `${this.allRecords.length} 条记录 · ${dayCount} 天`;
  }

  private renderKeyPhrases(keyPhrases: string[]): void {
    if (!this.keyPhrasesWrapEl || !this.keyPhrasesListEl) return;
    const hasKeyPhrases = keyPhrases.length > 0;
    this.keyPhrasesWrapEl.hidden = !hasKeyPhrases;
    this.keyPhrasesListEl.innerHTML = hasKeyPhrases
      ? keyPhrases.map((phrase) => `<span class="rewrite-keyphrase-chip">${escapeHtml(phrase)}</span>`).join("")
      : "";
  }

  private renderHistoryList(): void {
    if (!this.historyListEl) return;

    const hasRecords = this.visibleRecords.length > 0;
    this.historyListEl.hidden = !hasRecords;
    if (this.historyEmptyEl) {
      this.historyEmptyEl.hidden = hasRecords;
    }

    this.historyListEl.innerHTML = this.visibleRecords
      .map((record) => {
        const activeClass = record.id === this.activeRecordId ? " is-active" : "";
        return `
          <button type="button" class="rewrite-history-item${activeClass}" data-rewrite-record-id="${escapeHtml(record.id)}">
            <span class="rewrite-history-item-kicker">${escapeHtml(record.timeLabel)}</span>
            <strong class="rewrite-history-item-title">${escapeHtml(record.title)}</strong>
          </button>
        `;
      })
      .join("");
  }

  private applyRecord(record: RewriteRecord): void {
    this.activeRecordId = record.id;
    this.draftMode = false;
    this.renderHistoryList();
    this.updateSelectionState(record.id);
    if (this.taskTitleEl) {
      this.taskTitleEl.textContent = "输入";
    }
    if (this.sourceTitleEl) {
      this.sourceTitleEl.textContent = "原文";
    }
    this.syncSourcePreview(record.sourceText);
    if (this.resultTitleEl) {
      this.resultTitleEl.textContent = "改写结果";
    }
    if (this.resultPreviewEl) {
      this.resultPreviewEl.textContent = record.rewrittenText;
    }
    this.renderKeyPhrases(record.keyPhrases);
    if (this.inlineMetaEl) {
      this.inlineMetaEl.textContent = `${countWords(record.sourceText)} 词`;
    }
    if (this.selectedDateEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateEl.textContent = record.dateKey === todayKey ? "今天" : formatKeyToSlashDisplay(record.dateKey);
    }
    if (this.selectedDateDialogEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateDialogEl.textContent = record.dateKey === todayKey ? "今天" : formatKeyToSlashDisplay(record.dateKey);
    }
    this.updateActionState();
  }

  private renderEmptyDraft(): void {
    this.draftMode = true;
    this.activeRecordId = "";
    this.renderHistoryList();
    this.updateSelectionState(null);
    if (this.taskTitleEl) {
      this.taskTitleEl.textContent = "输入";
    }
    if (this.sourceInputEl) {
      this.sourceInputEl.value = "";
    }
    if (this.sourceTitleEl) {
      this.sourceTitleEl.textContent = "原文";
    }
    this.syncSourcePreview("");
    if (this.resultTitleEl) {
      this.resultTitleEl.textContent = "改写结果";
    }
    if (this.resultPreviewEl) {
      this.resultPreviewEl.textContent = "";
    }
    this.renderKeyPhrases([]);
    if (this.inlineMetaEl) {
      this.inlineMetaEl.textContent = "";
    }
    if (this.selectedDateEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateEl.textContent = this.selectedDateKey === todayKey ? "今天" : formatKeyToSlashDisplay(this.selectedDateKey);
    }
    if (this.selectedDateDialogEl) {
      const todayKey = dateToLocalKey(new Date());
      this.selectedDateDialogEl.textContent = this.selectedDateKey === todayKey ? "今天" : formatKeyToSlashDisplay(this.selectedDateKey);
    }
    this.updateActionState();
  }

  private syncSourcePreview(text: string): void {
    if (!this.sourcePreviewEl) return;
    const isPlaceholder = !text.trim();
    this.sourcePreviewEl.textContent = isPlaceholder ? "" : text.trim();
    this.sourcePreviewEl.classList.toggle("is-placeholder", isPlaceholder);
  }

  private updateSelectionState(recordId: string | null): void {
    const items = this.historyListEl?.querySelectorAll<HTMLButtonElement>("[data-rewrite-record-id]") ?? [];
    items.forEach((item) => {
      const isActive = !!recordId && item.dataset.rewriteRecordId === recordId;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  private updateActionState(): void {
    const hasText = !!this.sourceInputEl?.value.trim();
    if (this.voiceBtn) {
      this.voiceBtn.disabled = !this.speechSupported || this.pending;
      this.voiceBtn.setAttribute("aria-label", this.listening ? "结束录音" : "语音输入");
      this.voiceBtn.setAttribute("title", this.listening ? "结束录音" : "语音输入");
      this.voiceBtn.classList.toggle("is-listening", this.listening);
    }
    if (this.submitBtn) {
      this.submitBtn.disabled = !hasText || this.pending;
      this.submitBtn.textContent = this.pending ? "改写中..." : "开始改写";
    }
    if (this.clearBtn) {
      this.clearBtn.disabled = this.pending || (!hasText && !this.activeRecordId);
    }
  }
}
