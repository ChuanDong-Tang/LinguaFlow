import { addMonthsClamp, dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { escapeHtml } from "../../shared/html";
import { buildDefaultBlankIndexes, chunkSentence, normalizeToken } from "./dailyCapturePractice";
import { onDailyCaptureUpdated } from "./dailyCaptureEvents";
import { type DailyCaptureRecord, listCaptureRecords } from "./dailyCaptureStore";

export class DailyCaptureController {
  private readonly root: HTMLElement | null;
  private readonly gridEl: HTMLElement | null;
  private readonly captionEl: HTMLElement | null;
  private readonly detailEl: HTMLElement | null;
  private readonly practiceBtnEl: HTMLButtonElement | null;
  private readonly prevBtnEl: HTMLButtonElement | null;
  private readonly nextBtnEl: HTMLButtonElement | null;
  private readonly dialogEl: HTMLDialogElement | null;
  private readonly practiceWrongEl: HTMLElement | null;
  private readonly practiceSelectEl: HTMLElement | null;
  private readonly practiceInputsEl: HTMLElement | null;
  private readonly practiceStatusEl: HTMLElement | null;
  private readonly practiceStartEl: HTMLButtonElement | null;
  private readonly practiceCheckEl: HTMLButtonElement | null;
  private readonly practiceNextEl: HTMLButtonElement | null;
  private readonly practiceCloseEl: HTMLButtonElement | null;
  private records: DailyCaptureRecord[] = [];
  private monthCursor = new Date();
  private selectedDateKey = dateToLocalKey(new Date());
  private practiceIndex = 0;
  private practiceSelections: number[] = [];

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-daily-capture"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.gridEl = root?.querySelector<HTMLElement>("[data-daily-capture-grid]") ?? null;
    this.captionEl = root?.querySelector<HTMLElement>("[data-daily-capture-caption]") ?? null;
    this.detailEl = root?.querySelector<HTMLElement>("[data-daily-capture-detail]") ?? null;
    this.practiceBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-practice]") ?? null;
    this.prevBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-prev]") ?? null;
    this.nextBtnEl = root?.querySelector<HTMLButtonElement>("[data-daily-capture-next]") ?? null;
    this.dialogEl = root?.querySelector<HTMLDialogElement>("[data-daily-capture-practice-dialog]") ?? null;
    this.practiceWrongEl = root?.querySelector<HTMLElement>("[data-practice-wrong]") ?? null;
    this.practiceSelectEl = root?.querySelector<HTMLElement>("[data-practice-select]") ?? null;
    this.practiceInputsEl = root?.querySelector<HTMLElement>("[data-practice-inputs]") ?? null;
    this.practiceStatusEl = root?.querySelector<HTMLElement>("[data-practice-status]") ?? null;
    this.practiceStartEl = root?.querySelector<HTMLButtonElement>("[data-practice-start]") ?? null;
    this.practiceCheckEl = root?.querySelector<HTMLButtonElement>("[data-practice-check]") ?? null;
    this.practiceNextEl = root?.querySelector<HTMLButtonElement>("[data-practice-next]") ?? null;
    this.practiceCloseEl = root?.querySelector<HTMLButtonElement>("[data-practice-close]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.gridEl || !this.detailEl) return;

    await this.loadRecords();
    this.bindEvents();
    this.renderCalendar();
    this.renderDetail();
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

    this.root?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const dayBtn = target?.closest<HTMLButtonElement>("[data-capture-day]");
      if (!dayBtn) return;

      const dateKey = dayBtn.dataset.captureDay?.trim() ?? "";
      if (!dateKey) return;

      this.selectedDateKey = dateKey;
      this.renderCalendar();
      this.renderDetail();
    });

    this.practiceBtnEl?.addEventListener("click", () => {
      this.practiceIndex = 0;
      this.openPractice();
    });

    this.practiceSelectEl?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const wordBtn = target?.closest<HTMLButtonElement>("[data-word-index]");
      if (!wordBtn) return;

      const index = Number(wordBtn.dataset.wordIndex);
      if (!Number.isInteger(index)) return;

      this.practiceSelections = this.practiceSelections.includes(index)
        ? this.practiceSelections.filter((item) => item !== index)
        : [...this.practiceSelections, index].sort((a, b) => a - b);
      this.renderPracticeStep();
    });

    this.practiceStartEl?.addEventListener("click", () => {
      this.renderPracticeInputs();
    });

    this.practiceCheckEl?.addEventListener("click", () => {
      this.checkPracticeAnswer();
    });

    this.practiceNextEl?.addEventListener("click", () => {
      const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
      if (!record) return;

      if (this.practiceIndex >= record.items.length - 1) {
        this.dialogEl?.close();
        return;
      }

      this.practiceIndex += 1;
      this.openPractice();
    });

    this.practiceCloseEl?.addEventListener("click", () => {
      this.dialogEl?.close();
    });

    onDailyCaptureUpdated(async ({ dateKey }) => {
      await this.refreshFromStore(dateKey);
    });

    document.addEventListener("app-tab-change", async (event) => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail;
      if (detail?.tabId !== "daily-capture") return;
      await this.refreshFromStore();
    });
  }

  private async loadRecords(): Promise<void> {
    this.records = await listCaptureRecords();
    if (!this.records.find((record) => record.dateKey === this.selectedDateKey) && this.records[0]) {
      this.selectedDateKey = this.records[0].dateKey;
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
    this.renderDetail();
  }

  private renderCalendar(): void {
    if (!this.gridEl || !this.captionEl) return;

    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    this.captionEl.textContent = this.monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const marked = new Set(this.records.map((record) => record.dateKey));
    const cells: string[] = [];

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dateKey = dateToLocalKey(date);
      const active = dateKey === this.selectedDateKey;
      const outside = date.getMonth() !== month;
      const hasData = marked.has(dateKey);

      cells.push(`
        <button
          type="button"
          class="daily-capture-day${active ? " is-active" : ""}${outside ? " is-outside" : ""}${hasData ? " is-marked" : ""}"
          data-capture-day="${escapeHtml(dateKey)}"
        >
          <span>${date.getDate()}</span>
        </button>
      `);
    }

    this.gridEl.innerHTML = cells.join("");
  }

  private renderDetail(): void {
    if (!this.detailEl || !this.practiceBtnEl) return;

    const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
    this.practiceBtnEl.disabled = !record?.items?.length;
    if (!record?.items?.length) {
      this.detailEl.innerHTML = `
        <article class="daily-capture-empty">
          <span class="daily-capture-empty-kicker">${escapeHtml(formatKeyToSlashDisplay(this.selectedDateKey))}</span>
          <h3 class="daily-capture-empty-title">No capture yet.</h3>
          <p class="daily-capture-empty-copy">Use “Refine this” in OIO Chat to collect mistakes and cleaner lines here.</p>
        </article>
      `;
      return;
    }

    this.detailEl.innerHTML = `
      <article class="daily-capture-card">
        <header class="daily-capture-card-head">
          <div>
            <span class="daily-capture-card-kicker">Daily Capture</span>
            <h3 class="daily-capture-card-title">${escapeHtml(formatKeyToSlashDisplay(record.dateKey))}</h3>
          </div>
          <span class="daily-capture-card-count">${record.items.length} items</span>
        </header>
        <div class="daily-capture-entry-list">
          ${record.items
            .map(
              (item, index) => `
                <article class="daily-capture-entry">
                  <span class="daily-capture-entry-index">#${index + 1}</span>
                  <div class="daily-capture-entry-block">
                    <span class="daily-capture-entry-label">Wrong</span>
                    <p class="daily-capture-entry-copy">${escapeHtml(item.sourceText)}</p>
                  </div>
                  <div class="daily-capture-entry-block">
                    <span class="daily-capture-entry-label">Better</span>
                    <p class="daily-capture-entry-copy">${escapeHtml(item.correctedText)}</p>
                  </div>
                  <div class="daily-capture-entry-block">
                    <span class="daily-capture-entry-label">Note</span>
                    <p class="daily-capture-entry-copy">${escapeHtml(item.note)}</p>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </article>
    `;
  }

  private openPractice(): void {
    const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
    const current = record?.items?.[this.practiceIndex];
    if (!record || !current || !this.dialogEl) return;

    this.practiceSelections = buildDefaultBlankIndexes(chunkSentence(current.correctedText));
    this.renderPracticeStep();
    if (!this.dialogEl.open) {
      this.dialogEl.showModal();
    }
  }

  private renderPracticeStep(): void {
    const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
    const current = record?.items?.[this.practiceIndex];
    if (!current || !this.practiceWrongEl || !this.practiceSelectEl || !this.practiceInputsEl || !this.practiceStatusEl || !this.practiceStartEl || !this.practiceCheckEl || !this.practiceNextEl) {
      return;
    }

    const tokens = chunkSentence(current.correctedText);
    this.practiceWrongEl.textContent = current.sourceText;
    this.practiceSelectEl.innerHTML = tokens
      .map((token, index) => {
        const selected = this.practiceSelections.includes(index);
        return `<button type="button" class="practice-word${selected ? " is-selected" : ""}" data-word-index="${index}">${escapeHtml(token)}</button>`;
      })
      .join("");
    this.practiceInputsEl.innerHTML = "";
    this.practiceStatusEl.textContent = "Pick the words you want to hide, then start.";
    this.practiceStartEl.hidden = false;
    this.practiceCheckEl.hidden = true;
    this.practiceNextEl.hidden = true;
  }

  private renderPracticeInputs(): void {
    const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
    const current = record?.items?.[this.practiceIndex];
    if (!current || !this.practiceInputsEl || !this.practiceStatusEl || !this.practiceStartEl || !this.practiceCheckEl || !this.practiceNextEl) return;

    const tokens = chunkSentence(current.correctedText);
    this.practiceInputsEl.innerHTML = tokens
      .map((token, index) => {
        if (!this.practiceSelections.includes(index)) {
          return `<span class="practice-token">${escapeHtml(token)}</span>`;
        }
        return `<input type="text" class="practice-blank" data-blank-index="${index}" aria-label="Blank ${index + 1}" />`;
      })
      .join("");
    this.practiceStatusEl.textContent = "Fill the blanks, then check your answer.";
    this.practiceStartEl.hidden = true;
    this.practiceCheckEl.hidden = false;
    this.practiceNextEl.hidden = true;
  }

  private checkPracticeAnswer(): void {
    const record = this.records.find((item) => item.dateKey === this.selectedDateKey);
    const current = record?.items?.[this.practiceIndex];
    if (!current || !this.practiceInputsEl || !this.practiceStatusEl || !this.practiceCheckEl || !this.practiceNextEl) return;

    const tokens = chunkSentence(current.correctedText);
    const blanks = Array.from(this.practiceInputsEl.querySelectorAll<HTMLInputElement>("[data-blank-index]"));
    const allCorrect = blanks.every((input) => {
      const index = Number(input.dataset.blankIndex);
      const expected = normalizeToken(tokens[index] ?? "");
      const actual = normalizeToken(input.value);
      const correct = expected === actual;
      input.classList.toggle("is-correct", correct);
      input.classList.toggle("is-wrong", !correct);
      return correct;
    });

    if (!allCorrect) {
      this.practiceStatusEl.textContent = "Not quite. Try again or compare it with the Better line.";
      return;
    }

    this.practiceStatusEl.textContent = "Nice. You got it.";
    this.practiceCheckEl.hidden = true;
    this.practiceNextEl.hidden = false;
    this.practiceNextEl.textContent = this.practiceIndex >= (record?.items?.length ?? 1) - 1 ? "Done" : "Next";
  }
}
