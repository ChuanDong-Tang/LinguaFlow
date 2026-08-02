import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Line, Polygon, Text as SvgText } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createRecallSession,
  expandRecallNode,
  finishRecallSession,
  getActiveRecallSession,
  getCardCollections,
  getCardRecord,
  getRecallSeedCandidates,
  searchRecallCards,
  updateRecallNode,
  type RecallCandidate,
  type RecallSession,
} from "../services/api/cardApi";
import { theme } from "../theme";

type TimeRange = "" | "recent" | "this_year" | "last_year" | "earlier";

export function RecallScreen({
  isActive,
  onOpenCard,
  onOpenLibrary,
}: {
  isActive: boolean;
  onOpenCard: (recordId: string) => void;
  onOpenLibrary: () => void;
}) {
  const { width } = useWindowDimensions();
  const [active, setActive] = useState<RecallSession | null>(null);
  const [session, setSession] = useState<RecallSession | null>(null);
  const [candidates, setCandidates] = useState<RecallCandidate[]>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("");
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const loadHome = useCallback(async (shuffle = false) => {
    setLoading(true);
    try {
      const [activeSession, rows, collectionResult] = await Promise.all([
        getActiveRecallSession(),
        getRecallSeedCandidates(shuffle ? "shuffle" : "recommended"),
        getCardCollections(),
      ]);
      setActive(activeSession);
      setCandidates(shuffle ? [...rows].reverse() : rows.slice(0, 6));
      setCollections(collectionResult.collections);
    } catch { Alert.alert("暂时无法加载回忆", "请稍后重试"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isActive && !session) void loadHome(); }, [isActive, session, loadHome]);

  async function search(): Promise<void> {
    setLoading(true);
    try {
      setCandidates(await searchRecallCards({
        q: query.trim() || undefined,
        collectionId: collectionId || undefined,
        timeRange: timeRange || undefined,
      }));
    } catch { Alert.alert("搜索失败", "请稍后重试"); }
    finally { setLoading(false); }
  }

  async function begin(candidate: RecallCandidate): Promise<void> {
    setLoading(true);
    try {
      const created = await createRecallSession(
        candidate.recordId,
        query || collectionId || timeRange ? "search" : "recommended",
        collectionId || timeRange ? { ...(collectionId ? { collectionId } : {}), ...(timeRange ? { timeRange } : {}) } : undefined,
      );
      setSession(created);
      setSelectedNodeId(created.nodes[0]?.id ?? null);
      setTitles({ [candidate.recordId]: candidate.originalText });
      void hydrateTitles(created);
    } catch { Alert.alert("无法开始探索", "请稍后重试"); }
    finally { setLoading(false); }
  }

  async function hydrateTitles(value: RecallSession): Promise<void> {
    const pairs = await Promise.all(value.nodes.map(async (node) => {
      try {
        const card = await getCardRecord(node.recordId);
        return [node.recordId, card?.originalText || "已失效记录"] as const;
      } catch { return [node.recordId, "已失效 Card"] as const; }
    }));
    setTitles((current) => ({ ...current, ...Object.fromEntries(pairs) }));
  }

  async function resume(): Promise<void> {
    if (!active) return;
    setSession(active);
    setSelectedNodeId(active.nodes.find((node) => node.state === "current")?.id ?? active.nodes[0]?.id ?? null);
    void hydrateTitles(active);
  }

  async function selectNode(nodeId: string): Promise<void> {
    if (!session) return;
    setSelectedNodeId(nodeId);
    try {
      const next = await updateRecallNode(session.id, nodeId, "current");
      setSession(next);
    } catch {}
  }

  async function expandSelected(): Promise<void> {
    if (!session || !selectedNodeId) return;
    setLoading(true);
    try {
      const next = await expandRecallNode(session.id, selectedNodeId);
      setSession(next);
      void hydrateTitles(next);
    } catch { Alert.alert("暂时无法展开", "这张 Card 的联系稍后再试"); }
    finally { setLoading(false); }
  }

  async function openSelected(): Promise<void> {
    const node = session?.nodes.find((item) => item.id === selectedNodeId);
    if (!node) return;
    onOpenCard(node.recordId);
  }

  async function finish(): Promise<void> {
    if (!session) return;
    try {
      await finishRecallSession(session.id);
      setSession(null); setActive(null); setSelectedNodeId(null);
      await loadHome();
    } catch { Alert.alert("无法结束探索", "请稍后重试"); }
  }

  if (session) return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>回忆蓝图</Text><Text style={styles.title}>{session.nodes.length} / 12 个节点</Text></View><Pressable style={styles.finishButton} onPress={() => void finish()}><Text style={styles.finishText}>结束</Text></Pressable></View>
      <Blueprint session={session} titles={titles} selectedNodeId={selectedNodeId} width={width} onSelect={(id) => void selectNode(id)} />
      <View style={styles.legend}><Text style={styles.legendText}>┄ 内容相近</Text><Text style={styles.legendPhrase}>━ 相同表达</Text><Text style={styles.legendProgress}>➜ 表达成长</Text></View>
      <View style={styles.nodeActions}>
        <Pressable style={styles.secondaryButton} onPress={() => void openSelected()}><Ionicons name="document-text-outline" size={19} color={theme.colors.accentStrong} /><Text style={styles.secondaryText}>查看 Card</Text></Pressable>
        <Pressable style={styles.primaryButton} disabled={loading} onPress={() => void expandSelected()}>{loading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="git-network-outline" size={19} color="#fff" /><Text style={styles.primaryText}>展开真实联系</Text></>}</Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回生活" style={styles.menuButton} onPress={onOpenLibrary}><Ionicons name="chevron-back" size={27} color={theme.colors.text} /></Pressable>
        <View style={styles.headerTitle}><Text style={styles.eyebrow}>生活会在不经意间互相照亮</Text><Text style={styles.title}>回忆</Text></View>
        <Pressable accessibilityLabel="换一组" style={styles.shuffleButton} onPress={() => void loadHome(true)}><Ionicons name="shuffle" size={21} color={theme.colors.accentStrong} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.homeContent} keyboardShouldPersistTaps="handled">
        {active ? <Pressable style={styles.resumeCard} onPress={() => void resume()}><View><Text style={styles.resumeLabel}>继续上次探索</Text><Text style={styles.resumeMeta}>{active.nodes.length} 个节点 · {active.edges.length} 条真实联系</Text></View><Ionicons name="arrow-forward-circle" size={30} color={theme.colors.accentStrong} /></Pressable> : null}
        <View style={styles.searchRow}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="搜索生活片段或表达" placeholderTextColor={theme.colors.textMuted} style={styles.searchInput} /><Pressable style={styles.searchButton} onPress={() => void search()}><Ionicons name="search" size={19} color="#fff" /></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <FilterChip label="全部 Collection" selected={!collectionId} onPress={() => setCollectionId("")} />
          <FilterChip label="未分类" selected={collectionId === "unclassified"} onPress={() => setCollectionId("unclassified")} />
          {collections.map((item) => <FilterChip key={item.id} label={item.name} selected={collectionId === item.id} onPress={() => setCollectionId(item.id)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {([['', '全部时间'], ['recent', '近 90 天'], ['this_year', '今年'], ['last_year', '去年'], ['earlier', '更早']] as Array<[TimeRange, string]>).map(([value, label]) => <FilterChip key={value} label={label} selected={timeRange === value} onPress={() => setTimeRange(value)} />)}
        </ScrollView>
        <Text style={styles.sectionTitle}>选择一张 seed Card</Text>
        {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.accentStrong} /> : candidates.map((candidate) => (
          <View key={candidate.recordId} style={styles.candidateCard}>
            <Text numberOfLines={3} style={styles.candidatePrimary}>{candidate.originalText}</Text>
            <Text numberOfLines={2} style={styles.candidateRewrite}>{candidate.rewrittenText}</Text>
            <Pressable style={styles.seedButton} onPress={() => void begin(candidate)}><Text style={styles.seedText}>从这里开始</Text><Ionicons name="arrow-forward" size={17} color="#fff" /></Pressable>
          </View>
        ))}
        {!loading && !candidates.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>没有找到 Card</Text><Text style={styles.emptyText}>换个关键词或筛选条件试试</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Blueprint({ session, titles, selectedNodeId, width, onSelect }: { session: RecallSession; titles: Record<string, string>; selectedNodeId: string | null; width: number; onSelect: (id: string) => void }) {
  const canvasWidth = Math.max(320, width);
  const height = 470;
  const center = { x: canvasWidth / 2, y: height / 2 };
  const positions = useMemo(() => new Map(session.nodes.map((node, index) => {
    if (index === 0) return [node.id, center] as const;
    const ring = index <= 6 ? 1 : 2;
    const ringIndex = ring === 1 ? index - 1 : index - 7;
    const count = ring === 1 ? Math.min(6, Math.max(1, session.nodes.length - 1)) : Math.max(1, session.nodes.length - 7);
    const angle = -Math.PI / 2 + ringIndex * Math.PI * 2 / count;
    const radius = ring === 1 ? Math.min(145, canvasWidth * .32) : Math.min(205, canvasWidth * .43);
    return [node.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }] as const;
  })), [session.nodes, canvasWidth]);
  return <View style={styles.blueprint}>
    <Svg width={canvasWidth} height={height} style={StyleSheet.absoluteFill}>
      {session.edges.map((edge) => {
        const from = positions.get(edge.fromNodeId); const to = positions.get(edge.toNodeId); if (!from || !to) return null;
        const color = edge.relationType === "topic" ? "#8B9498" : edge.relationType === "phrase" ? "#4C86B6" : "#C58B20";
        const phrase = edge.relationType === "phrase" ? edge.reasons.find((reason) => reason.type === "phrase") : null;
        return <React.Fragment key={edge.id}><Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={edge.relationType === "topic" ? 1.5 : 2.5} strokeDasharray={edge.relationType === "topic" ? "6 6" : undefined} />{edge.relationType === "progress" ? <Polygon points={`${to.x},${to.y} ${to.x - 9},${to.y - 5} ${to.x - 9},${to.y + 5}`} fill={color} /> : null}{phrase && "phrase" in phrase ? <SvgText x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} fontSize="10" fill={color} textAnchor="middle">{phrase.phrase.slice(0, 12)}</SvgText> : null}</React.Fragment>;
      })}
    </Svg>
    {session.nodes.map((node, index) => { const point = positions.get(node.id)!; const selected = node.id === selectedNodeId; return <Pressable key={node.id} accessibilityLabel={`Card 节点 ${titles[node.recordId] ?? index + 1}`} style={[styles.node, index === 0 && styles.seedNode, selected && styles.nodeSelected, { left: point.x - 43, top: point.y - 43 }]} onPress={() => onSelect(node.id)}><Text numberOfLines={3} style={[styles.nodeText, selected && styles.nodeTextSelected]}>{titles[node.recordId] || `Card ${index + 1}`}</Text></Pressable>; })}
  </View>;
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable style={[styles.filterChip, selected && styles.filterChipSelected]} onPress={onPress}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.canvas }, header: { minHeight: 82, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, menuButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { flex: 1, paddingHorizontal: 8 }, eyebrow: { color: theme.colors.textMuted, fontSize: 12 }, title: { color: theme.colors.text, fontSize: 28, fontWeight: "800" }, shuffleButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, finishButton: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, finishText: { color: theme.colors.danger, fontSize: 14, fontWeight: "600" }, homeContent: { padding: 20, paddingTop: 6, paddingBottom: 110 }, resumeCard: { marginBottom: 16, padding: 17, borderRadius: theme.radius.card, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, resumeLabel: { color: theme.colors.text, fontSize: 16, fontWeight: "700" }, resumeMeta: { marginTop: 5, color: theme.colors.textSecondary, fontSize: 12 }, searchRow: { flexDirection: "row", gap: 8 }, searchInput: { flex: 1, height: 46, paddingHorizontal: 14, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, color: theme.colors.text }, searchButton: { width: 46, height: 46, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" }, filters: { paddingVertical: 10, gap: 8 }, filterChip: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, filterChipSelected: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentStrong }, filterText: { color: theme.colors.textSecondary, fontSize: 12 }, filterTextSelected: { color: theme.colors.accentStrong, fontWeight: "600" }, sectionTitle: { marginTop: 12, marginBottom: 10, color: theme.colors.text, fontSize: 17, fontWeight: "700" }, loader: { marginVertical: 32 }, candidateCard: { marginBottom: 12, padding: 16, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }, candidatePrimary: { color: theme.colors.text, fontSize: 16, lineHeight: 24 }, candidateOriginal: { marginTop: 9, color: theme.colors.text, fontSize: 14, lineHeight: 21 }, candidateRewrite: { marginTop: 8, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }, seedButton: { marginTop: 14, alignSelf: "flex-end", height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", gap: 6 }, seedText: { color: "#fff", fontSize: 13, fontWeight: "600" }, empty: { padding: 36, alignItems: "center" }, emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "600" }, emptyText: { marginTop: 6, color: theme.colors.textMuted, fontSize: 13 }, blueprint: { flex: 1, minHeight: 470, overflow: "hidden" }, node: { position: "absolute", width: 86, height: 86, padding: 8, borderRadius: 43, borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: .08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, seedNode: { borderColor: theme.colors.accentStrong, backgroundColor: theme.colors.accentSoft }, nodeSelected: { borderWidth: 3, borderColor: theme.colors.accentStrong }, nodeText: { color: theme.colors.textSecondary, textAlign: "center", fontSize: 11, lineHeight: 15 }, nodeTextSelected: { color: theme.colors.text, fontWeight: "700" }, legend: { paddingHorizontal: 18, flexDirection: "row", justifyContent: "center", gap: 16 }, legendText: { color: "#717A7E", fontSize: 11 }, legendPhrase: { color: "#4C86B6", fontSize: 11 }, legendProgress: { color: "#A97518", fontSize: 11 }, nodeActions: { padding: 16, paddingBottom: 94, flexDirection: "row", gap: 10 }, secondaryButton: { flex: 1, height: 48, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, secondaryText: { color: theme.colors.accentStrong, fontSize: 14, fontWeight: "600" }, primaryButton: { flex: 1.25, height: 48, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, primaryText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
