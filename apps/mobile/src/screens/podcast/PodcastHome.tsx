import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Shuffle, Star } from "phosphor-react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { PressableSurface } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { getCardRecordPage, getPodcastHome, setCardCollectionCover, type CardRecordSummary, type PodcastHomeData } from "../../services/api/cardApi";
import { loadRecentPodcasts, playPodcast, type PodcastPlaylist } from "../../services/podcast/podcastPlayer";
import { arrangeLibrary, mergeRecent, type PodcastLibraryFilter, type PodcastLibraryItem, type PodcastLibrarySort } from "../../domain/podcast/podcastLibrary";

type Collection = { id: string; name: string };

function dayKey(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 播客 tab: choose what to listen to — recent lists, days, folders, themes. */
export function PodcastHome({ collections, bottomInset, onOpenPlayer }: {
  collections: Collection[];
  bottomInset: number;
  onOpenPlayer: () => void;
}) {
  const [home, setHome] = useState<PodcastHomeData | null>(null);
  const [recent, setRecent] = useState<PodcastPlaylist[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [coverPickerFor, setCoverPickerFor] = useState<Collection | null>(null);

  const reload = useCallback(() => {
    void loadRecentPodcasts().then(setRecent);
    void getPodcastHome(getLanguage()).then(setHome).catch(() => setHome({ folders: [], themes: [] }));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function start(id: string, title: string, load: () => Promise<{ recordIds: string[]; coverUrl?: string | null }>) {
    if (starting) return;
    haptic.medium();
    setStarting(id);
    try {
      const { recordIds, coverUrl } = await load();
      if (!recordIds.length) { haptic.warning(); return; }
      await playPodcast({ id, title, recordIds, coverUrl: coverUrl ?? null });
      onOpenPlayer();
      void loadRecentPodcasts().then(setRecent);
    } catch {
      haptic.error();
    } finally { setStarting(null); }
  }

  const fromPage = async (input: Parameters<typeof getCardRecordPage>[0]) => {
    const page = await getCardRecordPage({ limit: 50, ...input });
    const items = page.items.filter((item) => !item.isSample && item.status === "completed");
    return { recordIds: items.map((item) => item.id), coverUrl: items.find((item) => item.thumbnail)?.thumbnail?.url ?? null };
  };
  const days = [
    { offset: 0, label: t("podcast.today") },
    { offset: 1, label: t("podcast.yesterday") },
    { offset: 2, label: t("podcast.day_before") },
  ];
  const folderById = new Map((home?.folders ?? []).map((folder) => [folder.id, folder]));
  const [sort, setSort] = useState<PodcastLibrarySort>("recent");
  const [filter, setFilter] = useState<PodcastLibraryFilter>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sortSheet, setSortSheet] = useState(false);

  // Everything you can listen to, in one Spotify-style library.
  const items = useMemo(() => {
    const base: PodcastLibraryItem[] = [
      { id: "favorites", kind: "favorites", title: t("podcast.favorites"), coverUrl: null, order: 0 },
      ...days.map((day, index) => ({ id: `day:${dayKey(day.offset)}`, kind: "day" as const, title: day.label, coverUrl: null, order: 1 + index })),
      ...collections.flatMap((collection, index) => {
        const stats = folderById.get(collection.id);
        if (stats && !stats.cardCount) return [];
        return [{ id: `folder:${collection.id}`, kind: "folder" as const, title: collection.name, count: stats?.cardCount, coverUrl: stats?.coverUrl ?? null, order: 10 + index }];
      }),
      ...(home?.themes ?? []).map((item, index) => ({ id: `theme:${item.label}`, kind: "theme" as const, title: item.label, count: item.recordIds.length, coverUrl: item.coverUrl, order: 1000 + index })),
    ];
    return arrangeLibrary(mergeRecent(base, recent), sort, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Language loads after first render: recompute when it changes.
  }, [collections, filter, home, recent, sort, getLanguage()]);

  const play = (item: PodcastLibraryItem) => {
    if (item.kind === "favorites") return void start("favorites", item.title, () => fromPage({ favorites: true }));
    if (item.kind === "day") { const date = item.id.slice(4); return void start(item.id, item.title, () => fromPage({ dateKey: date, sort: "oldest" })); }
    if (item.kind === "folder") { const id = item.id.slice(7); return void start(item.id, item.title, async () => ({ ...(await fromPage({ collectionId: id })), coverUrl: item.coverUrl })); }
    if (item.kind === "theme") { const themeItem = home?.themes.find((entry) => `theme:${entry.label}` === item.id); return void start(item.id, item.title, async () => ({ recordIds: themeItem?.recordIds ?? [], coverUrl: item.coverUrl })); }
    const playlist = recent.find((entry) => entry.id === item.id);
    if (playlist) void start(item.id, item.title, async () => playlist);
  };
  const subtitle = (item: PodcastLibraryItem) => {
    const kind = t(`podcast.kind.${item.kind}` as "podcast.kind.day");
    if (item.kind === "day") return `${kind} · ${item.id.slice(9).replace("-", "/")}`;
    return item.count !== undefined ? `${kind} · ${t("podcast.card_count").replace("{count}", String(item.count))}` : kind;
  };
  const sortLabels: Record<PodcastLibrarySort, string> = { recent: t("podcast.sort.recent"), added: t("podcast.sort.added"), alpha: t("podcast.sort.alpha"), count: t("podcast.sort.count") };

  return <View style={styles.page}>
    <View style={styles.filterRow}>
      {(["all", "day", "folder", "theme"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: filter === value }} style={[styles.filterChip, filter === value && styles.filterChipOn]} onPress={() => { haptic.select(); setFilter(value); }}>
        <Text style={[styles.filterText, filter === value && styles.filterTextOn]}>{t(`podcast.filter.${value}` as "podcast.filter.all")}</Text>
      </Pressable>)}
    </View>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" hitSlop={6} style={styles.sortButton} onPress={() => { haptic.light(); setSortSheet(true); }}>
        <Icon name="swap-vertical-outline" size={15} color={theme.colors.text} />
        <Text style={styles.sortText}>{sortLabels[sort]}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t(view === "list" ? "podcast.view_grid" : "podcast.view_list")} hitSlop={8} onPress={() => { haptic.select(); setView((value) => value === "list" ? "grid" : "list"); }}>
        <Icon name={view === "list" ? "grid-outline" : "list-outline"} size={20} color={theme.colors.text} />
      </Pressable>
    </View>
    <FlatList
      key={view}
      data={items}
      numColumns={view === "grid" ? 3 : 1}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.libraryContent, { paddingBottom: bottomInset + 160 }]}
      columnWrapperStyle={view === "grid" ? styles.gridRow : undefined}
      ListFooterComponent={home === null ? <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.textMuted} /> : <Text style={styles.hint}>{t("podcast.cover_hint")}</Text>}
      renderItem={({ item }) => {
        const loading = starting === item.id;
        const cover = <View style={view === "grid" ? styles.gridCover : styles.rowCover}>
          {item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder, item.kind === "favorites" && styles.favoriteCover]}>
            {item.kind === "favorites" ? <Star size={view === "grid" ? 30 : 22} color={theme.colors.onAccent} weight="fill" />
              : item.kind === "day" ? <Text style={styles.dayCoverText}>{item.title}</Text>
              : <Icon name={item.kind === "theme" ? "pricetag-outline" : item.kind === "recent" ? "headset-outline" : "folder-outline"} size={view === "grid" ? 26 : 20} color={theme.colors.textMuted} />}
          </View>}
          {loading ? <View style={styles.folderLoading}><ActivityIndicator color={theme.colors.onInk} /></View> : null}
        </View>;
        const longPress = item.kind === "folder" ? () => { haptic.medium(); setCoverPickerFor({ id: item.id.slice(7), name: item.title }); } : undefined;
        return view === "grid"
          ? <Pressable accessibilityRole="button" style={({ pressed }) => [styles.gridCell, pressed && styles.pressed]} onPress={() => play(item)} onLongPress={longPress} delayLongPress={400}>
            {cover}
            <Text numberOfLines={1} style={styles.cellTitle}>{item.kind === "theme" ? `# ${item.title}` : item.title}</Text>
            <Text numberOfLines={1} style={styles.cellSubtitle}>{subtitle(item)}</Text>
          </Pressable>
          : <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => play(item)} onLongPress={longPress} delayLongPress={400}>
            {cover}
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.cellTitle}>{item.kind === "theme" ? `# ${item.title}` : item.title}</Text>
              <Text numberOfLines={1} style={styles.cellSubtitle}>{item.kind === "favorites" ? `📌 ${subtitle(item)}` : subtitle(item)}</Text>
            </View>
          </Pressable>;
      }}
    />

    <PressableSurface radius={28} fill={theme.colors.accent} feedback={null} accessibilityRole="button" accessibilityLabel={t("podcast.shuffle_all")} style={[styles.shuffleFab, { bottom: bottomInset + 92 }]} contentStyle={styles.shuffleFabInner}
      onPress={() => void start("random", t("podcast.shuffle_all"), () => fromPage({ shuffleSeed: Crypto.randomUUID(), limit: 30 }))}>
      {starting === "random" ? <ActivityIndicator color={theme.colors.onAccent} /> : <Shuffle size={24} color={theme.colors.onAccent} weight="bold" />}
    </PressableSurface>

    <Modal visible={sortSheet} transparent animationType="slide" onRequestClose={() => setSortSheet(false)}>
      <Pressable style={styles.sheetBackdrop} onPress={() => setSortSheet(false)}>
        <View style={[styles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t("podcast.sort.title")}</Text>
          {(["recent", "added", "alpha", "count"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: sort === value }} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]} onPress={() => { haptic.select(); setSort(value); setSortSheet(false); }}>
            <Text style={styles.sheetRowText}>{sortLabels[value]}</Text>
            {sort === value ? <Icon name="checkmark" size={20} color={theme.colors.accent} /> : null}
          </Pressable>)}
        </View>
      </Pressable>
    </Modal>

    {coverPickerFor ? <CoverPicker collection={coverPickerFor} onClose={() => setCoverPickerFor(null)} onChosen={() => { setCoverPickerFor(null); reload(); }} /> : null}
  </View>;
}

function FolderCard({ title, count, coverUrl, favorite = false, loading, onPress, onLongPress }: {
  title: string; count?: number; coverUrl?: string | null; favorite?: boolean; loading: boolean;
  onPress: () => void; onLongPress?: () => void;
}) {
  return <PressableSurface radius={12} feedback={null} style={styles.folderCard} contentStyle={styles.folderInner} onPress={onPress} onLongPress={onLongPress} delayLongPress={400}>
    <View style={styles.folderCover}>
      {coverUrl ? <Image source={{ uri: coverUrl }} style={styles.folderCoverImage} /> : <View style={[styles.folderCoverImage, styles.coverPlaceholder]}>{favorite ? <Star size={30} color={theme.colors.accent} weight="fill" /> : <Icon name="folder-outline" size={28} color={theme.colors.textMuted} />}</View>}
      {loading ? <View style={styles.folderLoading}><ActivityIndicator color={theme.colors.onInk} /></View> : null}
    </View>
    <Text numberOfLines={1} style={styles.folderTitle}>{title}</Text>
    {count !== undefined ? <Text style={styles.folderCount}>{t("podcast.card_count").replace("{count}", String(count))}</Text> : null}
  </PressableSurface>;
}

/** Choose a folder cover from the photos already in that folder. */
function CoverPicker({ collection, onClose, onChosen }: { collection: Collection; onClose: () => void; onChosen: () => void }) {
  const [items, setItems] = useState<CardRecordSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void getCardRecordPage({ collectionId: collection.id, limit: 50 }).then((page) => setItems(page.items.filter((item) => item.thumbnail))).catch(() => setItems([]));
  }, [collection.id]);
  async function choose(recordId: string | null) {
    if (saving) return;
    setSaving(true);
    try { await setCardCollectionCover(collection.id, recordId); haptic.success(); onChosen(); }
    catch { haptic.error(); setSaving(false); }
  }
  // Own SafeAreaProvider: on Android the sheet is full screen and its header sat under the status bar.
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView edges={["top", "bottom"]} style={styles.pickerPage}>
      <View style={styles.pickerHeader}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose}><Icon name="close" size={22} /></Pressable>
        <Text style={styles.pickerTitle}>{t("podcast.choose_cover").replace("{name}", collection.name)}</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void choose(null)}><Text style={styles.pickerAuto}>{t("podcast.cover_auto")}</Text></Pressable>
      </View>
      {items === null ? <ActivityIndicator style={{ marginTop: 40 }} /> : !items.length ? <Text style={styles.hint}>{t("podcast.cover_empty")}</Text> : <FlatList
        data={items}
        numColumns={3}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 6 }}
        renderItem={({ item }) => <Pressable style={({ pressed }) => [styles.pickerTile, pressed && styles.pressed]} onPress={() => void choose(item.id)}>
          <Image source={{ uri: item.thumbnail!.url }} style={styles.pickerImage} />
        </Pressable>}
      />}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const styles = createStyles(() => ({
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  filterChip: { minHeight: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: theme.colors.fill2, justifyContent: "center" },
  filterChipOn: { backgroundColor: theme.colors.accent },
  filterText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  filterTextOn: { color: theme.colors.onAccent },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 6 },
  sortButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32 },
  sortText: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  libraryContent: { paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  rowCover: { width: 56, height: 56, borderRadius: 8, overflow: "hidden", backgroundColor: theme.colors.fill2 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  gridRow: { gap: 12 },
  gridCell: { flex: 1 / 3, maxWidth: "31.5%", marginBottom: 14 },
  gridCover: { width: "100%", aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.fill2, marginBottom: 6 },
  favoriteCover: { backgroundColor: theme.colors.accent },
  dayCoverText: { color: theme.colors.accent, fontSize: 15, fontWeight: "800" },
  cellTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  cellSubtitle: { color: theme.colors.textMuted, fontSize: 12 },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: theme.colors.scrim },
  sheet: { paddingTop: 8, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: theme.colors.surface },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.fill3, marginBottom: 8 },
  sheetTitle: { textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "800", paddingVertical: 10 },
  sheetRow: { minHeight: 54, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetRowText: { color: theme.colors.text, fontSize: 16 },
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  sectionTitle: { marginTop: 18, marginBottom: 10, color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  hint: { marginTop: 6, color: theme.colors.textMuted, fontSize: 12 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  recentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recentCell: { width: "48.5%" },
  recentInner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.fill1, paddingRight: 8 },
  recentCover: { width: 52, height: 52 },
  coverPlaceholder: { backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  recentTitle: { flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  dayRow: { flexDirection: "row", justifyContent: "space-around" },
  dayCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.accentSoft, alignItems: "center", justifyContent: "center", gap: 2 },
  dayLabel: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  dayDate: { color: theme.colors.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] },
  folderRow: { gap: 12, paddingRight: 16 },
  folderCard: { width: 128 },
  folderInner: { backgroundColor: "transparent" },
  folderCover: { width: 128, height: 128, borderRadius: 12, overflow: "hidden" },
  folderCoverImage: { width: "100%", height: "100%" },
  folderLoading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.scrim },
  folderTitle: { marginTop: 8, color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  folderCount: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 },
  themeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  themeChip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: theme.colors.fill2, flexDirection: "row", alignItems: "center", gap: 6 },
  themeText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  themeCount: { color: theme.colors.textMuted, fontSize: 12 },
  shuffleFab: { position: "absolute", right: 20, ...theme.shadow.float },
  shuffleFabInner: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pickerPage: { flex: 1, backgroundColor: theme.colors.canvas },
  pickerHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  pickerTitle: { flex: 1, color: theme.colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  pickerAuto: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
  pickerTile: { width: "33.333%", aspectRatio: 1, padding: 3 },
  pickerImage: { width: "100%", height: "100%", borderRadius: 8 },
}));
