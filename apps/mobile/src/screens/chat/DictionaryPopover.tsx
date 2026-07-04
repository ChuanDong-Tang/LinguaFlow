import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { TtsPlayButton } from "../../components/TtsPlayButton";
import type { DictionaryLookupResult } from "../../services/api/dictionaryApi";
import { t } from "../../i18n";

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
  const [uiVisible, setUiVisible] = React.useState(false);

  React.useEffect(() => {
    if (visible) setUiVisible(false);
  }, [visible, term]);

  const position = React.useMemo(() => {
    const fallbackTop = Math.max(POPOVER_MARGIN, window.height * 0.22);
    const fallbackLeft = Math.max(POPOVER_MARGIN, (window.width - POPOVER_WIDTH) / 2);
    if (!anchor) return { left: fallbackLeft, top: fallbackTop };
    const left = clamp(anchor.pageX + anchor.width / 2 - POPOVER_WIDTH / 2, POPOVER_MARGIN, window.width - POPOVER_WIDTH - POPOVER_MARGIN);
    const preferredTop = anchor.pageY + anchor.height + 10;
    const top = preferredTop + 238 < window.height
      ? preferredTop
      : Math.max(POPOVER_MARGIN, anchor.pageY - 252);
    return { left, top };
  }, [anchor, window.height, window.width]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { left: position.left, top: position.top }]} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.term} numberOfLines={2}>{term}</Text>
            <View style={styles.headerActions}>
              {canUseTts ? (
                <TtsPlayButton
                  messageId={messageId}
                  textStart={textStart}
                  textEnd={textEnd}
                  size={18}
                  color="#6A5CFF"
                  style={styles.ttsButton}
                />
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={22} color="#111111" />
              </Pressable>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#6A5CFF" />
              <Text style={styles.loadingText}>{t("dictionary.loading")}</Text>
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : result ? (
            <>
              <Text style={styles.label}>{t("dictionary.meaning_here")}</Text>
              <Text style={styles.bodyText}>{result.target.meaning}</Text>
              <Text style={styles.exampleText}>{result.target.example}</Text>
              {result.target.sourceNote ? (
                <Text style={styles.sourceText}>{result.target.sourceNote}</Text>
              ) : null}
              <Text style={styles.scenarioText}>{result.target.scenario}</Text>

              <Pressable style={styles.uiToggle} onPress={() => setUiVisible((value) => !value)}>
                <Text style={styles.uiToggleText}>{t("dictionary.view_ui_language")}</Text>
                <Ionicons name={uiVisible ? "chevron-up" : "chevron-down"} size={18} color="#111111" />
              </Pressable>
              {uiVisible ? (
                <View style={styles.uiContent}>
                  <Text style={styles.bodyText}>{result.ui.meaning}</Text>
                  <Text style={styles.exampleText}>{result.ui.example}</Text>
                  {result.ui.sourceNote ? (
                    <Text style={styles.sourceText}>{result.ui.sourceNote}</Text>
                  ) : null}
                  <Text style={styles.scenarioText}>{result.ui.scenario}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.08)",
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
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  term: {
    flex: 1,
    color: "#4E3EFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ttsButton: {
    minWidth: 32,
    minHeight: 32,
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
    backgroundColor: "#EFECFF",
    color: "#5A49F6",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  bodyText: {
    color: "#111111",
    fontSize: 14,
    lineHeight: 21,
  },
  exampleText: {
    marginTop: 7,
    color: "#4D5361",
    fontSize: 13,
    lineHeight: 20,
  },
  scenarioText: {
    marginTop: 7,
    color: "#727988",
    fontSize: 13,
    lineHeight: 20,
  },
  sourceText: {
    marginTop: 6,
    color: "#8F95A1",
    fontSize: 12,
    lineHeight: 18,
  },
  uiToggle: {
    marginTop: 14,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: "#F4F2FF",
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
