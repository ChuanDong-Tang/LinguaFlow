import { dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { confirmDialog } from "../../shared/confirmDialog";
import { escapeHtml } from "../../shared/html";
import { oioChatConfig } from "../../services/chat/chatConfig";
import { createChatReply, toChatErrorMessage, type ChatReply } from "../../services/chat/chatService";
import { fetchChatUsageSnapshot } from "../../services/chat/chatUsageService";
import { generatePracticeFeedback } from "../../services/chat/practiceService";
import { pullChatSessions, pushChatSessions } from "../../services/cloud/cloudSyncService";
import { getAccessRepository } from "../../infrastructure/repositories";
import { getI18n, t } from "../../i18n/i18n";
import { RewriteApiError } from "../../services/rewrite/rewriteClient";
import { getBrowserTtsService, splitTextForSpeech } from "../../services/tts/browserTtsService";
import { saveTurnToDailyCapture } from "./oioChatCapture";
import { createChatSession, deleteChatSession, listChatSessions, saveChatSession, type OioChatSession } from "./oioChatStore";
import { type ChatTurn, type OioChatMode } from "./oioChatTypes";
import { type CaptureItem } from "../dailyCapture/dailyCaptureStore";
import { getCaptureNaturalVersion } from "../../domain/capture";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export class OioChatController {
  private readonly root: HTMLElement | null;
  private readonly historyEl: HTMLElement | null;
  private readonly feedEl: HTMLElement | null;
  private readonly formEl: HTMLFormElement | null;
  private readonly inputEl: HTMLTextAreaElement | null;
  private readonly submitEl: HTMLButtonElement | null;
  private readonly clearEl: HTMLButtonElement | null;
  private readonly voiceInputEl: HTMLButtonElement | null;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly metaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly newChatEl: HTMLButtonElement | null;
  private sessions: OioChatSession[] = [];
  private activeSessionId = "";
  private activeMode: OioChatMode = "rewrite";
  private collapsedDateKeys = new Set<string>();
  private isAdminViewer = false;
  private adminViewerResolved = false;
  private speechRecognition: SpeechRecognitionLike | null = null;
  private speechRecognitionActive = false;
  private usageDailyUsed: number | null = null;
  private usageDailyLimit: number = oioChatConfig.maxDailyTurns;
  private static readonly usageStorageKey = "oio-chat-usage-v1";
  private static readonly collapseStorageKey = "oio-chat-history-collapsed-v1";

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-oio-chat"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.historyEl = document.querySelector<HTMLElement>("[data-oio-chat-history]");
    this.feedEl = root?.querySelector<HTMLElement>("[data-oio-chat-feed]") ?? null;
    this.formEl = root?.querySelector<HTMLFormElement>("[data-oio-chat-form]") ?? null;
    this.inputEl = root?.querySelector<HTMLTextAreaElement>("[data-oio-chat-input]") ?? null;
    this.submitEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-submit]") ?? null;
    this.clearEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-clear]") ?? null;
    this.voiceInputEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-voice-input]") ?? null;
    this.newChatEl = document.querySelector<HTMLButtonElement>("[data-oio-chat-new]");
    this.modeButtons = Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-oio-chat-mode]") ?? []);
    this.metaEl = root?.querySelector<HTMLElement>("[data-oio-chat-meta]") ?? null;
    this.statusEl = root?.querySelector<HTMLElement>("[data-oio-chat-status]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.feedEl || !this.inputEl || !this.historyEl) return;

    this.loadCollapsedGroups();
    await this.loadSessions();
    this.loadUsageFromStorage();
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.configureSpeechRecognition();
    this.bindEvents();
    getI18n().subscribe(() => {
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.updateVoiceInputState();
    });
    this.updateVoiceInputState();
    void this.refreshAdminViewerFlag();
    void this.syncUsageFromServer();
    void this.syncSessionsFromCloud();
  }

  private async syncSessionsFromCloud(): Promise<void> {
    try {
      await pullChatSessions();
      await this.loadSessions();
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      void this.syncUsageFromServer();
    } catch {
      // ignore cloud sync failures
    }
  }

  private bindEvents(): void {
    this.inputEl?.addEventListener("input", () => {
      if (!this.inputEl) return;
      if (this.inputEl.value.length > oioChatConfig.maxInputChars) {
        this.inputEl.value = this.inputEl.value.slice(0, oioChatConfig.maxInputChars);
      }
      this.updateMeta();
    });
    this.inputEl?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void this.sendMessage();
    });

    this.formEl?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.sendMessage();
    });

    this.clearEl?.addEventListener("click", () => {
      if (this.inputEl) this.inputEl.value = "";
      this.setStatus("");
      this.updateMeta();
    });
    this.voiceInputEl?.addEventListener("click", () => {
      this.toggleSpeechInput();
    });

    this.newChatEl?.addEventListener("click", async () => {
      await this.startNewSession();
    });

    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeMode = button.dataset.oioChatMode === "ask" ? "ask" : "rewrite";
        this.renderModeState();
      });
    });

    this.historyEl?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;

      const dateToggle = target?.closest<HTMLButtonElement>("[data-chat-date-toggle]");
      if (dateToggle) {
        const dateKey = dateToggle.dataset.chatDateToggle?.trim() ?? "";
        if (!dateKey) return;
        this.toggleDateGroup(dateKey);
        return;
      }

      const sessionBtn = target?.closest<HTMLElement>("[data-chat-session-id]");
      if (sessionBtn) {
        const sessionId = sessionBtn.dataset.chatSessionId?.trim() ?? "";
        if (!sessionId) return;
        this.activeSessionId = sessionId;
        this.renderModeState();
        this.renderHistory();
        this.renderFeed();
        this.updateMeta();
        this.setStatus("");
        return;
      }

      const deleteBtn = target?.closest<HTMLButtonElement>("[data-chat-session-delete]");
      if (deleteBtn) {
        const sessionId = deleteBtn.dataset.chatSessionDelete?.trim() ?? "";
        if (!sessionId) return;
        void this.confirmAndRemoveSession(sessionId);
        return;
      }

    });

    this.root?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const speakBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-speak]");
      if (speakBtn) {
        const encodedText = speakBtn.dataset.oioChatSpeak?.trim() ?? "";
        this.playEncodedText(encodedText);
        return;
      }
      const captureBtn = target?.closest<HTMLButtonElement>("[data-refine-turn-id]");
      if (!captureBtn) return;
      const turnId = captureBtn.dataset.refineTurnId?.trim() ?? "";
      if (!turnId) return;
      await this.captureTurn(turnId);
    });

    document.addEventListener("oio-chat-start-practice", (event) => {
      const detail = (event as CustomEvent<{ item?: CaptureItem }>).detail;
      const item = detail?.item;
      if (!item) return;
      void this.startPracticeSession(item);
    });

    document.addEventListener("app-auth-signed-in", () => {
      void this.syncUsageFromServer();
      void this.syncSessionsFromCloud();
    });
  }

  private async loadSessions(): Promise<void> {
    const sessions = await listChatSessions();
    const emptySessions = sessions.filter((session) => session.turns.length === 0);
    if (emptySessions.length) {
      await Promise.all(emptySessions.map((session) => deleteChatSession(session.id)));
    }
    this.sessions = sessions.filter((session) => session.turns.length > 0);

    if (!this.activeSessionId || !this.sessions.some((session) => session.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0]?.id ?? "";
    }
  }

  private get activeSession(): OioChatSession | null {
    return this.sessions.find((session) => session.id === this.activeSessionId) ?? null;
  }

  private async startNewSession(): Promise<void> {
    if (this.activeSession?.kind === "practice") {
      this.setStatus(t("oio_chat.practice_locked"));
      return;
    }
    const current = this.activeSession;
    if (current && current.turns.length === 0) {
      this.activeSessionId = current.id;
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.inputEl?.focus();
      return;
    }

    this.activeSessionId = "";
    if (this.inputEl) this.inputEl.value = "";
    this.setStatus("");
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.inputEl?.focus();
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.submitEl) return;

    const sourceText = this.inputEl.value.trim();
    if (!sourceText) return;

    let session = this.activeSession;
    if (!session) {
      session = createChatSession();
      this.sessions = [session, ...this.sessions];
      this.activeSessionId = session.id;
    }

    if (session.kind === "practice" && session.practiceCompleted) {
      this.setStatus(t("oio_chat.practice_finished_closed"));
      return;
    }

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text: sourceText,
      countsTowardLimit: true,
      occurredAt: new Date().toISOString(),
    };

    session.turns.push(userTurn);
    session.updatedAt = new Date().toISOString();
    if (session.title === oioChatConfig.newConversationTitle) {
      session.title = this.buildSessionTitle(sourceText);
    }

    this.inputEl.value = "";
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.setPending(true);

    try {
      await this.persistSessionSafely(session, false);
      if (session.kind === "practice") {
        await this.handlePracticeReply(session, sourceText);
      } else {
        const reply = await createChatReply(sourceText, this.activeMode);
        this.applyUsageSnapshot(reply.usageDailyUsed, reply.usageDailyLimit);
        session.turns.push(this.toAssistantTurn(sourceText, reply));
        session.updatedAt = new Date().toISOString();
        this.setStatus("");
        await this.persistSessionSafely(session, true);
      }
    } catch (error) {
      userTurn.countsTowardLimit = false;
      const adminDebug = await this.buildAdminDebug(error, {
        stage: session.kind === "practice" ? "practice_feedback" : "chat_reply",
        mode: this.activeMode,
      });
      session.turns.push({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: t("oio_chat.reply_failed"),
        quickNote: toChatErrorMessage(error),
        sourceText,
        occurredAt: new Date().toISOString(),
        adminDebug,
      });
      session.updatedAt = new Date().toISOString();
      this.setStatus(toChatErrorMessage(error));
      await this.persistSessionSafely(session, true);
      void this.syncUsageFromServer();
    } finally {
      this.setPending(false);
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.feedEl?.scrollTo({ top: this.feedEl.scrollHeight });
    }
  }

  private toAssistantTurn(sourceText: string, reply: ChatReply): ChatTurn {
    const naturalVersion = reply.isAlreadyNatural ? sourceText : reply.naturalVersion;
    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      mode: reply.mode,
      text: "",
      naturalVersion,
      answer: reply.answer,
      quickNote: reply.quickNote,
      keyPhrases: reply.keyPhrases,
      sourceText,
      occurredAt: new Date().toISOString(),
      encouragement: reply.encouragement,
      isAlreadyNatural: reply.isAlreadyNatural,
      usageDailyUsed: reply.usageDailyUsed,
      usageDailyLimit: reply.usageDailyLimit,
    };
  }

  private renderHistory(): void {
    if (!this.historyEl) return;
    if (!this.sessions.length) {
      this.historyEl.innerHTML = `<p class="oio-chat-history-empty">${escapeHtml(t("oio_chat.history_empty"))}</p>`;
      return;
    }

    const groups = new Map<string, OioChatSession[]>();
    for (const session of this.sessions) {
      const current = groups.get(session.dateKey) ?? [];
      current.push(session);
      groups.set(session.dateKey, current);
    }

    if (!groups.size) {
      this.historyEl.innerHTML = `<p class="oio-chat-history-empty">${escapeHtml(t("oio_chat.history_empty"))}</p>`;
      return;
    }

    const header = `
      <div class="oio-chat-history-head">
        <span class="oio-chat-history-head-label">${escapeHtml(t("oio_chat.history_title"))}</span>
      </div>
    `;

    this.historyEl.innerHTML = header + Array.from(groups.entries())
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([dateKey, sessions]) => {
        const isCollapsed = this.collapsedDateKeys.has(dateKey);
        return `
        <section class="oio-chat-history-group${isCollapsed ? " is-collapsed" : ""}">
          <button
            type="button"
            class="oio-chat-history-date"
            data-chat-date-toggle="${escapeHtml(dateKey)}"
            aria-expanded="${!isCollapsed}"
          >
            <span class="oio-chat-history-date-icon" aria-hidden="true">▾</span>
            <span class="oio-chat-history-date-label">${escapeHtml(formatKeyToSlashDisplay(dateKey))}</span>
          </button>
          <div class="oio-chat-history-list"${isCollapsed ? " hidden" : ""}>
            ${sessions
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
              .map((session) => `
                <article class="oio-chat-history-item${session.id === this.activeSessionId ? " is-active" : ""}">
                  <button
                    type="button"
                    class="oio-chat-history-open"
                    data-chat-session-id="${escapeHtml(session.id)}"
                  >
                  <span class="oio-chat-history-copy">
                    <strong class="oio-chat-history-title">${escapeHtml(session.title)}</strong>
                    <span class="oio-chat-history-meta">${session.turns.filter((turn) => turn.role === "user").length} ${escapeHtml(t("oio_chat.turns"))}</span>
                  </span>
                  </button>
                  <button type="button" class="oio-chat-history-delete" data-chat-session-delete="${escapeHtml(session.id)}" aria-label="${escapeHtml(t("oio_chat.delete_conversation_aria"))}">×</button>
                </article>
              `)
              .join("")}
          </div>
        </section>
      `;
      })
      .join("");
  }

  private renderFeed(): void {
    if (!this.feedEl) return;
    const session = this.activeSession;
    if (!session?.turns.length) {
      this.feedEl.innerHTML = `
        <article class="chat-bubble chat-bubble--assistant">
          <span class="chat-bubble-role">OIO</span>
          <p class="chat-bubble-text">${escapeHtml(t("oio_chat.intro"))}</p>
        </article>
      `;
      return;
    }

    this.feedEl.innerHTML = session.turns
      .map((turn) => {
        if (turn.role === "user") {
          return `
            <article class="chat-bubble chat-bubble--user">
              <span class="chat-bubble-role">${escapeHtml(t("oio_chat.you"))}</span>
              <p class="chat-bubble-text">${escapeHtml(turn.text)}</p>
            </article>
          `;
        }

        const naturalVersionBlock = turn.naturalVersion
          ? this.renderAssistantSection(t("oio_chat.section_natural"), turn.naturalVersion)
          : "";

        const encouragementBlock = turn.encouragement
          ? this.renderAssistantSection(t("oio_chat.section_encouragement"), turn.encouragement)
          : "";

        const answerBlock = turn.answer
          ? this.renderAssistantSection(t("oio_chat.section_answer"), turn.answer)
          : "";

        const quickNoteBlock = turn.quickNote
          ? this.renderAssistantSection(t("oio_chat.section_quick_note"), turn.quickNote)
          : "";

        const adminDebugBlock = this.isAdminViewer && turn.adminDebug?.trim()
          ? `
            <div class="chat-assistant-section">
              <span class="chat-assistant-label">${escapeHtml(t("oio_chat.section_admin_debug"))}</span>
              <pre class="chat-assistant-debug">${escapeHtml(turn.adminDebug)}</pre>
            </div>
          `
          : "";

        const keyPhrasesBlock = Array.isArray(turn.keyPhrases) && turn.keyPhrases.length
          ? `<div class="chat-highlight-list">${turn.keyPhrases.map((item) => this.renderPhraseChip(item)).join("")}</div>`
          : "";

        const actionBlock = turn.sourceText
          ? turn.capturedAt
            ? `<div class="chat-assistant-actions"><button type="button" class="secondary" disabled>${escapeHtml(t("oio_chat.saved_to"))} ${escapeHtml(formatKeyToSlashDisplay(turn.capturedDateKey ?? this.activeSession?.dateKey ?? dateToLocalKey(new Date())))}</button></div>`
            : `<div class="chat-assistant-actions"><button type="button" class="secondary" data-refine-turn-id="${escapeHtml(turn.id)}">${escapeHtml(t("oio_chat.save_to_daily_capture"))}</button></div>`
          : "";

        const mainText = turn.text?.trim()
          ? this.renderSpeakLines(turn.text, "chat-bubble-text")
          : "";

        return `
          <article class="chat-bubble chat-bubble--assistant">
            <span class="chat-bubble-role">OIO</span>
            ${mainText}
            ${encouragementBlock}
            ${naturalVersionBlock}
            ${answerBlock}
            ${quickNoteBlock}
            ${adminDebugBlock}
            ${keyPhrasesBlock}
            ${actionBlock}
          </article>
        `;
      })
      .join("");
  }

  private renderAssistantSection(label: string, text: string): string {
    return `
      <div class="chat-assistant-section">
        <span class="chat-assistant-label">${escapeHtml(label)}</span>
        ${this.renderSpeakParagraph(text, "chat-assistant-copy")}
      </div>
    `;
  }

  private renderSpeakParagraph(text: string, textClassName: string): string {
    const content = text.trim();
    if (!content) return "";
    const encoded = escapeHtml(encodeURIComponent(content));
    return `
      <div class="chat-speak-line">
        <p class="${textClassName}">${escapeHtml(content)}</p>
        ${this.renderSpeakButton("data-oio-chat-speak", encoded)}
      </div>
    `;
  }

  private renderSpeakLines(text: string, textClassName: string): string {
    const lines = splitTextForSpeech(text);
    if (!lines.length) return "";
    return `
      <div class="chat-speak-lines">
        ${lines
          .map((line) => {
            const encoded = escapeHtml(encodeURIComponent(line));
            return `
              <div class="chat-speak-line">
                <p class="${textClassName}">${escapeHtml(line)}</p>
                ${this.renderSpeakButton("data-oio-chat-speak", encoded)}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  private renderPhraseChip(phrase: string): string {
    const encoded = escapeHtml(encodeURIComponent(phrase));
    return `
      <span class="chat-highlight-chip">
        <span>${escapeHtml(phrase)}</span>
        ${this.renderSpeakButton("data-oio-chat-speak", encoded, "chat-chip-speak-btn")}
      </span>
    `;
  }

  private renderSpeakButton(dataAttr: string, encoded: string, className = "chat-speak-btn"): string {
    return `
      <button type="button" class="${className}" ${dataAttr}="${encoded}" aria-label="${escapeHtml(t("oio_chat.play_audio"))}" title="${escapeHtml(t("oio_chat.play_audio"))}">
        <svg viewBox="0 0 24 24" class="chat-speak-icon" aria-hidden="true">
          <path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"></path>
          <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      </button>
    `;
  }

  private playEncodedText(encodedText: string): void {
    if (!encodedText) return;
    let decoded = "";
    try {
      decoded = decodeURIComponent(encodedText);
    } catch {
      decoded = encodedText;
    }
    const played = getBrowserTtsService().speak(decoded);
    if (!played) {
      this.setStatus(t("oio_chat.voice_playback_unavailable"));
    }
  }

  private configureSpeechRecognition(): void {
    const recognitionCtor = ((window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition);
    if (!recognitionCtor) {
      this.speechRecognition = null;
      return;
    }

    const recognition = new recognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
      if (!transcript || !this.inputEl) return;
      this.inputEl.value = this.inputEl.value.trim() ? `${this.inputEl.value.trim()} ${transcript}` : transcript;
      this.updateMeta();
    };
    recognition.onerror = () => {
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
      this.setStatus(t("oio_chat.voice_input_failed"));
    };
    recognition.onend = () => {
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
    };
    this.speechRecognition = recognition;
  }

  private toggleSpeechInput(): void {
    if (!this.speechRecognition) {
      this.setStatus(t("oio_chat.voice_input_unavailable_browser"));
      return;
    }
    if (this.speechRecognitionActive) {
      this.speechRecognition.stop();
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
      return;
    }
    try {
      this.speechRecognition.start();
      this.speechRecognitionActive = true;
      this.setStatus(t("oio_chat.listening"));
      this.updateVoiceInputState();
    } catch {
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
      this.setStatus(t("oio_chat.voice_input_start_failed"));
    }
  }

  private updateVoiceInputState(): void {
    if (!this.voiceInputEl) return;
    const supported = !!this.speechRecognition;
    this.voiceInputEl.disabled = !supported;
    this.voiceInputEl.classList.toggle("is-listening", this.speechRecognitionActive);
    this.voiceInputEl.innerHTML = `
      <svg viewBox="0 0 24 24" class="oio-chat-voice-input-icon" aria-hidden="true">
        <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"></path>
        <path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M12 17v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
    this.voiceInputEl.setAttribute(
      "aria-label",
      supported
        ? (this.speechRecognitionActive ? t("oio_chat.voice_input_stop") : t("oio_chat.voice_input_start"))
        : t("oio_chat.voice_input_unavailable"),
    );
    this.voiceInputEl.setAttribute(
      "title",
      supported
        ? (this.speechRecognitionActive ? t("oio_chat.voice_input_stop") : t("oio_chat.voice_input_start"))
        : t("oio_chat.voice_input_unavailable"),
    );
  }

  private async captureTurn(turnId: string): Promise<void> {
    const session = this.activeSession;
    if (!session) return;

    const turn = session.turns.find((item) => item.id === turnId && item.role === "assistant");
    if (!turn?.sourceText || !turn.naturalVersion || turn.capturedAt) return;

    const result = await saveTurnToDailyCapture(turn, session.dateKey);
    turn.capturedAt = new Date().toISOString();
    turn.capturedDateKey = session.dateKey;
    session.updatedAt = new Date().toISOString();
    await this.persistSession(session);
    this.renderFeed();
    this.renderHistory();
    this.setStatus(
      result === "duplicate"
        ? t("oio_chat.already_saved_for_date")
        : `${t("oio_chat.saved_to")} ${formatKeyToSlashDisplay(session.dateKey)}.`,
    );
  }

  private updateMeta(): void {
    if (!this.metaEl || !this.inputEl) return;
    const used = this.usageDailyUsed;
    const limit = this.usageDailyLimit;
    const usageText = used === null ? `--/${limit} ${t("oio_chat.today")}` : `${used}/${limit} ${t("oio_chat.today")}`;
    this.metaEl.textContent = `${this.inputEl.value.length}/${oioChatConfig.maxInputChars} ${t("oio_chat.characters")} · ${usageText}`;
  }

  private renderModeState(): void {
    const isPractice = this.activeSession?.kind === "practice";
    const isPracticeCompleted = !!(isPractice && this.activeSession?.practiceCompleted);
    this.root?.classList.toggle("is-practice-session", isPractice);
    this.modeButtons.forEach((button) => {
      const selected = (button.dataset.oioChatMode === "ask" ? "ask" : "rewrite") === this.activeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = isPractice;
    });
    if (this.newChatEl) {
      this.newChatEl.disabled = isPractice;
    }

    if (!this.inputEl) return;
    if (isPractice) {
      this.inputEl.placeholder = isPracticeCompleted
        ? t("oio_chat.practice_placeholder_done")
        : t("oio_chat.practice_placeholder_once");
      this.inputEl.disabled = isPracticeCompleted;
      if (this.submitEl) {
        this.submitEl.disabled = isPracticeCompleted;
        if (isPracticeCompleted) {
          this.submitEl.textContent = t("oio_chat.done");
        } else if (!this.submitEl.textContent?.includes("Thinking")) {
          this.submitEl.textContent = t("oio_chat.send");
        }
      }
      return;
    }
    if (this.inputEl) this.inputEl.disabled = false;
    if (this.submitEl) this.submitEl.disabled = false;
    this.inputEl.placeholder = this.activeMode === "ask"
      ? t("oio_chat.ask_placeholder")
      : t("oio_chat.rewrite_placeholder");
  }

  private setPending(pending: boolean): void {
    if (this.inputEl) {
      this.inputEl.disabled = pending;
    }
    if (this.submitEl) {
      this.submitEl.disabled = pending;
      this.submitEl.textContent = pending ? t("oio_chat.thinking") : t("oio_chat.send");
    }
    if (pending) {
      this.setStatus(
        this.activeMode === "ask"
          ? t("oio_chat.working_answer")
          : t("oio_chat.working_natural"),
      );
    }
    if (pending && this.speechRecognitionActive) {
      this.speechRecognition?.stop();
      this.speechRecognitionActive = false;
    }
    this.updateVoiceInputState();
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  private async startPracticeSession(item: CaptureItem): Promise<void> {
    if (item.mode !== "ask") return;
    const baseQuestion = (getCaptureNaturalVersion(item) || item.sourceText).trim();
    const referenceAnswer = item.answer?.trim() ?? "";
    const question = baseQuestion;

    const session = createChatSession();
    session.kind = "practice";
    session.practice = {
      itemId: item.id,
      question,
      referenceAnswer,
      attempt: 0,
    };
    session.title = `${t("oio_chat.practice_title_prefix")}: ${this.buildSessionTitle(baseQuestion)}`;
    this.activeMode = "ask";
    session.turns.push({
      id: `assistant-question-${Date.now()}`,
      role: "assistant",
      text: question,
      practiceKind: "question",
      occurredAt: new Date().toISOString(),
    });

    this.sessions = [session, ...this.sessions];
    this.activeSessionId = session.id;
    this.setStatus("");
    await this.persistSessionSafely(session, true);
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.inputEl?.focus();
  }

  private async handlePracticeReply(session: OioChatSession, answer: string): Promise<void> {
    const question = session.practice?.question ?? session.turns.find((turn) => turn.practiceKind === "question")?.text ?? "";
    const referenceAnswer = session.practice?.referenceAnswer ?? "";
    const feedbackResult = await generatePracticeFeedback({ question, answer, referenceAnswer });
    this.applyUsageSnapshot(feedbackResult.usageDailyUsed, feedbackResult.usageDailyLimit);
    session.turns.push({
      id: `assistant-feedback-${Date.now()}`,
      role: "assistant",
      text: feedbackResult.feedback,
      naturalVersion: feedbackResult.isAlreadyNatural ? "" : feedbackResult.rewrittenAnswer,
      isAlreadyNatural: feedbackResult.isAlreadyNatural,
      usageDailyUsed: feedbackResult.usageDailyUsed,
      usageDailyLimit: feedbackResult.usageDailyLimit,
      practiceKind: "feedback",
      occurredAt: new Date().toISOString(),
    });
    session.practiceCompleted = true;
    session.updatedAt = new Date().toISOString();
    this.setStatus(t("oio_chat.practice_complete"));
    await this.persistSessionSafely(session, true);
    this.renderModeState();
  }

  private async persistSession(session: OioChatSession, pushCloud = true): Promise<void> {
    await saveChatSession(session);
    this.sessions = (await listChatSessions()).filter((item) => item.turns.length > 0);
    if (!this.sessions.some((item) => item.id === this.activeSessionId) && this.sessions[0]) {
      this.activeSessionId = this.sessions[0].id;
    }
    if (pushCloud) {
      void pushChatSessions(this.sessions);
    }
  }

  private async persistSessionSafely(session: OioChatSession, pushCloud = true): Promise<void> {
    try {
      await this.persistSession(session, pushCloud);
    } catch (error) {
      console.error("[oio-chat] Failed to persist session:", error);
      this.setStatus(t("oio_chat.persist_failed"));
    }
  }

  private async confirmAndRemoveSession(sessionId: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t("oio_chat.confirm_delete_title"),
      message: t("oio_chat.confirm_delete_message"),
      confirmText: t("oio_chat.delete"),
      cancelText: t("oio_chat.cancel"),
    });
    if (!confirmed) return;
    await this.removeSession(sessionId);
  }

  private async refreshAdminViewerFlag(): Promise<void> {
    try {
      const access = await getAccessRepository().getViewerAccess();
      this.isAdminViewer = !!access.profile?.isAdmin;
    } catch {
      this.isAdminViewer = false;
    } finally {
      this.adminViewerResolved = true;
      this.renderFeed();
    }
  }

  private async buildAdminDebug(
    error: unknown,
    context: { stage: "chat_reply" | "practice_feedback"; mode: OioChatMode },
  ): Promise<string | undefined> {
    if (!this.adminViewerResolved) {
      await this.refreshAdminViewerFlag();
    }
    if (!this.isAdminViewer) return undefined;

    const lines = [
      `time=${new Date().toISOString()}`,
      `stage=${context.stage}`,
      `mode=${context.mode}`,
      `error_type=${error instanceof Error ? error.name : typeof error}`,
    ];

    if (error instanceof RewriteApiError) {
      lines.push(`error_code=${error.code}`);
      lines.push(`error_message=${error.message}`);
      return lines.join("\n");
    }

    if (error instanceof Error) {
      lines.push(`error_message=${error.message}`);
      return lines.join("\n");
    }

    lines.push(`error_value=${String(error)}`);
    return lines.join("\n");
  }

  private async removeSession(sessionId: string): Promise<void> {
    await deleteChatSession(sessionId);
    this.sessions = (await listChatSessions()).filter((session) => session.turns.length > 0);

    if (!this.sessions.length) {
      this.activeSessionId = "";
    } else if (this.activeSessionId === sessionId || !this.sessions.some((item) => item.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0].id;
    }

    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.setStatus("");
    void pushChatSessions(this.sessions);
  }

  private loadCollapsedGroups(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(OioChatController.collapseStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.collapsedDateKeys = new Set(parsed.filter((item) => typeof item === "string"));
      }
    } catch {
      this.collapsedDateKeys = new Set();
    }
  }

  private toggleDateGroup(dateKey: string): void {
    if (this.collapsedDateKeys.has(dateKey)) {
      this.collapsedDateKeys.delete(dateKey);
    } else {
      this.collapsedDateKeys.add(dateKey);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        OioChatController.collapseStorageKey,
        JSON.stringify(Array.from(this.collapsedDateKeys))
      );
    }
    this.renderHistory();
  }

  private buildSessionTitle(text: string): string {
    const compact = text.trim().replace(/\s+/g, " ");
    return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact;
  }

  private applyUsageSnapshot(used?: number, limit?: number): void {
    let updated = false;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      this.usageDailyLimit = limit;
      updated = true;
    }
    if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
      this.usageDailyUsed = used;
      updated = true;
    }
    if (updated) {
      this.persistUsageToStorage();
    }
  }

  private loadUsageFromStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(OioChatController.usageStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { used?: number; limit?: number } | null;
      this.applyUsageSnapshot(parsed?.used, parsed?.limit);
    } catch {
      // ignore invalid cache
    }
  }

  private persistUsageToStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        OioChatController.usageStorageKey,
        JSON.stringify({
          used: this.usageDailyUsed,
          limit: this.usageDailyLimit,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // ignore storage failures
    }
  }

  private async syncUsageFromServer(): Promise<void> {
    try {
      const snapshot = await fetchChatUsageSnapshot();
      if (!snapshot) return;
      this.applyUsageSnapshot(snapshot.used, snapshot.limit);
      this.updateMeta();
    } catch {
      // ignore sync failures; keep local cache for display
    }
  }
}
