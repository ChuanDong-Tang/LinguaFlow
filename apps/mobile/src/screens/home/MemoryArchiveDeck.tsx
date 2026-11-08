import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import type { CardRecordSummary } from "../../services/api/cardApi";
import { getLanguage } from "../../i18n";
import { memoryArchiveSet } from "./memoryArchiveSet";
import { memoryDeckPages, memoryDeckReturnPage } from "./memoryDeckPages";
import { MemoryDeckSettings } from "./MemoryDeckSettings";
import { memoryFanLayout } from "./memoryFanLayout";
import { theme } from "../../theme";
import { SketchBox, SketchPressable, pencilFillFor } from "../../components/sketch/Sketch";
import { haptic } from "../../feedback/haptics";

const labels = {
  "zh-CN": ["浏览设置", "每次显示", "每组数量", "重新排列", "这一组看完了", "下一组", "上一页", "下一页", "还没有留下回忆", "载入更多回忆"],
  "zh-TW": ["瀏覽設定", "每次顯示", "每組數量", "重新排列", "這一組看完了", "下一組", "上一頁", "下一頁", "還沒有留下回憶", "載入更多回憶"],
  "en-US": ["View settings", "Visible at once", "Cards per set", "Reshuffle", "That's this set", "Next set", "Previous page", "Next page", "No memories yet", "Load more memories"],
  "ja-JP": ["表示設定", "一度に表示", "セットの枚数", "並べ直す", "このセットはここまで", "次のセット", "前のページ", "次のページ", "思い出はまだありません", "思い出をもっと読み込む"],
};
export function MemoryArchiveDeck({ records, loading, hasMore, onLoadMore, onOpen, onThumbnailError }: {
  records: CardRecordSummary[]; loading: boolean; hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (ids: string[], first: string, handlers: { onFinished: () => void; onClosed: (lastId: string) => void }) => void;
  onThumbnailError: () => void;
}) {
  const copy = labels[getLanguage() as keyof typeof labels] ?? labels["en-US"];
  const [count, setCount] = useState(15);
  const [visible, setVisible] = useState(3);
  const [ids, setIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [round, setRound] = useState(0);
  const [width, setWidth] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const prefetchedRound = useRef<number | null>(null);
  const byId = useMemo(() => new Map(records.map(r => [r.id, r])), [records]);
  useEffect(() => {
    // Background refresh/load-more never re-deals an in-progress round.
    setIds(current => current.length ? current : memoryArchiveSet(records, count));
  }, [records, count]);
  const pages = useMemo(() => memoryDeckPages(ids, visible), [ids, visible]);
  useEffect(() => {
    // Fetch once near the end of each round without changing its dealt cards.
    // A failed request is retried in a later round, never in an automatic loop.
    if (!ids.length || page < pages.length - 1 || !hasMore || loading || prefetchedRound.current === round) return;
    prefetchedRound.current = round;
    onLoadMore();
  }, [ids.length, page, pages.length, hasMore, loading, round, onLoadMore]);
  function go(index: number) {
    const next = Math.max(0, Math.min(pages.length, index));
    setPage(next); scroller.current?.scrollTo({ x: next * width, animated: true });
  }
  // Read the whole dealt set from the tapped card; on return, land on the page of
  // the last card read, or on the next-set page after finishing the final card.
  function openSet(first: string) {
    const dealt = ids.filter(id => byId.has(id));
    const perPage = visible;
    let finished = false;
    onOpen(dealt, first, {
      onFinished: () => { finished = true; },
      onClosed: (lastId) => {
        const target = memoryDeckReturnPage(ids, perPage, lastId, finished);
        if (target !== null) go(target);
      },
    });
  }
  function restart(nextCount = count, nextVisible = visible, previous: string[] = []) {
    setCount(nextCount); setVisible(nextVisible); setIds(memoryArchiveSet(records, nextCount, previous));
    // Remount only when explicitly dealing a new round, so native scroll offset
    // and JS page state reset together, even after the final page.
    setPage(0); setRound(current => current + 1);
  }
  return <View style={styles.container}>
    <MemoryDeckSettings count={count} visible={visible} onApply={restart} />
    <View style={styles.viewport} onLayout={event => {
      const nextWidth = event.nativeEvent.layout.width;
      if (nextWidth !== width) { setWidth(nextWidth); scroller.current?.scrollTo({ x: page * nextWidth, animated: false }); }
    }}>
      {width > 0 && ids.length > 0 ? <ScrollView key={round} ref={scroller} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={event => setPage(Math.max(0, Math.min(pages.length, Math.round(event.nativeEvent.contentOffset.x / width))))}>
        {pages.map((batch, index) => <View key={index} accessibilityElementsHidden={page !== index} importantForAccessibility={page === index ? "auto" : "no-hide-descendants"} style={[styles.spread, { width }]}>
          {batch.map((id, slot) => {
            const card = byId.get(id);
            const fan = visible === 3;
            const layout = memoryFanLayout(width, 285);
            const offset = fan ? slot === 0 ? 0 : slot === 1 ? -1 : 1 : 0;
            return <Pressable key={id} disabled={!card} accessibilityRole="button" accessibilityLabel={card?.displayTitle || copy[8]}
              onPress={() => { if (card) { haptic.light(); openSet(id); } }}
              style={[styles.card, visible === 1 ? styles.single : visible === 2 ? styles.pair : styles.fan,
                fan && { width: layout.width, height: layout.height, zIndex: slot === 0 ? 3 : 1, transform: [{ translateX: offset * layout.offset }, { translateY: offset ? -28 : 24 }, { rotate: `${offset * layout.angle}deg` }] }]}>
              <SketchBox seed={id} fill={theme.colors.surface} shadow style={styles.cardSketch}>
                {card ? <><ArchiveCover card={card} onError={onThumbnailError} /><Text numberOfLines={2} style={styles.title}>{card.displayTitle || card.originalPreview}</Text><Text style={styles.date}>{card.dateKey}</Text></> : <Text style={styles.muted}>{copy[8]}</Text>}
              </SketchBox>
            </Pressable>;
          })}
          {visible === 2 && batch.length === 1 ? <View pointerEvents="none" accessible={false} style={{ width: "46%" }} /> : null}
        </View>)}
        <View accessibilityElementsHidden={page !== pages.length} importantForAccessibility={page === pages.length ? "auto" : "no-hide-descendants"} style={[styles.ending, { width }]}><SketchPressable seed="deck-next-set" radius={25} fill={theme.colors.accent} feedback="medium" accessibilityRole="button" contentStyle={styles.nextSet} onPress={() => restart(count, visible, ids)}><Text style={styles.nextSetText}>{copy[5]}</Text></SketchPressable></View>
      </ScrollView> : <View style={styles.ending}>{!loading ? <Text style={styles.muted}>{copy[8]}</Text> : null}</View>}
    </View>
    <View style={styles.navigationSlot}>{ids.length > 0 && page < pages.length ? <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy[6]} disabled={page === 0} style={[styles.button, page === 0 && styles.disabled]} onPress={() => { haptic.select(); go(page - 1); }}><Text style={styles.arrow}>‹</Text></Pressable>
      <Text style={styles.muted}>{page === pages.length ? copy[4] : `${page * visible + 1}–${Math.min((page + 1) * visible, ids.length)} / ${ids.length}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={copy[7]} disabled={page === pages.length} style={[styles.button, page === pages.length && styles.disabled]} onPress={() => { haptic.select(); go(page + 1); }}><Text style={styles.arrow}>›</Text></Pressable>
    </View> : null}</View>
    <View style={styles.statusSlot}>{loading ? <ActivityIndicator color={theme.colors.textStrong} /> : null}</View>
  </View>;
}
function ArchiveCover({ card, onError }: { card: CardRecordSummary; onError: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = card.thumbnail?.url;
  return url && failedUrl !== url
    ? <Image source={{ uri: url }} style={styles.image} resizeMode="cover" onError={() => { setFailedUrl(url); onError(); }} />
    : <View style={[styles.image, styles.textCover, { backgroundColor: pencilFillFor(card.id) }]}><Text numberOfLines={5} style={styles.title}>{card.originalPreview || card.displayTitle}</Text></View>;
}
const styles = StyleSheet.create({
  container: { width: "100%", alignItems: "center" }, header: { width: "100%", alignItems: "flex-start" },
  button: { minHeight: 44, minWidth: 44, padding: 10, justifyContent: "center", alignItems: "center" },
  nextSet: { minHeight: 50, minWidth: 148, paddingHorizontal: 28, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  nextSetPressed: { opacity: 0.7 },
  nextSetText: { color: theme.colors.onAccent, fontSize: 16, fontWeight: "700" },
  navigationSlot: { minHeight: 52, justifyContent: "center" },
  statusSlot: { height: 24, justifyContent: "center" },
  settingsTrigger: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: theme.colors.textSecondary, fontSize: 13 }, viewport: { width: "100%", height: 390 },
  spread: { height: 390, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" },
  card: {},
  cardSketch: { flex: 1, padding: 6, gap: 5 },
  single: { width: "86%", height: 340 }, pair: { width: "46%", height: 265 }, fan: { position: "absolute", width: "65%", height: 285 },
  image: { width: "100%", flex: 1, minHeight: 0, borderRadius: 7 }, textCover: { justifyContent: "center", padding: 12 },
  title: { color: theme.colors.text, fontSize: 14, lineHeight: 21 }, date: { color: theme.colors.textMuted, fontSize: 11, paddingBottom: 3 },
  navigation: { flexDirection: "row", alignItems: "center", gap: 24 }, arrow: { color: theme.colors.text, fontSize: 24 }, disabled: { opacity: 0.2 },
  ending: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 }, action: { color: theme.colors.text, fontSize: 15, fontWeight: "500" },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.12)" },
  settings: { width: 310, maxWidth: "100%", backgroundColor: theme.colors.surface, borderRadius: 12, padding: 18, gap: 18 },
  settingRow: { gap: 8 }, options: { flexDirection: "row", gap: 8 }, option: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  selected: { backgroundColor: theme.colors.surfaceMuted }, apply: { minHeight: 44, alignItems: "center", justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
});
