import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import Reanimated, { FadeInDown, FadeOutUp, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { OioMascot } from "../../components/sketch/OioMascot";
import { coverFillFor } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { t, tf } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import type { CardRecordSummary } from "../../services/api/cardApi";
import { isBlindBoxPlayable } from "../../domain/blindBox/pickSentence";
import { memoryArchiveSet } from "./memoryArchiveSet";

export const BLIND_BOX_SET_SIZES = [15, 20, 30, 50, 100] as const;
const RISE_MS = 1800;

/**
 * 盲盒 home (2026-11, round 3): only a transition screen. Three stacked cards
 * keep rising (photos first); tapping anywhere starts the game with the card
 * on top. The set size applies to the next set.
 */
export function BlindBoxHome({ records, loading, hasMore, onLoadMore, onStart, variant = "blindBox", title }: {
  /** "history": a 历史今日 day — every card of the day, whole-card review, no set size. */
  variant?: "blindBox" | "history";
  title?: string;
  records: CardRecordSummary[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Start a set: the dealt card ids, top card first. */
  onStart: (ids: string[]) => void;
}) {
  const [count, setCount] = useState<number>(15);
  const [sizeMenu, setSizeMenu] = useState(false);
  const history = variant === "history";
  const playable = useMemo(() => records.filter((record) => record.status === "completed" && !record.isSample && (history || isBlindBoxPlayable(record.practiceSummary))), [history, records]);
  // Photos make the rising stack lively; text cards fill in after them.
  const reel = useMemo(() => [...playable.filter((record) => record.thumbnail), ...playable.filter((record) => !record.thumbnail)], [playable]);
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (reel.length < 2) return;
    const timer = setInterval(() => setTop((value) => (value + 1) % reel.length), RISE_MS);
    return () => clearInterval(timer);
  }, [reel.length]);
  // A bigger set needs more cards loaded.
  useEffect(() => { if (!history && playable.length < count && hasMore && !loading) onLoadMore(); }, [count, hasMore, history, loading, onLoadMore, playable.length]);
  const stack = reel.length ? [0, 1, 2].map((offset) => reel[(top + offset) % reel.length]!).filter((record, index, all) => all.findIndex((item) => item.id === record.id) === index) : [];

  const start = () => {
    const first = stack[0];
    if (!first) return;
    haptic.medium();
    if (history) {
      // The whole day, in order, starting from the card on top.
      const ids = playable.map((record) => record.id);
      const index = ids.indexOf(first.id);
      onStart([...ids.slice(index), ...ids.slice(0, index)]);
      return;
    }
    const rest = memoryArchiveSet(playable.filter((record) => record.id !== first.id), Math.max(0, count - 1));
    onStart([first.id, ...rest]);
  };

  return <Pressable accessibilityRole="button" accessibilityLabel={t("blind_box.start")} style={styles.page} onPress={start} disabled={!stack.length}>
    <View style={styles.topRow}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {history ? null : <Pressable accessibilityRole="button" hitSlop={8} style={styles.sizeChip} onPress={() => { haptic.select(); setSizeMenu((value) => !value); }}>
        <Text style={styles.sizeText}>{tf("blind_box.set_size", { count })}</Text>
        <Icon name="chevron-down" size={13} color={theme.colors.textSecondary} />
      </Pressable>}
    </View>
    {sizeMenu ? <View style={styles.sizeMenu}>
      {BLIND_BOX_SET_SIZES.map((size) => <Pressable key={size} accessibilityRole="radio" accessibilityState={{ checked: size === count }} style={[styles.sizeOption, size === count && styles.sizeOptionOn]} onPress={() => { haptic.select(); setCount(size); setSizeMenu(false); }}>
        <Text style={[styles.sizeOptionText, size === count && styles.sizeOptionTextOn]}>{size}</Text>
      </Pressable>)}
    </View> : null}
    <View style={styles.stage}>
      {loading && !stack.length ? <ActivityIndicator color={theme.colors.textSecondary} /> : !stack.length ? <View style={styles.empty}>
        <OioMascot size={72} />
        <Text style={styles.emptyText}>{t("blind_box.empty")}</Text>
      </View> : <View style={styles.stack}>
        {[...stack].reverse().map((record) => <StackCard key={record.id} record={record} slot={stack.findIndex((item) => item.id === record.id)} />)}
      </View>}
    </View>
    {stack.length ? <View style={styles.footer}>
      <Text style={styles.hint}>{t("blind_box.tap_to_start")}</Text>
      <Text style={styles.subHint}>{history ? tf("history_day.ready", { count: playable.length }) : tf("blind_box.ready", { count: Math.min(count, playable.length) })}</Text>
    </View> : null}
  </Pressable>;
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: theme.colors.feed },
  topRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 16, paddingTop: 6, minHeight: 38 },
  title: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  stack: { width: 300, height: 340, alignItems: "center", justifyContent: "center" },
  sizeChip: { alignSelf: "flex-end", minHeight: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 4 },
  sizeText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  sizeMenu: { position: "absolute", top: 44, right: 16, zIndex: 10, flexDirection: "row", gap: 6, padding: 6, borderRadius: 14, backgroundColor: theme.colors.surface, ...theme.shadow.menu },
  sizeOption: { minWidth: 44, minHeight: 34, borderRadius: 10, backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  sizeOptionOn: { backgroundColor: theme.colors.accent },
  sizeOptionText: { color: theme.colors.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  sizeOptionTextOn: { color: theme.colors.onAccent },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { position: "absolute", width: 200, height: 270, borderRadius: 16, overflow: "hidden", backgroundColor: theme.colors.surface, ...theme.shadow.float },
  cardImage: { width: "100%", height: "100%" },
  cardText: { flex: 1, padding: 20, justifyContent: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 27, fontWeight: "700" },
  footer: { alignItems: "center", gap: 4, paddingBottom: 120 },
  hint: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  subHint: { color: theme.colors.textMuted, fontSize: 13 },
  empty: { alignItems: "center", gap: 12, paddingHorizontal: 32 },
  emptyText: { color: theme.colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 21 },
}));

/** One card of the fanned stack: springs between slots; the front card rises away. */
function StackCard({ record, slot }: { record: CardRecordSummary; slot: number }) {
  const position = useSharedValue(slot);
  useEffect(() => { position.value = withSpring(slot, { damping: 16, stiffness: 110 }); }, [position, slot]);
  const style = useAnimatedStyle(() => {
    const p = position.value;
    // slot 0: front and centered; 1: tucked left; 2: tucked right.
    return { transform: [
      { translateX: interpolate(p, [0, 1, 2], [0, -62, 62]) },
      { translateY: interpolate(p, [0, 1, 2], [0, 14, 14]) },
      { rotate: `${interpolate(p, [0, 1, 2], [0, -8, 8])}deg` },
      { scale: interpolate(p, [0, 1, 2], [1, 0.88, 0.88]) },
    ] };
  });
  return <Reanimated.View entering={FadeInDown.duration(520)} exiting={FadeOutUp.duration(520)} style={[styles.card, { zIndex: 3 - slot }, style]}>
    {record.thumbnail
      ? <Image source={{ uri: record.thumbnail.url }} style={styles.cardImage} resizeMode="cover" />
      : <View style={[styles.cardText, { backgroundColor: coverFillFor(record.id) }]}><Text numberOfLines={5} style={styles.cardTitle}>{record.displayTitle}</Text></View>}
  </Reanimated.View>;
}
