import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { OioMascot } from "../../components/sketch/OioMascot";
import { coverFillFor } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { t, tf } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import type { CardRecordSummary } from "../../services/api/cardApi";
import { blindBoxCapacity, buildBlindBoxSet, isBlindBoxPlayable } from "../../domain/blindBox/pickSentence";
import { useBlindBoxSettings } from "../../services/practice/blindBoxSettings";
import { motion } from "../../motion";
import { BlindBoxSettingsSheet } from "./BlindBoxSettingsSheet";

/**
 * 盲盒 home (2026-11, round 4): a calm entry screen. Three cards float in once
 * and then stay still (round 3's endlessly rising stack was too busy); tap a
 * card to start with it, or anywhere else to start with the middle one.
 * 盲盒设置 (top right) holds the set size and the sentence filter.
 */
export function BlindBoxHome({ records, loading, hasMore, onLoadMore, onStart, variant = "blindBox", title }: {
  /** "history": a 历史今日 day — every card of the day, whole-card review, no settings. */
  variant?: "blindBox" | "history";
  title?: string;
  records: CardRecordSummary[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Start a set: the dealt card ids, top card first. */
  onStart: (ids: string[]) => void;
}) {
  const settings = useBlindBoxSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const history = variant === "history";
  const count = settings.setSize;
  // Every card with blanks can play: the chosen blanks (未填 / 填错 by default) come
  // first, the rest only fill a short set (round 4).
  const playable = useMemo(() => records.filter((record) => record.status === "completed" && !record.isSample && (history || isBlindBoxPlayable(record.practiceSummary))), [history, records]);
  const capacityOf = useCallback((record: CardRecordSummary) => blindBoxCapacity(record.practiceSummary, settings.tones), [settings.tones]);
  // A bigger set needs more cards loaded.
  useEffect(() => { if (!history && playable.length < count && hasMore && !loading) onLoadMore(); }, [count, hasMore, history, loading, onLoadMore, playable.length]);
  // Three cards dealt once per visit (photos first); re-dealt only when they stop qualifying.
  const [dealtIds, setDealtIds] = useState<string[]>([]);
  useEffect(() => {
    const ids = new Set(playable.map((record) => record.id));
    // Nothing to deal (still loading / filtered out): only clear once, or this loops.
    if (!playable.length) { if (dealtIds.length) setDealtIds([]); return; }
    if (dealtIds.length && dealtIds.every((id) => ids.has(id)) && (dealtIds.length >= 3 || playable.length <= dealtIds.length)) return;
    const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
    // Cards with the chosen blanks first, photos before text.
    const rank = (record: CardRecordSummary) => (capacityOf(record).preferred > 0 ? 0 : 2) + (record.thumbnail ? 0 : 1);
    setDealtIds(shuffle(playable).sort((a, b) => rank(a) - rank(b)).slice(0, 3).map((record) => record.id));
  }, [capacityOf, dealtIds, playable]);
  const dealt = dealtIds.map((id) => playable.find((record) => record.id === id)).filter((record): record is CardRecordSummary => Boolean(record));
  // Middle card is the one on top.
  const stack = dealt.length === 3 ? [dealt[1]!, dealt[0]!, dealt[2]!] : dealt;

  const start = (first: CardRecordSummary | undefined = stack[0]) => {
    if (!first) return;
    haptic.medium();
    if (history) {
      // The whole day, in order, starting from the tapped card.
      const ids = playable.map((record) => record.id);
      const index = ids.indexOf(first.id);
      onStart([...ids.slice(index), ...ids.slice(0, index)]);
      return;
    }
    // Distinct cards first; a card repeats (another sentence) only to fill a short set.
    onStart(buildBlindBoxSet(playable.map((record) => ({ id: record.id, ...capacityOf(record) })), first.id, count));
  };

  return <Pressable accessibilityRole="button" accessibilityLabel={t("blind_box.start")} style={styles.page} onPress={() => start()} disabled={!stack.length}>
    <View style={styles.topRow}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {history ? null : <Pressable accessibilityRole="button" hitSlop={8} style={styles.sizeChip} onPress={() => { haptic.light(); setSettingsOpen(true); }}>
        <Icon name="settings-outline" size={14} color={theme.colors.textSecondary} />
        <Text style={styles.sizeText}>{t("blind_box.settings.title")}</Text>
      </Pressable>}
    </View>
    <View style={styles.stage}>
      {loading && !stack.length ? <ActivityIndicator color={theme.colors.textSecondary} /> : !stack.length ? <View style={styles.empty}>
        <OioMascot size={72} />
        <Text style={styles.emptyText}>{t("blind_box.empty")}</Text>
      </View> : <View style={styles.stack}>
        {[...stack].reverse().map((record) => {
          const slot = stack.indexOf(record);
          return <StackCard key={record.id} record={record} slot={slot} order={slot === 0 ? 2 : slot - 1} onPress={() => start(record)} />;
        })}
      </View>}
    </View>
    {stack.length ? <View style={styles.footer}>
      <Text style={styles.hint}>{t("blind_box.tap_to_start")}</Text>
      <Text style={styles.subHint}>{history ? tf("history_day.ready", { count: playable.length }) : tf("blind_box.ready", { count: Math.min(count, playable.reduce((sum, record) => { const capacity = capacityOf(record); return sum + capacity.preferred + capacity.extra; }, 0)) })}</Text>
    </View> : null}
    {history ? null : <BlindBoxSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />}
  </Pressable>;
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: theme.colors.feed },
  topRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 16, paddingTop: 6, minHeight: 38 },
  title: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  stack: { width: 300, height: 340, alignItems: "center", justifyContent: "center" },
  sizeChip: { alignSelf: "flex-end", minHeight: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 5 },
  sizeText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardSlot: { position: "absolute", width: 200, height: 270 },
  card: { width: 200, height: 270, borderRadius: 16, overflow: "hidden", backgroundColor: theme.colors.surface, ...theme.shadow.float },
  cardImage: { width: "100%", height: "100%" },
  cardText: { flex: 1, padding: 20, justifyContent: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 27, fontWeight: "700" },
  footer: { alignItems: "center", gap: 4, paddingBottom: 120 },
  hint: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  subHint: { color: theme.colors.textMuted, fontSize: 13 },
  empty: { alignItems: "center", gap: 12, paddingHorizontal: 32 },
  emptyText: { color: theme.colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 21 },
}));

const SLOTS = [
  { x: 0, y: 0, rotate: 0, scale: 1 },
  { x: -66, y: 16, rotate: -8, scale: 0.88 },
  { x: 66, y: 16, rotate: 8, scale: 0.88 },
];

/** One card of the fanned stack: floats in once (side cards first), then stays put. */
function StackCard({ record, slot, order, onPress }: { record: CardRecordSummary; slot: number; order: number; onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  const place = SLOTS[slot] ?? SLOTS[0]!;
  const enter = reduceMotion ? FadeIn.duration(motion.duration.quick) : FadeInDown.duration(motion.duration.enter).delay(order * 110).withInitialValues({ opacity: 0, transform: [{ translateY: 28 }] });
  return <Reanimated.View entering={enter} style={[styles.cardSlot, { zIndex: 3 - slot }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={record.displayTitle} onPress={onPress} style={({ pressed }) => [styles.card, { transform: [{ translateX: place.x }, { translateY: place.y }, { rotate: `${place.rotate}deg` }, { scale: place.scale * (pressed ? 0.97 : 1) }] }, pressed && { opacity: 0.88 }]}>
      {record.thumbnail
        ? <Image source={{ uri: record.thumbnail.url }} style={styles.cardImage} resizeMode="cover" />
        : <View style={[styles.cardText, { backgroundColor: coverFillFor(record.id) }]}><Text numberOfLines={5} style={styles.cardTitle}>{record.displayTitle}</Text></View>}
    </Pressable>
  </Reanimated.View>;
}
