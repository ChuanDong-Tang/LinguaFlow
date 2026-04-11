import { getAppTabs, DEFAULT_TAB_ID, isTabDisabled, type AppTabId } from "./appShellConfig";
import { getAccessRepository } from "../infrastructure/repositories";
import { getAuthService, type AuthSnapshot } from "../services/auth/authService";
import { getI18n, t, type Locale } from "../i18n/i18n";

export class AppShellController {
  private readonly root: Element | null;
  private activeTabId: AppTabId = DEFAULT_TAB_ID;
  private readonly navButtons: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly mobileMenuBtn: HTMLButtonElement | null;
  private readonly mobileTitleEl: HTMLElement | null;
  private readonly mobileOverlayEl: HTMLButtonElement | null;
  private readonly oioChatRailEl: HTMLElement | null;
  private readonly authAvatarEl: HTMLElement | null;
  private readonly authLabelEl: HTMLElement | null;
  private readonly authNoteEl: HTMLElement | null;
  private readonly authChipEl: HTMLButtonElement | null;
  private readonly authActionEl: HTMLButtonElement | null;
  private readonly authMenuEl: HTMLElement | null;
  private readonly authMenuSubscriptionEl: HTMLButtonElement | null;
  private readonly authMenuSignOutEl: HTMLButtonElement | null;
  private readonly localeButtons: HTMLButtonElement[] = [];
  private readonly dailyHeroKickerEl: HTMLElement | null;
  private readonly dailyHeroTitleEl: HTMLElement | null;
  private readonly dailyHeroCopyEl: HTMLElement | null;
  private readonly dailyCalendarTitleEl: HTMLElement | null;
  private readonly dailyCalendarNoteEl: HTMLElement | null;
  private readonly superDictHeroKickerEl: HTMLElement | null;
  private readonly superDictHeroTitleEl: HTMLElement | null;
  private readonly superDictHeroCopyEl: HTMLElement | null;
  private accessRequestId = 0;
  private authMenuOpen = false;
  private authPlanKey: "free" | "pro" | null = null;
  private authPlanUserId: string | null = null;
  private lastAuthStatus: AuthSnapshot["status"] | null = null;

  constructor({ root = document.querySelector(".oio-app") }: { root?: Element | null } = {}) {
    this.root = root;
    this.mobileMenuBtn = this.root?.querySelector<HTMLButtonElement>("#app-mobile-menu-btn") ?? null;
    this.mobileTitleEl = this.root?.querySelector<HTMLElement>("#app-mobile-title") ?? null;
    this.mobileOverlayEl = this.root?.querySelector<HTMLButtonElement>("#app-mobile-overlay") ?? null;
    this.oioChatRailEl = this.root?.querySelector<HTMLElement>("[data-oio-chat-rail]") ?? null;
    this.authAvatarEl = this.root?.querySelector<HTMLElement>("[data-auth-avatar]") ?? null;
    this.authLabelEl = this.root?.querySelector<HTMLElement>("[data-auth-label]") ?? null;
    this.authNoteEl = this.root?.querySelector<HTMLElement>("[data-auth-note]") ?? null;
    this.authChipEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-chip]") ?? null;
    this.authActionEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-action]") ?? null;
    this.authMenuEl = this.root?.querySelector<HTMLElement>("[data-auth-menu]") ?? null;
    this.authMenuSubscriptionEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-menu-subscription]") ?? null;
    this.authMenuSignOutEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-menu-signout]") ?? null;
    this.localeButtons = Array.from(this.root?.querySelectorAll<HTMLButtonElement>("[data-locale-option]") ?? []);
    this.dailyHeroKickerEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-kicker]") ?? null;
    this.dailyHeroTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-title]") ?? null;
    this.dailyHeroCopyEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-copy]") ?? null;
    this.dailyCalendarTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-calendar-title]") ?? null;
    this.dailyCalendarNoteEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-calendar-note]") ?? null;
    this.superDictHeroKickerEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-kicker]") ?? null;
    this.superDictHeroTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-title]") ?? null;
    this.superDictHeroCopyEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-copy]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root) return;

    this.navButtons.push(...this.root.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
    this.panels.push(...this.root.querySelectorAll<HTMLElement>("[data-tab-panel]"));

    if (!this.navButtons.length || !this.panels.length) return;

    this.syncDisabledTabs();
    this.applyStaticI18n();
    this.wireEvents();
    this.initLocaleSwitch();
    await this.initAuthPanel();
    const presetTab = this.root.getAttribute("data-active-tab") as AppTabId | null;
    const targetTab = presetTab && !isTabDisabled(presetTab) ? presetTab : this.activeTabId;
    this.setActiveTab(targetTab);
  }

  private wireEvents(): void {
    this.mobileMenuBtn?.addEventListener("click", () => {
      const open = !this.root?.classList.contains("is-mobile-nav-open");
      this.setMobileNavOpen(open);
    });

    this.mobileOverlayEl?.addEventListener("click", () => {
      this.setMobileNavOpen(false);
    });

    this.authActionEl?.addEventListener("click", async () => {
      const authService = getAuthService();
      const snapshot = authService.getSnapshot();
      if (snapshot.status === "signed_in") {
        await authService.signOut();
        return;
      }

      if (snapshot.status !== "disabled") {
        authService.openSignIn();
      }
    });

    this.authChipEl?.addEventListener("click", () => {
      if (this.authChipEl?.disabled) return;
      this.setAuthMenuOpen(!this.authMenuOpen);
    });

    this.authMenuSubscriptionEl?.addEventListener("click", () => {
      this.setAuthMenuOpen(false);
      document.dispatchEvent(
        new CustomEvent("app-open-subscription"),
      );
    });

    this.authMenuSignOutEl?.addEventListener("click", async () => {
      this.setAuthMenuOpen(false);
      await getAuthService().signOut();
    });

    document.addEventListener("click", (event) => {
      const target = event.target as Node | null;
      if (!this.authMenuOpen) return;
      if (!target) return;
      if (this.authMenuEl?.contains(target)) return;
      if (this.authChipEl?.contains(target)) return;
      this.setAuthMenuOpen(false);
    });

    document.addEventListener("app-request-tab-change", (event) => {
      const detail = (event as CustomEvent<{ tabId?: AppTabId }>).detail;
      const tabId = detail?.tabId;
      if (!tabId) return;
      this.setActiveTab(tabId);
      this.setMobileNavOpen(false);
    });

    for (const btn of this.navButtons) {
      btn.addEventListener("click", () => {
        const tabId = (btn.dataset.tabTarget as AppTabId | undefined) || DEFAULT_TAB_ID;
        if (isTabDisabled(tabId)) return;
        this.setActiveTab(tabId);
        this.setMobileNavOpen(false);
      });
    }
  }

  private applyStaticI18n(): void {
    if (this.authActionEl) {
      this.authActionEl.textContent = t("account.sign_in");
    }
    if (this.authMenuSubscriptionEl) {
      this.authMenuSubscriptionEl.textContent = t("account.subscription");
    }
    if (this.authMenuSignOutEl) {
      this.authMenuSignOutEl.textContent = t("account.sign_out");
    }
    if (this.dailyHeroKickerEl) {
      this.dailyHeroKickerEl.textContent = t("tab.daily_capture.title");
    }
    if (this.dailyHeroTitleEl) {
      this.dailyHeroTitleEl.textContent = t("tab.daily_capture.hero_title");
    }
    if (this.dailyHeroCopyEl) {
      this.dailyHeroCopyEl.textContent = t("tab.daily_capture.hero_description");
    }
    if (this.dailyCalendarTitleEl) {
      this.dailyCalendarTitleEl.textContent = t("tab.daily_capture.hero_calendar_title");
    }
    if (this.dailyCalendarNoteEl) {
      this.dailyCalendarNoteEl.textContent = t("tab.daily_capture.hero_calendar_note");
    }
    if (this.superDictHeroKickerEl) {
      this.superDictHeroKickerEl.textContent = t("tab.super_dict.title");
    }
    if (this.superDictHeroTitleEl) {
      this.superDictHeroTitleEl.textContent = t("tab.super_dict.title");
    }
    if (this.superDictHeroCopyEl) {
      this.superDictHeroCopyEl.textContent = t("tab.super_dict.hero_description");
    }
  }

  private initLocaleSwitch(): void {
    const i18n = getI18n();
    i18n.subscribe((locale) => {
      this.applyStaticI18n();
      this.syncLocaleButtons(locale);
      this.refreshAuthCopyFromState(getAuthService().getSnapshot());
    });

    for (const button of this.localeButtons) {
      button.addEventListener("click", () => {
        const locale = button.dataset.localeOption as Locale | undefined;
        if (!locale) return;
        i18n.setLocale(locale);
      });
    }
  }

  private syncLocaleButtons(locale: Locale): void {
    for (const button of this.localeButtons) {
      const active = button.dataset.localeOption === locale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  private setMobileNavOpen(open: boolean): void {
    this.root?.classList.toggle("is-mobile-nav-open", open);
    this.mobileMenuBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private syncDisabledTabs(): void {
    for (const btn of this.navButtons) {
      const tabId = btn.dataset.tabTarget as AppTabId | undefined;
      const disabled = !!tabId && isTabDisabled(tabId);
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      btn.classList.toggle("is-disabled", disabled);
    }
  }

  private setActiveTab(tabId: AppTabId): void {
    if (isTabDisabled(tabId)) {
      return;
    }

    this.activeTabId = tabId;
    this.root?.setAttribute("data-active-tab", tabId);
    const activeBtn = this.navButtons.find((btn) => btn.dataset.tabTarget === tabId);
    const activeLabel = activeBtn?.querySelector<HTMLElement>(".app-nav-btn-label")?.textContent?.trim()
      || getAppTabs().find((item) => item.id === tabId)?.label;
    if (activeLabel && this.mobileTitleEl) {
      this.mobileTitleEl.textContent = activeLabel;
    }

    for (const btn of this.navButtons) {
      const active = btn.dataset.tabTarget === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    }

    for (const panel of this.panels) {
      panel.hidden = panel.dataset.tabPanel !== tabId;
    }

    if (this.oioChatRailEl) {
      this.oioChatRailEl.hidden = tabId !== "oio-chat";
    }

    document.dispatchEvent(
      new CustomEvent("app-tab-change", {
        detail: { tabId },
      }),
    );
  }

  private async initAuthPanel(): Promise<void> {
    const authService = getAuthService();
    await authService.init();
    authService.subscribe((snapshot) => {
      void this.renderAuth(snapshot);
    });
  }

  private async renderAuth(snapshot: AuthSnapshot): Promise<void> {
    this.handleAuthStatusTransition(snapshot);

    if (!this.authLabelEl || !this.authNoteEl || !this.authActionEl) {
      return;
    }

    if (snapshot.status === "disabled") {
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("O", null);
      this.authLabelEl.textContent = t("account.auth_unavailable");
      this.authNoteEl.textContent = t("account.configure_keys");
      this.authActionEl.textContent = t("common.unavailable");
      this.authActionEl.disabled = true;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    this.authActionEl.disabled = snapshot.status === "loading";

    if (snapshot.status === "loading") {
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("…", null);
      this.authLabelEl.textContent = t("account.loading");
      this.authNoteEl.textContent = t("account.checking_session");
      this.authActionEl.textContent = t("common.loading");
      this.authActionEl.hidden = false;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    if (snapshot.status === "signed_out") {
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("G", null);
      this.authLabelEl.textContent = t("account.guest_mode");
      this.authNoteEl.textContent = t("account.local_only");
      this.authActionEl.textContent = t("account.sign_in");
      this.authActionEl.hidden = false;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    this.renderAvatar(snapshot.displayName.slice(0, 1).toUpperCase() || "U", snapshot.avatarUrl);
    this.authLabelEl.textContent = snapshot.displayName;
    this.authNoteEl.textContent = this.authPlanKey ? this.getPlanLabel(this.authPlanKey) : t("common.loading");
    this.authActionEl.hidden = true;
    if (this.authChipEl) {
      this.authChipEl.disabled = false;
      this.authChipEl.hidden = false;
    }
    const userId = snapshot.userId ?? null;
    if (userId && this.authPlanUserId === userId && this.authPlanKey) {
      this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
      return;
    }

    const requestId = ++this.accessRequestId;
    try {
      const access = await getAccessRepository().getViewerAccess();
      if (requestId !== this.accessRequestId) return;

      const hasPro = access.entitlements.some((item) => item.active && item.code === "pro_access");
      this.authPlanKey = hasPro ? "pro" : "free";
      this.authPlanUserId = userId;
      this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
    } catch {
      if (requestId !== this.accessRequestId) return;
      if (this.authPlanKey) {
        this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
      } else {
        this.authNoteEl.textContent = t("common.loading");
      }
    }
  }

  private handleAuthStatusTransition(snapshot: AuthSnapshot): void {
    const previous = this.lastAuthStatus;
    this.lastAuthStatus = snapshot.status;
    if (snapshot.status === "signed_in" && previous !== "signed_in") {
      document.dispatchEvent(new CustomEvent("app-auth-signed-in"));
    }
  }

  private refreshAuthCopyFromState(snapshot: AuthSnapshot): void {
    if (!this.authLabelEl || !this.authNoteEl || !this.authActionEl) return;

    if (snapshot.status === "disabled") {
      this.authLabelEl.textContent = t("account.auth_unavailable");
      this.authNoteEl.textContent = t("account.configure_keys");
      this.authActionEl.textContent = t("common.unavailable");
      return;
    }

    if (snapshot.status === "loading") {
      this.authLabelEl.textContent = t("account.loading");
      this.authNoteEl.textContent = t("account.checking_session");
      this.authActionEl.textContent = t("common.loading");
      return;
    }

    if (snapshot.status === "signed_out") {
      this.authLabelEl.textContent = t("account.guest_mode");
      this.authNoteEl.textContent = t("account.local_only");
      this.authActionEl.textContent = t("account.sign_in");
      return;
    }

    this.authLabelEl.textContent = snapshot.displayName;
    this.authNoteEl.textContent = this.authPlanKey ? this.getPlanLabel(this.authPlanKey) : t("common.loading");
  }

  private getPlanLabel(plan: "free" | "pro"): string {
    return plan === "pro" ? t("subscription.pro_name") : t("subscription.free_name");
  }

  private setAuthMenuOpen(open: boolean): void {
    this.authMenuOpen = open;
    if (this.authMenuEl) {
      this.authMenuEl.hidden = !open;
    }
    if (this.authChipEl) {
      this.authChipEl.setAttribute("aria-expanded", open ? "true" : "false");
      this.authChipEl.classList.toggle("is-open", open);
    }
  }

  private renderAvatar(fallback: string, avatarUrl: string | null): void {
    if (!this.authAvatarEl) return;
    if (avatarUrl) {
      this.authAvatarEl.innerHTML = `<img src="${avatarUrl}" alt="" class="app-account-avatar-image" />`;
      return;
    }

    this.authAvatarEl.textContent = fallback;
  }
}
