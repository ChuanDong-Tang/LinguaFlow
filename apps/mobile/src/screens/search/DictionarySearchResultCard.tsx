import React from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getDictionaryTermAudio, type DictionaryLookupResult } from "../../services/api/dictionaryApi";
import { playTtsAudio } from "../../services/tts/ttsPlayback";
import { t } from "../../i18n";
import { theme } from "../../theme";
import { DictionaryTranslation } from "../../components/DictionaryTranslation";

type DictionarySearchResultCardProps = {
  term: string;
  loading: boolean;
  error?: string | null;
  result?: DictionaryLookupResult | null;
  targetLanguage?: string;
  visuals: Array<{ recordId: string; url: string; label: string }>;
  onOpenVisual: (recordId: string) => void;
};

export function DictionarySearchResultCard({ term, loading, error, result, targetLanguage, visuals, onOpenVisual }: DictionarySearchResultCardProps) {
  const [playing, setPlaying] = React.useState(false);
  const audioRequestRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    audioRequestRef.current?.abort();
    audioRequestRef.current = null;
    setPlaying(false);
  }, [term]);

  React.useEffect(() => () => audioRequestRef.current?.abort(), []);

  async function playPronunciation(): Promise<void> {
    if (playing || !result) return;
    const controller = new AbortController();
    audioRequestRef.current = controller;
    setPlaying(true);
    try {
      const expression = resolveTargetExpression(result, term);
      const audioUrl = result.audioUrl || (await getDictionaryTermAudio(expression, controller.signal, targetLanguage)).audioUrl;
      if (audioUrl) await playTtsAudio({ url: audioUrl });
    } catch (audioError) {
      if (!controller.signal.aborted) {
        Alert.alert(t("card_detail.error.play"), audioError instanceof Error ? audioError.message : t("tts.error.failed"));
      }
    } finally {
      if (audioRequestRef.current === controller) audioRequestRef.current = null;
      setPlaying(false);
    }
  }

  const targetExpression = result ? resolveTargetExpression(result, term) : term;
  const showSourceTerm = Boolean(result && targetExpression.toLocaleLowerCase() !== term.trim().toLocaleLowerCase());
  const isLongExpression = result?.queryType === "sentence" || targetExpression.length > 36;

  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{t("main.search.dictionary_title")}</Text>
        {showSourceTerm ? <Text style={styles.sectionHint}>{t("main.search.target_expression_hint")}</Text> : null}
      </View>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.termBlock}>
            <Text style={[styles.term, isLongExpression && styles.sentence]}>{targetExpression}</Text>
          </View>
          {result ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("dictionary.a11y.play_pronunciation")}
              disabled={playing}
              hitSlop={8}
              style={({ pressed }) => [styles.audioButton, pressed && styles.audioButtonPressed]}
              onPress={() => void playPronunciation()}
            >
              {playing ? <ActivityIndicator size="small" color="#4D5361" /> : <Ionicons name="volume-high-outline" size={20} color="#4D5361" />}
            </Pressable>
          ) : null}
        </View>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#6F7684" />
            <Text style={styles.loadingText}>{t("main.search.lookup_loading")}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={17} color={theme.colors.textMuted} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : result ? (
          <>
            {result.phonetic ? <Text style={styles.phonetic}>{result.phonetic}</Text> : null}
            {result.targetMeaning.trim().toLocaleLowerCase() !== targetExpression.trim().toLocaleLowerCase()
              ? <Text style={[styles.primaryMeaning, isLongExpression && styles.sentenceMeaning]}>{result.targetMeaning}</Text>
              : null}
            {result.nativeMeaning !== result.targetMeaning ? <DictionaryTranslation key={`${term}:${result.nativeMeaning}`} text={result.nativeMeaning} /> : null}
            {visuals.length ? <View style={styles.visualSection}>
              <Text style={styles.visualLabel}>{t("main.search.visuals_title")}</Text>
              <View style={styles.visualRow}>
                {visuals.map((visual) => <Pressable
                  key={visual.recordId}
                  accessibilityRole="button"
                  accessibilityLabel={visual.label || t("main.search.visuals_title")}
                  style={({ pressed }) => [styles.visualCard, pressed && styles.visualCardPressed]}
                  onPress={() => onOpenVisual(visual.recordId)}
                >
                  <Image source={{ uri: visual.url }} resizeMode="cover" style={styles.visualImage} />
                </Pressable>)}
              </View>
            </View> : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function resolveTargetExpression(result: DictionaryLookupResult, sourceTerm: string): string {
  const explicit = result.targetExpression?.trim();
  if (explicit) return explicit;
  if (/\p{Script=Han}/u.test(sourceTerm) && result.targetMeaning.trim()) return result.targetMeaning.trim();
  return sourceTerm;
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  sectionTitleRow: { marginBottom: 9, flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  sectionHint: { color: theme.colors.textMuted, fontSize: 11 },
  card: { paddingHorizontal: 18, paddingVertical: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E5E5E5", borderRadius: 16, backgroundColor: theme.colors.surface },
  headerRow: { minHeight: 32, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  termBlock: { flex: 1 },
  term: { color: theme.colors.text, fontSize: 21, lineHeight: 28, fontWeight: "600" },
  sentence: { fontSize: 17, lineHeight: 26, fontWeight: "500" },
  audioButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F2F3F4", alignItems: "center", justifyContent: "center" },
  audioButtonPressed: { opacity: 0.58 },
  loadingRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9 },
  loadingText: { color: theme.colors.textMuted, fontSize: 13 },
  errorRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 7 },
  errorText: { flex: 1, color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  phonetic: { marginTop: 2, marginBottom: 12, color: theme.colors.textMuted, fontSize: 13 },
  primaryMeaning: { marginTop: 8, color: theme.colors.text, fontSize: 15, lineHeight: 24, fontWeight: "400" },
  sentenceMeaning: { marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EEEEEE", color: theme.colors.textSecondary },
  visualSection: { marginTop: 16 },
  visualLabel: { marginBottom: 8, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  visualRow: { flexDirection: "row", gap: 8 },
  visualCard: { flex: 1, aspectRatio: 1.55, borderRadius: 11, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  visualCardPressed: { opacity: 0.72 },
  visualImage: { width: "100%", height: "100%" },
});
