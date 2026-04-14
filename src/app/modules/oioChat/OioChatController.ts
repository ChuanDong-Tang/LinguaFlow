import { dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { confirmDialog } from "../../shared/confirmDialog";
import { escapeHtml } from "../../shared/html";
import { oioChatConfig } from "../../services/chat/chatConfig";
import { createChatReply, toChatErrorMessage, type ChatReply } from "../../services/chat/chatService";
import { fetchChatUsageSnapshot } from "../../services/chat/chatUsageService";
import { generatePracticeFeedback, generatePracticeQuestion } from "../../services/chat/practiceService";
import { pullChatSessions, pullMoreChatSessions, pushChatSessions } from "../../services/cloud/cloudSyncService";
import { getAccessRepository } from "../../infrastructure/repositories";
import { getI18n, t } from "../../i18n/i18n";
import { RewriteApiError } from "../../services/rewrite/rewriteClient";
import { getBrowserTtsService, splitTextForSpeech } from "../../services/tts/browserTtsService";
import { getAuthService } from "../../services/auth/authService";
import { saveTurnToDailyCapture } from "./oioChatCapture";
import { createChatSession, deleteChatSession, listChatSessions, saveChatSession, type OioChatSession } from "./oioChatStore";
import { type ChatTurn, type OioChatMode } from "./oioChatTypes";
import { type CaptureItem } from "../dailyCapture/dailyCaptureStore";
import { getCaptureKeyPhrases, getCaptureNaturalVersion } from "../../domain/capture";

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
  private sessions: OioChatSession[] = [];
  private activeSessionId = "";
  private activeMode: OioChatMode = "rewrite";
  private collapsedDateKeys = new Set<string>();
  private isAdminViewer = false;
  private adminViewerResolved = false;
  private speechRecognition: SpeechRecognitionLike | null = null;
  private speechRecognitionActive = false;
  private usageDailyUsed: number | null = null;
  private usageDailyLimit: number | null = null;
  private cloudHasMore = false;
  private cloudNextBefore: string | null = null;
  private loadingMoreHistory = false;
  private pendingSessionIds = new Set<string>();
  private pendingSessionModes = new Map<string, OioChatMode | "practice">();
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
    this.modeButtons = Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-oio-chat-mode]") ?? []);
    this.metaEl = root?.querySelector<HTMLElement>("[data-oio-chat-meta]") ?? null;
    this.statusEl = root?.querySelector<HTMLElement>("[data-oio-chat-status]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.feedEl || !this.inputEl || !this.historyEl) return;

    this.loadCollapsedGroups();
    await this.loadSessions();
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
      const result = await pullChatSessions();
      this.cloudHasMore = !!result?.hasMore;
      this.cloudNextBefore = result?.nextBefore ?? null;
      await this.loadSessions();
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      void this.syncUsageFromServer();
    } catch {
      this.cloudHasMore = false;
      this.cloudNextBefore = null;
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

    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeMode = button.dataset.oioChatMode === "ask" ? "ask" : "rewrite";
        this.renderModeState();
      });
    });

    this.historyEl?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;

      const newChatBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-new]");
      if (newChatBtn) {
        await this.startNewSession();
        return;
      }

      const loadMoreBtn = target?.closest<HTMLButtonElement>("[data-chat-history-load-more]");
      if (loadMoreBtn) {
        void this.loadMoreHistoryFromCloud();
        return;
      }

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
        await this.playEncodedText(encodedText);
        return;
      }
      const practiceBtn = target?.closest<HTMLButtonElement>("[data-start-practice-turn-id]");
      if (practiceBtn) {
        const turnId = practiceBtn.dataset.startPracticeTurnId?.trim() ?? "";
        if (!turnId) return;
        await this.startPracticeFromTurn(turnId);
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
    if (this.isActiveSessionPending()) return;

    const sourceText = this.inputEl.value.trim();
    if (!sourceText) return;
    if (!this.ensureSignedInBeforeChat()) return;

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
    const waitingPracticeReply = this.isWaitingPracticeReply(session);
    if (waitingPracticeReply && session.practiceCompleted) {
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
    this.setSessionPending(session.id, true, session.kind === "practice" ? "practice" : this.activeMode);

    try {
      await this.persistSessionSafely(session, false);
      if (waitingPracticeReply) {
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
      this.setSessionPending(session.id, false);
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.feedEl?.scrollTo({ top: this.feedEl.scrollHeight });
    }
  }

  private ensureSignedInBeforeChat(): boolean {
    const authSnapshot = getAuthService().getSnapshot();
    if (authSnapshot.status === "signed_in") return true;

    if (authSnapshot.status === "loading") {
      this.setStatus(t("account.checking_session"));
      return false;
    }
    if (authSnapshot.status === "disabled") {
      this.setStatus(t("oio_chat.login_required_unavailable"));
      return false;
    }

    this.setStatus(t("oio_chat.login_required"));
    void getAuthService().openSignIn();
    return false;
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

    const isPractice = this.activeSession?.kind === "practice";
    const header = `
      <div class="oio-chat-history-head">
        <span class="oio-chat-history-head-label">${escapeHtml(t("oio_chat.history_title"))}</span>
        <button type="button" class="secondary oio-chat-history-new-btn" data-oio-chat-new ${isPractice ? "disabled" : ""}>${escapeHtml(t("oio_chat.new_chat"))}</button>
      </div>
    `;

    const groupsHtml = Array.from(groups.entries())
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
    const loadMoreHtml = this.cloudHasMore
      ? `
        <div class="oio-chat-history-more">
          <button type="button" class="secondary" data-chat-history-load-more ${this.loadingMoreHistory ? "disabled" : ""}>
            ${escapeHtml(this.loadingMoreHistory ? t("common.loading") : t("oio_chat.history_load_more"))}
          </button>
        </div>
      `
      : "";
    this.historyEl.innerHTML = header + groupsHtml + loadMoreHtml;
  }

  private async loadMoreHistoryFromCloud(): Promise<void> {
    if (this.loadingMoreHistory) return;
    if (!this.cloudHasMore || !this.cloudNextBefore) return;
    this.loadingMoreHistory = true;
    this.renderHistory();
    try {
      const result = await pullMoreChatSessions(this.cloudNextBefore);
      if (!result) return;
      this.cloudHasMore = result.hasMore;
      this.cloudNextBefore = result.nextBefore;
      await this.loadSessions();
      this.renderFeed();
      this.updateMeta();
    } catch {
      // ignore load-more failures
    } finally {
      this.loadingMoreHistory = false;
      this.renderHistory();
    }
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

    const turnsHtml = session.turns
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

        const canStartPracticeNow = this.activeSession?.kind !== "practice"
          && turn.mode === "rewrite"
          && Array.isArray(turn.keyPhrases)
          && turn.keyPhrases.length > 0;
        const saveAction = turn.sourceText
          ? turn.capturedAt
            ? `<button type="button" class="secondary" disabled>${escapeHtml(t("oio_chat.saved_to"))} ${escapeHtml(formatKeyToSlashDisplay(turn.capturedDateKey ?? this.activeSession?.dateKey ?? dateToLocalKey(new Date())))}</button>`
            : `<button type="button" class="secondary" data-refine-turn-id="${escapeHtml(turn.id)}">${escapeHtml(t("oio_chat.save_to_daily_capture"))}</button>`
          : "";
        const practiceAction = canStartPracticeNow
          ? `<button type="button" class="secondary" data-start-practice-turn-id="${escapeHtml(turn.id)}">${escapeHtml(t("oio_chat.practice_now"))}</button>`
          : "";
        const actionBlock = saveAction || practiceAction
          ? `<div class="chat-assistant-actions">${saveAction}${practiceAction}</div>`
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
    const pendingBubble = this.isSessionPending(session.id)
      ? `
        <article class="chat-bubble chat-bubble--assistant chat-bubble--thinking">
          <span class="chat-bubble-role">OIO</span>
          <div class="chat-thinking-row">
            <span class="chat-thinking-spinner" aria-hidden="true"></span>
            <span class="chat-assistant-copy">${escapeHtml(t("oio_chat.thinking"))}</span>
          </div>
        </article>
      `
      : "";
    this.feedEl.innerHTML = turnsHtml + pendingBubble;
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

  private async playEncodedText(encodedText: string): Promise<void> {
    if (!encodedText) return;
    let decoded = "";
    try {
      decoded = decodeURIComponent(encodedText);
    } catch {
      decoded = encodedText;
    }
    const played = await getBrowserTtsService().speak(decoded);
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
    const usedText = used === null ? "--" : String(used);
    const limitText = limit === null ? "--" : String(limit);
    const usageText = `${usedText}/${limitText} ${t("oio_chat.today")}`;
    this.metaEl.textContent = `${this.inputEl.value.length}/${oioChatConfig.maxInputChars} ${t("oio_chat.characters")} · ${usageText}`;
  }

  private renderModeState(): void {
    const isPractice = this.activeSession?.kind === "practice";
    this.root?.classList.toggle("is-practice-session", isPractice);
    this.modeButtons.forEach((button) => {
      const selected = (button.dataset.oioChatMode === "ask" ? "ask" : "rewrite") === this.activeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = isPractice;
    });
    const newChatButtons = this.historyEl?.querySelectorAll<HTMLButtonElement>("[data-oio-chat-new]") ?? [];
    newChatButtons.forEach((button) => {
      button.disabled = isPractice;
    });

    if (!this.inputEl) return;
    if (isPractice) {
      this.inputEl.placeholder = this.activeSession?.practiceCompleted
        ? t("oio_chat.practice_placeholder_done")
        : t("oio_chat.practice_placeholder_once");
      this.updateComposerPendingState();
      return;
    }
    this.inputEl.placeholder = this.activeMode === "ask"
      ? t("oio_chat.ask_placeholder")
      : t("oio_chat.rewrite_placeholder");
    this.updateComposerPendingState();
  }

  private isSessionPending(sessionId: string): boolean {
    return this.pendingSessionIds.has(sessionId);
  }

  private isActiveSessionPending(): boolean {
    return !!this.activeSessionId && this.pendingSessionIds.has(this.activeSessionId);
  }

  private setSessionPending(sessionId: string, pending: boolean, pendingMode?: OioChatMode | "practice"): void {
    if (!sessionId) return;
    if (pending) {
      this.pendingSessionIds.add(sessionId);
      this.pendingSessionModes.set(sessionId, pendingMode ?? "rewrite");
    } else {
      this.pendingSessionIds.delete(sessionId);
      this.pendingSessionModes.delete(sessionId);
    }
    if (this.activeSessionId === sessionId) {
      this.updateComposerPendingState();
      this.renderFeed();
      this.updateMeta();
    }
    if (pending && this.speechRecognitionActive && this.activeSessionId === sessionId) {
      this.speechRecognition?.stop();
      this.speechRecognitionActive = false;
    }
    this.updateVoiceInputState();
  }

  private updateComposerPendingState(): void {
    const isPending = this.isActiveSessionPending();
    const active = this.activeSession;
    const isPracticeCompleted = !!(active?.kind === "practice" && active.practiceCompleted);
    if (this.inputEl) {
      this.inputEl.disabled = isPracticeCompleted || isPending;
    }
    if (this.submitEl) {
      this.submitEl.disabled = isPracticeCompleted || isPending;
      this.submitEl.textContent = isPracticeCompleted ? t("oio_chat.done") : isPending ? t("oio_chat.thinking") : t("oio_chat.send");
    }
    if (isPending && active?.id) {
      const pendingMode = this.pendingSessionModes.get(active.id);
      this.setStatus(
        pendingMode === "ask"
          ? t("oio_chat.working_answer")
          : t("oio_chat.working_natural"),
      );
      return;
    }
    const currentStatus = this.statusEl?.textContent ?? "";
    if (currentStatus === t("oio_chat.working_answer") || currentStatus === t("oio_chat.working_natural")) {
      this.setStatus("");
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  private async startPracticeSession(item: CaptureItem): Promise<void> {
    const contextText = (getCaptureNaturalVersion(item) || item.answer || item.sourceText).trim();
    const targetPhrase = (getCaptureKeyPhrases(item)[0] ?? "").trim();
    if (!contextText) {
      this.setStatus(t("oio_chat.practice_context_missing"));
      return;
    }
    if (!targetPhrase) {
      this.setStatus(t("oio_chat.practice_target_missing"));
      return;
    }
    await this.openPracticeSession({
      itemId: item.id,
      contextText,
      targetPhrase,
      referenceAnswer: item.answer?.trim() ?? "",
      titleSeed: contextText,
      entry: "card",
    });
  }

  private async startPracticeFromTurn(turnId: string): Promise<void> {
    const session = this.activeSession;
    if (!session || session.kind === "practice") return;
    const turn = session.turns.find((item) => item.id === turnId && item.role === "assistant");
    if (!turn) return;
    const contextText = (turn.naturalVersion || turn.answer || turn.text || turn.sourceText || "").trim();
    const targetPhrase = (Array.isArray(turn.keyPhrases) ? turn.keyPhrases[0] : "").trim();
    if (!contextText) {
      this.setStatus(t("oio_chat.practice_context_missing"));
      return;
    }
    if (!targetPhrase) {
      this.setStatus(t("oio_chat.practice_target_missing"));
      return;
    }
    await this.openPracticeSession({
      itemId: turn.id,
      contextText,
      targetPhrase,
      referenceAnswer: turn.naturalVersion || turn.answer || "",
      titleSeed: turn.sourceText || contextText,
      entry: "inline",
    });
  }

  private async openPracticeSession({
    itemId,
    contextText,
    targetPhrase,
    referenceAnswer,
    titleSeed,
    entry,
  }: {
    itemId: string;
    contextText: string;
    targetPhrase: string;
    referenceAnswer?: string;
    titleSeed: string;
    entry: "card" | "inline";
  }): Promise<void> {
    const session = entry === "card"
      ? (() => {
        const created = createChatSession();
        created.kind = "practice";
        created.practice = {
          itemId,
          question: "",
          targetPhrase,
          referenceAnswer: referenceAnswer?.trim() || undefined,
          attempt: 0,
        };
        created.title = `${t("oio_chat.practice_title_prefix")}: ${this.buildSessionTitle(titleSeed)}`;
        return created;
      })()
      : this.activeSession;
    if (!session) return;

    if (entry === "inline") {
      session.practice = {
        itemId,
        question: "",
        targetPhrase,
        referenceAnswer: referenceAnswer?.trim() || undefined,
        attempt: 0,
      };
      session.practiceCompleted = false;
    } else {
      this.sessions = [session, ...this.sessions];
      this.activeSessionId = session.id;
      this.activeMode = "ask";
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
    }

    this.setSessionPending(session.id, true, "practice");
    await this.persistSessionSafely(session, true);

    let questionResult: Awaited<ReturnType<typeof generatePracticeQuestion>>;
    try {
      questionResult = await generatePracticeQuestion({ contextText, targetPhrase });
    } catch (error) {
      this.setSessionPending(session.id, false);
      if (entry === "inline") {
        session.practice = undefined;
        session.practiceCompleted = undefined;
        session.updatedAt = new Date().toISOString();
        await this.persistSessionSafely(session, true);
      } else {
        await deleteChatSession(session.id);
        this.sessions = this.sessions.filter((item) => item.id !== session.id);
        if (this.activeSessionId === session.id) {
          this.activeSessionId = this.sessions[0]?.id ?? "";
        }
      }
      this.setStatus(toChatErrorMessage(error));
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      return;
    }
    this.applyUsageSnapshot(questionResult.usageDailyUsed, questionResult.usageDailyLimit);
    const question = questionResult.question.trim();
    if (!question) {
      this.setSessionPending(session.id, false);
      this.setStatus(t("oio_chat.reply_failed"));
      return;
    }

    session.practice = {
      ...(session.practice ?? {
        itemId,
        targetPhrase,
        referenceAnswer: referenceAnswer?.trim() || undefined,
        attempt: 0,
      }),
      question,
    };
    session.turns.push({
      id: `assistant-question-${Date.now()}`,
      role: "assistant",
      text: `${question}\n${this.buildPracticeTryUsingLine(targetPhrase)}`,
      keyPhrases: [targetPhrase],
      practiceKind: "question",
      occurredAt: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    this.setSessionPending(session.id, false);
    this.setStatus("");
    await this.persistSessionSafely(session, true);
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.inputEl?.focus();
  }

  private buildPracticeTryUsingLine(targetPhrase: string): string {
    return `Try using "${targetPhrase}".`;
  }

  private async handlePracticeReply(session: OioChatSession, answer: string): Promise<void> {
    const question = session.practice?.question ?? session.turns.find((turn) => turn.practiceKind === "question")?.text ?? "";
    const targetPhrase = session.practice?.targetPhrase?.trim()
      || (session.turns.find((turn) => turn.practiceKind === "question")?.keyPhrases?.[0] ?? "").trim();
    const referenceAnswer = session.practice?.referenceAnswer ?? "";
    const feedbackResult = await generatePracticeFeedback({ question, answer, targetPhrase, referenceAnswer });
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
    if (session.practice) {
      session.practice.attempt = (session.practice.attempt ?? 0) + 1;
    }
    session.practiceCompleted = true;
    if (session.kind !== "practice") {
      session.practice = undefined;
      session.practiceCompleted = undefined;
    }
    session.updatedAt = new Date().toISOString();
    this.setStatus(t("oio_chat.practice_complete"));
    await this.persistSessionSafely(session, true);
    this.renderModeState();
  }

  private isWaitingPracticeReply(session: OioChatSession): boolean {
    if (!session.practice || session.practiceCompleted) return false;
    const latestAssistant = [...session.turns].reverse().find((turn) => turn.role === "assistant");
    return latestAssistant?.practiceKind === "question";
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
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      this.usageDailyLimit = limit;
    }
    if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
      this.usageDailyUsed = used;
    }
  }

  private async syncUsageFromServer(): Promise<void> {
    try {
      const snapshot = await fetchChatUsageSnapshot();
      if (!snapshot) return;
      this.applyUsageSnapshot(snapshot.used, snapshot.limit);
      this.updateMeta();
    } catch {
      // ignore sync failures and keep current in-memory snapshot
    }
  }
}
