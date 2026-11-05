import React from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { TtsPlayButton } from "../../components/TtsPlayButton";
import { DictionaryTranslation } from "../../components/DictionaryTranslation";
import { getDictionaryTermAudio, type DictionaryLookupResult } from "../../services/api/dictionaryApi";
import { t } from "../../i18n";
import { playTtsAudio } from "../../services/tts/ttsPlayback";
import { calculateDictionaryPopoverLayout, DICTIONARY_POPOVER_WIDTH } from "./dictionaryPopoverLayout";
import { theme } from "../../theme";

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

  const layout = React.useMemo(() => calculateDictionaryPopoverLayout({
    windowWidth: window.width,
    windowHeight: window.height,
    anchor,
  }), [anchor, window.height, window.width]);
  const useExistingMessageAudio = !isShortDictionaryExpression(term) && Boolean(messageId) && textStart !== undefined && textEnd !== undefined;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[styles.card, { left: layout.left, top: layout.top }]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.term} numberOfLines={2}>{term}</Text>
          <View style={styles.headerActions}>
            {useExistingMessageAudio ? (
              <TtsPlayButton
                messageId={messageId}
                textStart={textStart}
                textEnd={textEnd}
                size={18}
                color={theme.colors.textStrong}
                style={styles.ttsButton}
              />
            ) : result?.audioUrl || canUseTts ? (
              <Pressable accessibilityLabel={t("dictionary.a11y.play_pronunciation")} style={styles.ttsButton} onPress={() => void playDictionaryAudio()} disabled={playingDictionaryAudio}>
                {playingDictionaryAudio ? <ActivityIndicator size="small" color={theme.colors.textStrong} /> : <Icon name="volume-high-outline" size={18} color={theme.colors.textStrong} />}
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} style={styles.iconButton} onPress={onClose}>
              <Icon name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={[styles.bodyScroll, { height: layout.bodyHeight }]}
          contentContainerStyle={styles.bodyContent}
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator
          persistentScrollbar
        >
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              <Text style={styles.loadingText}>{t("dictionary.loading")}</Text>
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : result ? (
            <>
              {result.phonetic ? <Text style={styles.phonetic}>{result.phonetic}</Text> : null}
              <Text style={styles.sectionLabel}>{t("dictionary.meaning_here")}</Text>
              <Text style={styles.primaryMeaning}>{result.targetMeaning}</Text>
              {result.nativeMeaning !== result.targetMeaning ? <DictionaryTranslation key={`${term}:${messageId}:${textStart}:${result.nativeMeaning}`} text={result.nativeMeaning} /> : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
    </Modal>
  );
}

function isShortDictionaryExpression(text: string): boolean {
  return text.trim().length <= 60 && text.trim().split(/\s+/u).filter(Boolean).length <= 5;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
  },
  card: {
    position: "absolute",
    width: DICTIONARY_POPOVER_WIDTH,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
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
    color: theme.colors.text,
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
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  bodyScroll: {
    marginTop: 8,
  },
  bodyContent: {
    paddingBottom: 2,
  },
  phonetic: { marginTop: 2, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  sectionLabel: { marginTop: 14, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  primaryMeaning: { marginTop: 5, color: theme.colors.text, fontSize: 15, lineHeight: 22, fontWeight: "500" },
  uiMeaning: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  exampleText: { marginTop: 5, color: theme.colors.text, fontSize: 14, lineHeight: 21, fontStyle: "italic" },
  uiExample: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12, lineHeight: 19 },
  meaningGroup: { marginTop: 14 },
  partOfSpeech: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, fontStyle: "italic", fontWeight: "600" },
  definitionRow: { marginTop: 8, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  definitionIndex: { width: 16, color: theme.colors.textMuted, fontSize: 13, lineHeight: 21 },
  definitionContent: { flex: 1 },
  errorText: {
    marginTop: 12,
    color: theme.colors.danger,
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
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  bodyText: {
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  scenarioText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  sourceText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  uiToggle: {
    marginTop: 14,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.canvas,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  uiToggleText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0,
  },
  uiContent: {
    paddingTop: 12,
  },
});
