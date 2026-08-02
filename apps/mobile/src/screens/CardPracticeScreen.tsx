import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getCardPracticeQueue,
  getCardRecord,
  type CardPracticeQueueItem,
  type CardRecordDetail,
} from "../services/api/cardApi";
import { theme } from "../theme";
import { CardDetailModal } from "./CardDetailModal";

export function CardPracticeScreen({ isActive }: { isActive: boolean }) {
  const [items, setItems] = useState<CardPracticeQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CardRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [initialTab, setInitialTab] = useState<"cloze" | "dictation">("dictation");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await getCardPracticeQueue()).slice(0, 20));
    }
    catch { Alert.alert("暂时无法加载练习", "请检查网络后重试"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (isActive) void refresh(); }, [isActive, refresh]);
  async function open(item: CardPracticeQueueItem): Promise<void> {
    setInitialTab(item.initialTab);
    setDetailLoading(true);
    try { setDetail(await getCardRecord(item.record.id)); }
    catch { Alert.alert("暂时无法打开", "请稍后再试"); }
    finally { setDetailLoading(false); }
  }
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View><Text style={styles.title}>今天练一点</Text><Text style={styles.subtitle}>OIO 已经帮你挑好了内容</Text></View>
        <Pressable style={styles.calendarButton}><Ionicons name="calendar-outline" size={20} color={theme.colors.textSecondary} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={[styles.startCard, !items.length && styles.disabled]} disabled={!items.length} onPress={() => items[0] && void open(items[0])}>
          <View style={styles.startIcon}><Ionicons name="play" size={22} color={theme.colors.surface} /></View>
          <View style={styles.startBody}><Text style={styles.startTitle}>开始今天的练习</Text><Text style={styles.startSubtitle}>{items.length ? `${items.length} 条内容，按推荐顺序开始` : "暂时没有需要练习的内容"}</Text></View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.surface} />
        </Pressable>
        {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.accentStrong} /> : null}
        {!loading && items.length ? (
          <>
            <Text style={styles.sectionTitle}>需要再看看</Text>
            {items.slice(0, 3).map((item) => <PracticeRow key={item.record.id} item={item} onPress={() => void open(item)} />)}
            {items.length > 3 ? <><Text style={styles.sectionTitle}>最近的记录</Text>{items.slice(3).map((item) => <PracticeRow key={item.record.id} item={item} onPress={() => void open(item)} />)}</> : null}
          </>
        ) : null}
        {!loading && !items.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>今天已经练完了</Text><Text style={styles.emptyText}>留下新记录后，这里会自动出现适合练习的内容。</Text></View> : null}
      </ScrollView>
      <CardDetailModal detail={detail} loading={detailLoading} initialTab={initialTab} onClose={() => { setDetail(null); void refresh(); }} />
    </SafeAreaView>
  );
}

function PracticeRow({ item, onPress }: { item: CardPracticeQueueItem; onPress: () => void }) {
  const labels = { continue_cloze: "继续填空", retry: "再练一次", try_dictation: "试试听写", review: "好久没见" } as const;
  return <Pressable style={styles.row} onPress={onPress}><View style={styles.rowBody}><Text style={styles.reason}>{labels[item.reason]}</Text><Text numberOfLines={2} style={styles.preview}>{item.record.rewrittenPreview}</Text></View><Ionicons name="chevron-forward" size={19} color={theme.colors.textMuted} /></Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.canvas }, header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { color: theme.colors.text, fontSize: 22, fontWeight: "600" }, subtitle: { marginTop: 5, color: theme.colors.textSecondary, fontSize: 13 }, calendarButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, content: { paddingHorizontal: 20, paddingBottom: 32 }, startCard: { marginTop: 8, minHeight: 92, paddingHorizontal: 16, borderRadius: theme.radius.card, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center" }, disabled: { opacity: 0.55 }, startIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }, startBody: { flex: 1, marginHorizontal: 13 }, startTitle: { color: theme.colors.surface, fontSize: 17, fontWeight: "600" }, startSubtitle: { marginTop: 5, color: "rgba(255,255,255,0.78)", fontSize: 12 }, loader: { marginTop: 32 }, sectionTitle: { marginTop: 26, marginBottom: 10, color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" }, row: { minHeight: 82, marginBottom: 10, paddingHorizontal: 15, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center" }, rowBody: { flex: 1, paddingVertical: 13 }, reason: { color: theme.colors.accentStrong, fontSize: 11, fontWeight: "600" }, preview: { marginTop: 5, color: theme.colors.text, fontSize: 14, lineHeight: 20 }, empty: { marginTop: 26, padding: 28, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, alignItems: "center" }, emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "600" }, emptyText: { marginTop: 7, color: theme.colors.textMuted, fontSize: 13, lineHeight: 20, textAlign: "center" },
});
