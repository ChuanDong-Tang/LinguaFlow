import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { TtsPlayButton } from "../../components/TtsPlayButton";
import { getDictionaryTermAudio, type DictionaryLookupResult } from "../../services/api/dictionaryApi";
import { t } from "../../i18n";
import { playTtsAudio } from "../../services/tts/ttsPlayback";

export type DictionaryPopoverAnchor = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
};

type DictionaryPopoverProps = {
  visible: boolean;
  anchor?: DictionaryPopoverAnchor;
  term: string;
  loading: boolean;
  error?: string | null;
  result?: DictionaryLookupResult | null;
  messageId?: string | null;
  textStart?: number;
  textEnd?: number;
  canUseTts: boolean;
  onClose: () => void;
};

const POPOVER_WIDTH = 312;
const POPOVER_MARGIN = 12;
const POPOVER_BODY_HEIGHT = 260;
const POPOVER_ESTIMATED_HEIGHT = 340;
const BOTTOM_CHROME_HEIGHT = 96;

export function DictionaryPopover({
  visible,
  anchor,
  term,
  loading,
  error,
  result,
  messageId,
  textStart,
  textEnd,
  canUseTts,
  onClose,
}: DictionaryPopoverProps) {
  const window = useWindowDimensions();
  const [playingDictionaryAudio, setPlayingDictionaryAudio] = React.useState(false);
  const audioRequestRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    audioRequestRef.current?.abort();
    audioRequestRef.current = null;
    setPlayingDictionaryAudio(false);
  }, [visible, term]);

  React.useEffect(() => () => audioRequestRef.current?.abort(), []);

  async function playDictionaryAudio(): Promise<void> {
    if (playingDictionaryAudio) return;
    const controller = new AbortController();
    audioRequestRef.current = controller;
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 25_000);
    setPlayingDictionaryAudio(true);
    try {
      const audioUrl = result?.audioUrl || (canUseTts ? (await getDictionaryTermAudio(term, controller.signal)).audioUrl : null);
      if (audioUrl) await playTtsAudio({ url: audioUrl });
    } catch (error) {
      if (didTimeout) {
        Alert.alert(t("card_detail.error.play"), t("tts.error.failed"));
      } else if (!controller.signal.aborted) {
        Alert.alert(t("card_detail.error.play"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
      }
    } finally {
      clearTimeout(timeout);
      if (audioRequestRef.current === controller) audioRequestRef.current = null;
      setPlayingDictionaryAudio(false);
    }
  }

  const position = React.useMemo(() => {
    const maximumTop = Math.max(POPOVER_MARGIN, window.height - BOTTOM_CHROME_HEIGHT - POPOVER_ESTIMATED_HEIGHT);
    const fixedTop = clamp(window.height * 0.12, POPOVER_MARGIN, maximumTop);
    const fallbackLeft = Math.max(POPOVER_MARGIN, (window.width - POPOVER_WIDTH) / 2);
    if (!anchor) return { left: fallbackLeft, top: fixedTop };
    const left = clamp(anchor.pageX + anchor.width / 2 - POPOVER_WIDTH / 2, POPOVER_MARGIN, window.width - POPOVER_WIDTH - POPOVER_MARGIN);
    return { left, top: fixedTop };
  }, [anchor, window.height, window.width]);
  const bodyHeight = clamp(POPOVER_BODY_HEIGHT, 120, window.height - position.top - POPOVER_MARGIN - 92);
  const useExistingMessageAudio = !isShortDictionaryExpression(term) && Boolean(messageId) && textStart !== undefined && textEnd !== undefined;

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.card, { left: position.left, top: position.top }]}>
        <View style={styles.headerRow}>
          <Text style={styles.term} numberOfLines={2}>{term}</Text>
          <View style={styles.headerActions}>
            {useExistingMessageAudio ? (
              <TtsPlayButton
                messageId={messageId}
                textStart={textStart}
                textEnd={textEnd}
                size={18}
                color="#4D5361"
                style={styles.ttsButton}
              />
            ) : result?.audioUrl || canUseTts ? (
              <Pressable accessibilityLabel={t("dictionary.a11y.play_pronunciation")} style={styles.ttsButton} onPress={() => void playDictionaryAudio()} disabled={playingDictionaryAudio}>
                {playingDictionaryAudio ? <ActivityIndicator size="small" color="#4D5361" /> : <Ionicons name="volume-high-outline" size={18} color="#4D5361" />}
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={[styles.bodyScroll, { height: bodyHeight }]}
          contentContainerStyle={styles.bodyContent}
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator
          persistentScrollbar
        >
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#6F7684" />
              <Text style={styles.loadingText}>{t("dictionary.loading")}</Text>
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : result ? (
            <>
              {result.phonetic ? <Text style={styles.phonetic}>{result.phonetic}</Text> : null}
              <Text style={styles.sectionLabel}>{t("dictionary.meaning_here")}</Text>
              <Text style={styles.primaryMeaning}>{result.target.meaning}</Text>
              {result.ui.meaning !== result.target.meaning ? <Text style={styles.uiMeaning}>{result.ui.meaning}</Text> : null}

              <Text style={styles.sectionLabel}>{t("dictionary.section.example")}</Text>
              <Text style={styles.exampleText}>{result.target.example}</Text>
              {result.ui.example !== result.target.example ? <Text style={styles.uiExample}>{result.ui.example}</Text> : null}

              <Text style={styles.sectionLabel}>{t("dictionary.section.scenario")}</Text>
              <Text style={styles.bodyText}>{result.target.scenario}</Text>
              {result.ui.scenario !== result.target.scenario ? <Text style={styles.uiMeaning}>{result.ui.scenario}</Text> : null}

              {result.source?.title || result.target.sourceNote || result.ui.sourceNote ? <>
                <Text style={styles.sectionLabel}>{t("dictionary.section.source")}</Text>
                <Text style={styles.bodyText}>{result.target.sourceNote || result.source?.title}</Text>
                {result.ui.sourceNote && result.ui.sourceNote !== result.target.sourceNote ? <Text style={styles.uiMeaning}>{result.ui.sourceNote}</Text> : null}
              </> : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function isShortDictionaryExpression(text: string): boolean {
  return text.trim().length <= 60 && text.trim().split(/\s+/u).filter(Boolean).length <= 5;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 17, 17, 0.05)",
  },
  card: {
    position: "absolute",
    width: POPOVER_WIDTH,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DBDFE7",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    shadowColor: "#111111",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  term: {
    flex: 1,
    color: "#111111",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "600",
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ttsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingRow: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "#727988",
    fontSize: 13,
  },
  bodyScroll: {
    marginTop: 8,
  },
  bodyContent: {
    paddingBottom: 2,
  },
  phonetic: { marginTop: 2, color: "#727988", fontSize: 14, lineHeight: 20 },
  sectionLabel: { marginTop: 14, color: "#767D8B", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  primaryMeaning: { marginTop: 5, color: "#17191D", fontSize: 15, lineHeight: 22, fontWeight: "500" },
  uiMeaning: { marginTop: 4, color: "#686F7D", fontSize: 13, lineHeight: 20 },
  exampleText: { marginTop: 5, color: "#272B32", fontSize: 14, lineHeight: 21, fontStyle: "italic" },
  uiExample: { marginTop: 4, color: "#777E8B", fontSize: 12, lineHeight: 19 },
  meaningGroup: { marginTop: 14 },
  partOfSpeech: { color: "#5E6573", fontSize: 12, lineHeight: 18, fontStyle: "italic", fontWeight: "600" },
  definitionRow: { marginTop: 8, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  definitionIndex: { width: 16, color: "#8F95A1", fontSize: 13, lineHeight: 21 },
  definitionContent: { flex: 1 },
  errorText: {
    marginTop: 12,
    color: "#B42318",
    fontSize: 13,
    lineHeight: 20,
  },
  label: {
    alignSelf: "flex-start",
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#F1F3F7",
    color: "#5E6573",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  bodyText: {
    color: "#111111",
    fontSize: 14,
    lineHeight: 21,
  },
  scenarioText: {
    color: "#727988",
    fontSize: 13,
    lineHeight: 20,
  },
  sourceText: {
    color: "#8F95A1",
    fontSize: 12,
    lineHeight: 18,
  },
  uiToggle: {
    marginTop: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#F7F8FB",
    borderWidth: 1,
    borderColor: "#E6E9F0",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  uiToggleText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0,
  },
  uiContent: {
    paddingTop: 12,
  },
});
