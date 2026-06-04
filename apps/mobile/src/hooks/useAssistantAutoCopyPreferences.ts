import { useEffect, useState } from "react";
import {
  type AutoCopyMode,
  loadAssistantPreferences,
  saveAssistantPreferences,
} from "../services/preferences/assistantPreferences";

export function useAssistantAutoCopyPreferences(): {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  isAutoCopyMenuOpen: boolean;
  openAutoCopyMenu: () => void;
  closeAutoCopyMenu: () => void;
  setAutoCopyMode: (mode: AutoCopyMode) => void;
} {
  const [autoCopyAfterGeneration, setAutoCopyAfterGeneration] = useState(true);
  const [autoCopyMode, setAutoCopyMode] = useState<AutoCopyMode>("en");
  const [isAutoCopyMenuOpen, setIsAutoCopyMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapPreferences() {
      const preferences = await loadAssistantPreferences();
      if (!cancelled) {
        setAutoCopyAfterGeneration(preferences.autoCopyAfterGeneration);
        setAutoCopyMode(preferences.autoCopyMode);
      }
    }
    void bootstrapPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSetAutoCopyMode(mode: AutoCopyMode): void {
    setAutoCopyAfterGeneration(true);
    setAutoCopyMode(mode);
    setIsAutoCopyMenuOpen(false);
    void saveAssistantPreferences({ autoCopyAfterGeneration: true, autoCopyMode: mode });
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
    isAutoCopyMenuOpen,
    openAutoCopyMenu,
    closeAutoCopyMenu,
    setAutoCopyMode: handleSetAutoCopyMode,
  };
}
