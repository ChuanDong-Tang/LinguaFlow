import { DEFAULT_TAB_ID, isTabDisabled, type AppTabId } from "./appShellConfig";

export class AppShellController {
  private readonly root: Element | null;
  private activeTabId: AppTabId = DEFAULT_TAB_ID;
  private readonly navButtons: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly mobileMenuBtn: HTMLButtonElement | null;
  private readonly mobileTitleEl: HTMLElement | null;
  private readonly mobileOverlayEl: HTMLButtonElement | null;

  constructor({ root = document.querySelector(".oio-app") }: { root?: Element | null } = {}) {
    this.root = root;
    this.mobileMenuBtn = this.root?.querySelector<HTMLButtonElement>("#app-mobile-menu-btn") ?? null;
    this.mobileTitleEl = this.root?.querySelector<HTMLElement>("#app-mobile-title") ?? null;
    this.mobileOverlayEl = this.root?.querySelector<HTMLButtonElement>("#app-mobile-overlay") ?? null;
  }

  init(): void {
    if (!this.root) return;

    this.navButtons.push(...this.root.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
    this.panels.push(...this.root.querySelectorAll<HTMLElement>("[data-tab-panel]"));

    if (!this.navButtons.length || !this.panels.length) return;

    this.syncDisabledTabs();
    this.wireEvents();
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

    for (const btn of this.navButtons) {
      btn.addEventListener("click", () => {
        const tabId = (btn.dataset.tabTarget as AppTabId | undefined) || DEFAULT_TAB_ID;
        if (isTabDisabled(tabId)) return;
        this.setActiveTab(tabId);
        this.setMobileNavOpen(false);
      });
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
    const activeLabel = activeBtn?.querySelector<HTMLElement>(".app-nav-btn-label")?.textContent?.trim();
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
  }
}
