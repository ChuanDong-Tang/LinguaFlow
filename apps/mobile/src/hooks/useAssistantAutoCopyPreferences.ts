import { useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  type AutoCopyMode,
  loadAssistantPreferences,
  saveAssistantPreferences,
} from "../services/preferences/assistantPreferences";

function autoCopyModeLabel(mode: AutoCopyMode): string {
  if (mode === "zh") return "当前：只自动复制中文";
  if (mode === "both") return "当前：英文和中文都自动复制";
  return "当前：只自动复制英文";
}

export function useAssistantAutoCopyPreferences(): {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  openAutoCopyMenu: () => void;
} {
  const [autoCopyAfterGeneration, setAutoCopyAfterGeneration] = useState(true);
  const [autoCopyMode, setAutoCopyMode] = useState<AutoCopyMode>("en");

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

  async function handleSetAutoCopyMode(mode: AutoCopyMode): Promise<void> {
    setAutoCopyAfterGeneration(true);
    setAutoCopyMode(mode);
    await saveAssistantPreferences({ autoCopyAfterGeneration: true, autoCopyMode: mode });
  }

  function openAutoCopyMenu(): void {
    Alert.alert("自动复制", autoCopyModeLabel(autoCopyMode), [
      {
        text: "只自动复制英文",
        onPress: () => {
          void handleSetAutoCopyMode("en");
        },
      },
      {
        text: "只自动复制中文",
        onPress: () => {
          void handleSetAutoCopyMode("zh");
        },
      },
      {
        text: "两个都自动复制",
        onPress: () => {
          void handleSetAutoCopyMode("both");
        },
      },
      { text: "取消", style: "cancel" },
    ]);
  }

  return { autoCopyAfterGeneration, autoCopyMode, openAutoCopyMenu };
}
