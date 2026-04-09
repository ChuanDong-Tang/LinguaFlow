import { dateToLocalKey } from "../../dateUtils.js";
import { escapeHtml } from "../../shared/html";
import { createChatReply, toChatErrorMessage, type ChatReply } from "../../services/chat/chatService";
import { getCaptureRecord } from "../dailyCapture/dailyCaptureStore";
import { saveTurnToDailyCapture } from "./oioChatCapture";
import { type ChatTurn } from "./oioChatTypes";

const MAX_DAILY_TURNS = 20;
const MAX_INPUT_CHARS = 320;

export class OioChatController {
  private readonly root: HTMLElement | null;
  private readonly feedEl: HTMLElement | null;
  private readonly formEl: HTMLFormElement | null;
  private readonly inputEl: HTMLTextAreaElement | null;
  private readonly submitEl: HTMLButtonElement | null;
  private readonly clearEl: HTMLButtonElement | null;
  private readonly metaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly todayCountEl: HTMLElement | null;
  private turns: ChatTurn[] = [];
  private turnCount = 0;

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-oio-chat"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.feedEl = root?.querySelector<HTMLElement>("[data-oio-chat-feed]") ?? null;
    this.formEl = root?.querySelector<HTMLFormElement>("[data-oio-chat-form]") ?? null;
    this.inputEl = root?.querySelector<HTMLTextAreaElement>("[data-oio-chat-input]") ?? null;
    this.submitEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-submit]") ?? null;
    this.clearEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-clear]") ?? null;
    this.metaEl = root?.querySelector<HTMLElement>("[data-oio-chat-meta]") ?? null;
    this.statusEl = root?.querySelector<HTMLElement>("[data-oio-chat-status]") ?? null;
    this.todayCountEl = root?.querySelector<HTMLElement>("[data-oio-chat-capture-count]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.feedEl || !this.inputEl) return;

    this.renderFeed();
    this.updateMeta();
    await this.refreshTodayCount();
    this.bindEvents();
  }

  private bindEvents(): void {
    this.inputEl?.addEventListener("input", () => {
      if (!this.inputEl) return;
      if (this.inputEl.value.length > MAX_INPUT_CHARS) {
        this.inputEl.value = this.inputEl.value.slice(0, MAX_INPUT_CHARS);
      }
      this.updateMeta();
    });

    this.formEl?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.sendMessage();
    });

    this.clearEl?.addEventListener("click", () => {
      this.turns = [];
      this.turnCount = 0;
      if (this.inputEl) this.inputEl.value = "";
      this.setStatus("");
      this.updateMeta();
      this.renderFeed();
    });

    this.root?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const refineBtn = target?.closest<HTMLButtonElement>("[data-refine-turn-id]");
      if (!refineBtn) return;

      const turnId = refineBtn.dataset.refineTurnId?.trim() ?? "";
      if (!turnId) return;

      const turn = this.turns.find((item) => item.id === turnId && item.role === "assistant");
      if (!turn?.sourceText || !turn.correctedText) return;

      await this.captureTurn(turn);
    });
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.submitEl) return;

    const sourceText = this.inputEl.value.trim();
    if (!sourceText) return;
    if (this.turnCount >= MAX_DAILY_TURNS) {
      this.setStatus(`Daily turn limit reached (${MAX_DAILY_TURNS}).`);
      return;
    }

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text: sourceText,
    };
    this.turns.push(userTurn);
    this.turnCount += 1;
    this.inputEl.value = "";
    this.updateMeta();
    this.renderFeed();
    this.setPending(true);

    try {
      const reply = await createChatReply(sourceText);
      this.turns.push(this.toAssistantTurn(sourceText, reply));
      this.setStatus("");
    } catch (error) {
      this.turns.push({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: "I could not finish that reply.",
        note: toChatErrorMessage(error),
        sourceText,
      });
      this.setStatus(toChatErrorMessage(error));
    } finally {
      this.setPending(false);
      this.renderFeed();
      this.feedEl?.scrollTo({ top: this.feedEl.scrollHeight });
    }
  }

  private toAssistantTurn(sourceText: string, reply: ChatReply): ChatTurn {
    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: reply.responseText,
      correctedText: reply.correctedText,
      note: reply.note,
      highlights: reply.highlights,
      sourceText,
    };
  }

  private renderFeed(): void {
    if (!this.feedEl) return;
    if (!this.turns.length) {
      this.feedEl.innerHTML = "";
      return;
    }

    this.feedEl.innerHTML = this.turns
      .map((turn) => {
        if (turn.role === "user") {
          return `
            <article class="chat-bubble chat-bubble--user">
              <span class="chat-bubble-role">You</span>
              <p class="chat-bubble-text">${escapeHtml(turn.text)}</p>
            </article>
          `;
        }

        const highlights = Array.isArray(turn.highlights) && turn.highlights.length
          ? `<div class="chat-highlight-list">${turn.highlights.map((item) => `<span class="chat-highlight-chip">${escapeHtml(item)}</span>`).join("")}</div>`
          : "";

        const correctedBlock = turn.correctedText
          ? `
            <div class="chat-assistant-section">
              <span class="chat-assistant-label">Cleaner version</span>
              <p class="chat-assistant-copy">${escapeHtml(turn.correctedText)}</p>
            </div>
          `
          : "";

        const noteBlock = turn.note
          ? `
            <div class="chat-assistant-section">
              <span class="chat-assistant-label">Quick note</span>
              <p class="chat-assistant-copy">${escapeHtml(turn.note)}</p>
            </div>
          `
          : "";

        const actionBlock = turn.correctedText && turn.sourceText
          ? `<div class="chat-assistant-actions"><button type="button" class="secondary" data-refine-turn-id="${escapeHtml(turn.id)}">Refine this</button></div>`
          : "";

        return `
          <article class="chat-bubble chat-bubble--assistant">
            <span class="chat-bubble-role">OIO</span>
            <p class="chat-bubble-text">${escapeHtml(turn.text)}</p>
            ${correctedBlock}
            ${noteBlock}
            ${highlights}
            ${actionBlock}
          </article>
        `;
      })
      .join("");
  }

  private async captureTurn(turn: ChatTurn): Promise<void> {
    const result = await saveTurnToDailyCapture(turn);
    await this.refreshTodayCount();
    this.setStatus(result === "duplicate" ? "Already added to today." : "Added to Daily Capture.");
  }

  private async refreshTodayCount(): Promise<void> {
    if (!this.todayCountEl) return;
    const dateKey = dateToLocalKey(new Date());
    const current = await getCaptureRecord(dateKey);
    const count = current?.items?.length ?? 0;
    this.todayCountEl.textContent = `${count} saved today`;
  }

  private updateMeta(): void {
    if (!this.metaEl || !this.inputEl) return;
    this.metaEl.textContent = `${this.inputEl.value.length}/${MAX_INPUT_CHARS} characters · ${this.turnCount}/${MAX_DAILY_TURNS} turns`;
  }

  private setPending(pending: boolean): void {
    if (this.inputEl) {
      this.inputEl.disabled = pending;
    }
    if (this.submitEl) {
      this.submitEl.disabled = pending;
      this.submitEl.textContent = pending ? "Thinking..." : "Send";
    }
    if (pending) {
      this.setStatus("Working on a cleaner version...");
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }
}
