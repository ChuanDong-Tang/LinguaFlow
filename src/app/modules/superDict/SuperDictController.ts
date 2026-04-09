import { escapeHtml } from "../../shared/html";
import { buildLookupUrls, normalizeLookupQuery } from "./superDictLinks";
import { deleteLookupHistory, listLookupHistory, saveLookupHistory, type SuperDictRecord, toViewDate } from "./superDictHistory";

export class SuperDictController {
  private readonly root: HTMLElement | null;
  private readonly formEl: HTMLFormElement | null;
  private readonly inputEl: HTMLInputElement | null;
  private readonly historyPanelEl: HTMLElement | null;
  private readonly historyEl: HTMLElement | null;
  private readonly linkEls: HTMLAnchorElement[] = [];
  private records: SuperDictRecord[] = [];
  private historyOpen = false;

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-super-dict"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.formEl = root?.querySelector<HTMLFormElement>("[data-super-dict-form]") ?? null;
    this.inputEl = root?.querySelector<HTMLInputElement>("[data-super-dict-input]") ?? null;
    this.historyPanelEl = root?.querySelector<HTMLElement>("[data-super-dict-history-panel]") ?? null;
    this.historyEl = root?.querySelector<HTMLElement>("[data-super-dict-history]") ?? null;
    this.linkEls = Array.from(root?.querySelectorAll<HTMLAnchorElement>("[data-super-dict-link]") ?? []);
  }

  async init(): Promise<void> {
    if (!this.root || !this.inputEl) return;

    this.applyLinks("");
    await this.loadHistory();
    this.bindEvents();
  }

  private bindEvents(): void {
    this.formEl?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = normalizeLookupQuery(this.inputEl?.value ?? "");
      if (!query) return;

      this.setHistoryOpen(false);
      this.applyLinks(query);
      await this.saveHistory(query);
    });

    this.inputEl?.addEventListener("focus", () => {
      this.setHistoryOpen(this.records.length > 0);
    });

    this.root?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const deleteBtn = target?.closest<HTMLButtonElement>("[data-super-dict-delete-id]");
      if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        const recordId = deleteBtn.dataset.superDictDeleteId?.trim() ?? "";
        if (recordId) {
          await this.deleteHistoryRecord(recordId);
        }
        return;
      }

      const historyBtn = target?.closest<HTMLButtonElement>("[data-super-dict-record-query]");
      if (historyBtn) {
        const query = normalizeLookupQuery(historyBtn.dataset.superDictRecordQuery ?? "");
        if (!query) return;
        if (this.inputEl) {
          this.inputEl.value = query;
        }
        this.applyLinks(query);
        this.setHistoryOpen(false);
        return;
      }

      const linkEl = target?.closest<HTMLAnchorElement>("[data-super-dict-link]");
      if (!linkEl) return;

      const query = normalizeLookupQuery(this.inputEl?.value ?? "");
      this.applyLinks(query);
      if (query) {
        void this.saveHistory(query);
        this.setHistoryOpen(false);
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target as Node | null;
      if (!target) return;
      const clickedInside = !!this.root?.contains(target);
      const clickedInput = !!(target instanceof Element && target.closest("[data-super-dict-form]"));
      if (clickedInside && clickedInput) return;
      this.setHistoryOpen(false);
    });
  }

  private async loadHistory(): Promise<void> {
    try {
      this.records = await listLookupHistory();
    } catch {
      this.records = [];
    }
    this.renderHistory();
  }

  private async saveHistory(query: string): Promise<void> {
    const normalizedQuery = query.toLowerCase();
    const existing = this.records.find((record) => record.query.trim().toLowerCase() === normalizedQuery);
    if (existing) return;

    const record: SuperDictRecord = {
      id: `super-dict-${Date.now()}`,
      createdAt: new Date().toISOString(),
      query,
      title: query,
    };

    try {
      await saveLookupHistory(record);
      await this.loadHistory();
    } catch {
      // Ignore storage failures; links still work without local history.
    }
  }

  private applyLinks(query: string): void {
    const urls = buildLookupUrls(query);
    this.linkEls.forEach((linkEl) => {
      const key = linkEl.dataset.superDictLink ?? "";
      const href = urls[key];
      if (href) {
        linkEl.href = href;
      }
    });
  }

  private renderHistory(): void {
    if (!this.historyEl) return;

    const hasRecords = this.records.length > 0;
    this.historyEl.hidden = !hasRecords;
    this.historyEl.innerHTML = this.records
      .slice(0, 10)
      .map(
        (record) => `
          <div class="super-dict-history-option">
            <button type="button" class="super-dict-history-select" data-super-dict-record-query="${escapeHtml(record.query)}">
              <span class="super-dict-history-option-main">
                <span class="super-dict-history-option-title">${escapeHtml(record.title)}</span>
                <span class="super-dict-history-option-meta">${escapeHtml(toViewDate(record.createdAt))}</span>
              </span>
            </button>
            <span class="super-dict-history-option-side">
              <button
                type="button"
                class="super-dict-history-delete"
                aria-label="删除这条历史记录"
                title="删除"
                data-super-dict-delete-id="${escapeHtml(record.id)}"
              >
                <svg viewBox="0 0 24 24" class="super-dict-history-delete-icon" aria-hidden="true">
                  <path d="M9 3h6a1 1 0 0 1 .9.55l.45.95H20a1 1 0 1 1 0 2h-1.1l-.83 12.16A2.5 2.5 0 0 1 15.57 20H8.43a2.5 2.5 0 0 1-2.5-2.34L5.1 5.5H4a1 1 0 1 1 0-2h3.65l.45-.95A1 1 0 0 1 9 3Zm-1.9 2.5.82 12.02a.5.5 0 0 0 .5.48h7.16a.5.5 0 0 0 .5-.48L16.9 5.5H7.1Zm3.15 2.25c.41 0 .75.34.75.75v6a.75.75 0 0 1-1.5 0v-6c0-.41.34-.75.75-.75Zm3.5 0c.41 0 .75.34.75.75v6a.75.75 0 0 1-1.5 0v-6c0-.41.34-.75.75-.75Z" />
                </svg>
              </button>
            </span>
          </div>
        `,
      )
      .join("");
    this.setHistoryOpen(this.historyOpen && hasRecords);
  }

  private async deleteHistoryRecord(recordId: string): Promise<void> {
    try {
      await deleteLookupHistory(recordId);
      this.records = this.records.filter((record) => record.id !== recordId);
      this.renderHistory();
      if (!this.records.length) {
        this.setHistoryOpen(false);
      }
    } catch {
      // Ignore deletion failures to keep the dropdown responsive.
    }
  }

  private setHistoryOpen(open: boolean): void {
    this.historyOpen = open;
    if (this.historyPanelEl) {
      this.historyPanelEl.hidden = !open || this.records.length === 0;
    }
  }
}
