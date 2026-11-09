import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, View } from "react-native";
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

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 150 }]} showsVerticalScrollIndicator={false}>
      {recent.length ? <>
        <Text style={styles.sectionTitle}>{t("podcast.recent")}</Text>
        <View style={styles.recentGrid}>{recent.map((item) => <PressableSurface key={item.id} radius={10} feedback={null} style={styles.recentCell} contentStyle={styles.recentInner} onPress={() => void start(item.id, item.title, async () => item)}>
          {item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={styles.recentCover} /> : <View style={[styles.recentCover, styles.coverPlaceholder]}><Icon name="headset-outline" size={18} color={theme.colors.textMuted} /></View>}
          <Text numberOfLines={2} style={styles.recentTitle}>{item.title}</Text>
        </PressableSurface>)}</View>
      </> : null}

      <Text style={styles.sectionTitle}>{t("podcast.by_day")}</Text>
      <View style={styles.dayRow}>{days.map((day) => <Pressable key={day.offset} accessibilityRole="button" style={({ pressed }) => [styles.dayCircle, pressed && styles.pressed]} onPress={() => void start(`day:${dayKey(day.offset)}`, day.label, () => fromPage({ dateKey: dayKey(day.offset), sort: "oldest" }))}>
        {starting === `day:${dayKey(day.offset)}` ? <ActivityIndicator color={theme.colors.accent} /> : <>
          <Text style={styles.dayLabel}>{day.label}</Text>
          <Text style={styles.dayDate}>{dayKey(day.offset).slice(5).replace("-", "/")}</Text>
        </>}
      </Pressable>)}</View>

      <Text style={styles.sectionTitle}>{t("podcast.folders")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderRow}>
        <FolderCard title={t("podcast.favorites")} favorite loading={starting === "favorites"} onPress={() => void start("favorites", t("podcast.favorites"), () => fromPage({ favorites: true }))} />
        {collections.map((collection) => {
          const stats = folderById.get(collection.id);
          if (stats && !stats.cardCount) return null;
          return <FolderCard key={collection.id} title={collection.name} count={stats?.cardCount} coverUrl={stats?.coverUrl ?? null} loading={starting === `folder:${collection.id}`}
            onPress={() => void start(`folder:${collection.id}`, collection.name, async () => ({ ...(await fromPage({ collectionId: collection.id })), coverUrl: stats?.coverUrl ?? null }))}
            onLongPress={() => { haptic.medium(); setCoverPickerFor(collection); }} />;
        })}
      </ScrollView>
      <Text style={styles.hint}>{t("podcast.cover_hint")}</Text>

      {home === null ? <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.textMuted} /> : home.themes.length ? <>
        <Text style={styles.sectionTitle}>{t("podcast.themes")}</Text>
        <View style={styles.themeWrap}>{home.themes.map((item) => <Pressable key={item.label} accessibilityRole="button" style={({ pressed }) => [styles.themeChip, pressed && styles.pressed]} onPress={() => void start(`theme:${item.label}`, item.label, async () => ({ recordIds: item.recordIds, coverUrl: item.coverUrl }))}>
          {starting === `theme:${item.label}` ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Text style={styles.themeText}># {item.label}</Text>}
          <Text style={styles.themeCount}>{item.recordIds.length}</Text>
        </Pressable>)}</View>
      </> : null}
    </ScrollView>

    <PressableSurface radius={28} fill={theme.colors.accent} feedback={null} accessibilityRole="button" accessibilityLabel={t("podcast.shuffle_all")} style={[styles.shuffleFab, { bottom: bottomInset + 92 }]} contentStyle={styles.shuffleFabInner}
      onPress={() => void start("random", t("podcast.shuffle_all"), () => fromPage({ shuffleSeed: Crypto.randomUUID(), limit: 30 }))}>
      {starting === "random" ? <ActivityIndicator color={theme.colors.onAccent} /> : <Shuffle size={24} color={theme.colors.onAccent} weight="bold" />}
    </PressableSurface>

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
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={styles.pickerPage}>
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
    </View>
  </Modal>;
}

const styles = createStyles(() => ({
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
