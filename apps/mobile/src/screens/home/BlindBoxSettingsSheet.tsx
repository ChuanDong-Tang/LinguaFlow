import React from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Text } from "../../components/Typography";
import { CheckMark } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { BLIND_BOX_TONES, type BlindBoxTone } from "../../domain/blindBox/pickSentence";
import { BLIND_BOX_SET_SIZES, setBlindBoxSettings, useBlindBoxSettings } from "../../services/practice/blindBoxSettings";

const TONE_LABEL: Record<BlindBoxTone, string> = {
  unanswered: "blind_box.settings.tone_unanswered",
  incorrect: "blind_box.settings.tone_incorrect",
  correct: "blind_box.settings.tone_correct",
};

/** 盲盒设置 (2026-11 round 4): set size, and which blanks the sentence must hold. */
export function BlindBoxSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const settings = useBlindBoxSettings();
  const toggleTone = (tone: BlindBoxTone) => {
    const has = settings.tones.includes(tone);
    const tones = has ? settings.tones.filter((item) => item !== tone) : [...settings.tones, tone];
    if (!tones.length) { haptic.warning(); return; }
    haptic.select();
    setBlindBoxSettings({ tones });
  };
  // Own SafeAreaProvider: the sheet must clear the Android gesture bar / iOS home indicator.
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <SafeAreaProvider><Pressable style={styles.backdrop} onPress={onClose}>
      <SafeAreaView edges={["bottom"]} style={styles.sheetArea}><Pressable style={styles.sheet} onPress={() => undefined}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t("blind_box.settings.title")}</Text>
        <View style={styles.section}>
          <Text style={styles.label}>{t("blind_box.settings.set_size")}</Text>
          <View style={styles.chips}>
            {BLIND_BOX_SET_SIZES.map((size) => {
              const on = settings.setSize === size;
              return <Pressable key={size} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.chip, on && styles.chipOn]} onPress={() => { haptic.select(); setBlindBoxSettings({ setSize: size }); }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{size}</Text>
              </Pressable>;
            })}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>{t("blind_box.settings.tones")}</Text>
          <Text style={styles.caption}>{t("blind_box.settings.tones_caption")}</Text>
          {BLIND_BOX_TONES.map((tone) => {
            const on = settings.tones.includes(tone);
            return <Pressable key={tone} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.toneRow} onPress={() => toggleTone(tone)}>
              <View style={[styles.toneDot, { backgroundColor: tone === "correct" ? theme.colors.accent : tone === "incorrect" ? theme.colors.warning : theme.colors.fill3 }]} />
              <Text style={styles.toneText}>{t(TONE_LABEL[tone] as "blind_box.settings.tone_unanswered")}</Text>
              {on ? <CheckMark size={18} /> : <View style={styles.unchecked} />}
            </Pressable>;
          })}
        </View>
      </Pressable></SafeAreaView>
    </Pressable></SafeAreaProvider>
  </Modal>;
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: theme.colors.scrim },
  sheetArea: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheet: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 16 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.fill3 },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  section: { gap: 8 },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "600" },
  caption: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: -4 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, minHeight: 40, paddingHorizontal: 14, borderRadius: 18, backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chipTextOn: { color: theme.colors.onAccent },
  toneRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  toneDot: { width: 12, height: 12, borderRadius: 6 },
  toneText: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  unchecked: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: theme.colors.borderStrong },
}));
