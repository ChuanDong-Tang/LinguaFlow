import { useEffect, useState } from "react";
import {
  type AutoCopyMode,
  type CompanionMode,
  loadAssistantPreferences,
  saveAssistantPreferences,
} from "../services/preferences/assistantPreferences";

export function useAssistantAutoCopyPreferences(): {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  companionModeByContactId: Record<string, CompanionMode>;
  isAutoCopyMenuOpen: boolean;
  openAutoCopyMenu: () => void;
  closeAutoCopyMenu: () => void;
  setAutoCopyAfterGeneration: (enabled: boolean) => void;
  setAutoCopyMode: (mode: AutoCopyMode) => void;
  setCompanionMode: (contactId: string, mode: CompanionMode) => void;
} {
  const [autoCopyAfterGeneration, setAutoCopyAfterGeneration] = useState(false);
  const [autoCopyMode, setAutoCopyMode] = useState<AutoCopyMode>("none");
  const [companionModeByContactId, setCompanionModeByContactId] = useState<Record<string, CompanionMode>>({});
  const [isAutoCopyMenuOpen, setIsAutoCopyMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapPreferences() {
      const preferences = await loadAssistantPreferences();
      if (!cancelled) {
        setAutoCopyAfterGeneration(preferences.autoCopyAfterGeneration);
        setAutoCopyMode(preferences.autoCopyMode);
        setCompanionModeByContactId(preferences.companionModeByContactId);
      }
    }
    void bootstrapPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSetAutoCopyMode(mode: AutoCopyMode): void {
    const nextAutoCopy = mode !== "none";
    setAutoCopyAfterGeneration(nextAutoCopy);
    setAutoCopyMode(mode);
    void saveAssistantPreferences({
      autoCopyAfterGeneration: nextAutoCopy,
      autoCopyMode: mode,
      companionModeByContactId,
    });
  }

  function handleSetAutoCopyAfterGeneration(enabled: boolean): void {
    setAutoCopyAfterGeneration(enabled);
    const nextMode = enabled && autoCopyMode === "none" ? "rewrite" : enabled ? autoCopyMode : "none";
    setAutoCopyMode(nextMode);
    void saveAssistantPreferences({
      autoCopyAfterGeneration: enabled,
      autoCopyMode: nextMode,
      companionModeByContactId,
    });
  }

  function handleSetCompanionMode(contactId: string, mode: CompanionMode): void {
    const next = { ...companionModeByContactId, [contactId]: mode };
    setCompanionModeByContactId(next);
    void saveAssistantPreferences({ autoCopyAfterGeneration, autoCopyMode, companionModeByContactId: next });
  }

  function openAutoCopyMenu(): void {
    setIsAutoCopyMenuOpen(true);
  }

  function closeAutoCopyMenu(): void {
    setIsAutoCopyMenuOpen(false);
  }

  return {
    autoCopyAfterGeneration,
    autoCopyMode,
    companionModeByContactId,
    isAutoCopyMenuOpen,
    openAutoCopyMenu,
    closeAutoCopyMenu,
    setAutoCopyAfterGeneration: handleSetAutoCopyAfterGeneration,
    setAutoCopyMode: handleSetAutoCopyMode,
    setCompanionMode: handleSetCompanionMode,
  };
}
