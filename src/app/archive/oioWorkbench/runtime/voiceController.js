const VOICE_STORAGE_KEY = "kokoro-tts-voice";
const DEFAULT_VOICE_ID = "af_nova";

/** 与 Kokoro 模型内置 id 一致；展示文案与参考设计对齐 */
const KOKORO_VOICE_GROUPS = [
  {
    label: "美式口音",
    voices: [
      { id: "af_heart", label: "女 · heart" },
      { id: "af_alloy", label: "女 · alloy" },
      { id: "af_aoede", label: "女 · aoede" },
      { id: "af_nova", label: "女 · nova" },
      { id: "am_echo", label: "男 · echo" },
      { id: "am_michael", label: "男 · michael" },
      { id: "am_onyx", label: "男 · onyx" },
      { id: "am_puck", label: "男 · puck" },
    ],
  },
  {
    label: "英式口音",
    voices: [
      { id: "bf_isabella", label: "女 · isabella" },
      { id: "bf_lily", label: "女 · lily" },
      { id: "bm_daniel", label: "男 · daniel" },
      { id: "bm_fable", label: "男 · fable" },
    ],
  },
];

const ALLOWED_VOICE_IDS = new Set(
  KOKORO_VOICE_GROUPS.reduce((acc, group) => {
    for (const v of group.voices) acc.push(v.id);
    return acc;
  }, []),
);

export class VoiceController {
  constructor({ voiceComboboxEl, voiceComboboxTrigger, voiceComboboxValue, voiceComboboxList }) {
    this.voiceComboboxEl = voiceComboboxEl;
    this.voiceComboboxTrigger = voiceComboboxTrigger;
    this.voiceComboboxValue = voiceComboboxValue;
    this.voiceComboboxList = voiceComboboxList;
    this.selectedVoiceId = DEFAULT_VOICE_ID;
  }

  getSelectedVoiceId() {
    return this.selectedVoiceId;
  }

  setSelectedVoiceId(id) {
    this.setVoiceUi(id);
  }

  getVoiceLabel(id) {
    for (const g of KOKORO_VOICE_GROUPS) {
      const found = g.voices.find((v) => v.id === id);
      if (found) return found.label;
    }
    for (const g of KOKORO_VOICE_GROUPS) {
      const found = g.voices.find((v) => v.id === DEFAULT_VOICE_ID);
      if (found) return found.label;
    }
    return "女 · nova";
  }

  loadStoredVoiceId() {
    try {
      const raw = localStorage.getItem(VOICE_STORAGE_KEY);
      if (raw && ALLOWED_VOICE_IDS.has(raw)) return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_VOICE_ID;
  }

  saveVoiceId(id) {
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  setVoiceUi(id) {
    this.selectedVoiceId = ALLOWED_VOICE_IDS.has(id) ? id : DEFAULT_VOICE_ID;
    if (this.voiceComboboxValue) {
      this.voiceComboboxValue.textContent = this.getVoiceLabel(this.selectedVoiceId);
    }
    this.voiceComboboxList?.querySelectorAll(".voice-option").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.dataset.voiceId === this.selectedVoiceId ? "true" : "false");
    });
  }

  openVoiceCombobox() {
    if (!this.voiceComboboxEl || !this.voiceComboboxList || !this.voiceComboboxTrigger) return;
    this.voiceComboboxEl.classList.add("is-open");
    this.voiceComboboxList.hidden = false;
    this.voiceComboboxTrigger.setAttribute("aria-expanded", "true");
  }

  closeVoiceCombobox() {
    if (!this.voiceComboboxEl || !this.voiceComboboxList || !this.voiceComboboxTrigger) return;
    this.voiceComboboxEl.classList.remove("is-open");
    this.voiceComboboxList.hidden = true;
    this.voiceComboboxTrigger.setAttribute("aria-expanded", "false");
  }

  bindGlobalDismiss() {
    document.addEventListener("click", (e) => {
      if (!this.voiceComboboxEl?.classList?.contains("is-open")) return;
      if (this.voiceComboboxEl.contains(/** @type {Node} */ (e.target))) return;
      this.closeVoiceCombobox();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!this.voiceComboboxEl?.classList?.contains("is-open")) return;
      this.closeVoiceCombobox();
      this.voiceComboboxTrigger?.focus();
    });
  }

  init() {
    if (!this.voiceComboboxList) return;
    this.selectedVoiceId = this.loadStoredVoiceId();
    this.voiceComboboxList.replaceChildren();
    for (const g of KOKORO_VOICE_GROUPS) {
      const h = document.createElement("div");
      h.className = "voice-optgroup-label";
      h.textContent = g.label;
      this.voiceComboboxList.appendChild(h);
      for (const v of g.voices) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "voice-option";
        b.setAttribute("role", "option");
        b.dataset.voiceId = v.id;
        b.textContent = v.label;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.saveVoiceId(v.id);
          this.setVoiceUi(v.id);
          this.closeVoiceCombobox();
          this.voiceComboboxTrigger?.focus();
        });
        this.voiceComboboxList.appendChild(b);
      }
    }
    this.setVoiceUi(this.selectedVoiceId);

    this.voiceComboboxTrigger?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.voiceComboboxEl?.classList?.contains("is-open")) this.closeVoiceCombobox();
      else this.openVoiceCombobox();
    });
    this.bindGlobalDismiss();
  }
}
