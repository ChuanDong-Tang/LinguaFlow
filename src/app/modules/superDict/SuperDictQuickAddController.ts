import { normalizeLookupQuery } from "./superDictLinks";

const QUICK_ADD_EVENT = "super-dict-quick-add";

function isInteractiveNode(node: Node | null): boolean {
  if (!(node instanceof Element)) return false;
  return !!node.closest("input, textarea, [contenteditable='true'], [data-super-dict-quick-add-ignore]");
}

export class SuperDictQuickAddController {
  private buttonEl: HTMLButtonElement | null = null;
  private selectedText = "";

  init(): void {
    this.ensureButton();
    document.addEventListener("selectionchange", () => {
      this.refreshFromSelection();
    });
    document.addEventListener("mousedown", (event) => {
      const target = event.target as Node | null;
      if (target && this.buttonEl?.contains(target)) return;
      this.hideButton();
    });
  }

  private ensureButton(): void {
    if (this.buttonEl) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "super-dict-quick-add-fab";
    button.hidden = true;
    button.setAttribute("aria-label", "Add to Super Dict");
    button.title = "Add to Super Dict";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" class="super-dict-quick-add-icon" aria-hidden="true">
        <path d="M4 5.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 18 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 4 18.5v-13Zm2.5-.5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-9Zm13 2a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 1 1 0-2h2V8a1 1 0 0 1 1-1Z" fill="currentColor"></path>
      </svg>
    `;
    button.addEventListener("click", () => {
      const query = normalizeLookupQuery(this.selectedText);
      if (!query) return;
      document.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { detail: { query } }));
      document.dispatchEvent(new CustomEvent("app-request-tab-change", { detail: { tabId: "super-dict" } }));
      this.hideButton();
      window.getSelection()?.removeAllRanges();
    });
    document.body.appendChild(button);
    this.buttonEl = button;
  }

  private refreshFromSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.hideButton();
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (isInteractiveNode(anchorNode) || isInteractiveNode(focusNode)) {
      this.hideButton();
      return;
    }
    const text = normalizeLookupQuery(selection.toString() ?? "");
    if (!text) {
      this.hideButton();
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) {
      this.hideButton();
      return;
    }
    this.selectedText = text;
    this.showButton(rect);
  }

  private showButton(rect: DOMRect): void {
    if (!this.buttonEl) return;
    const left = Math.max(8, Math.min(window.innerWidth - 52, rect.right + window.scrollX + 8));
    const top = Math.max(8, rect.bottom + window.scrollY + 8);
    this.buttonEl.style.left = `${left}px`;
    this.buttonEl.style.top = `${top}px`;
    this.buttonEl.hidden = false;
  }

  private hideButton(): void {
    if (!this.buttonEl) return;
    this.buttonEl.hidden = true;
  }
}

export { QUICK_ADD_EVENT };
