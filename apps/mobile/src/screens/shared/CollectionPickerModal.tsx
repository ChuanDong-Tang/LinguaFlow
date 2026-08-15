import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CardCollection } from "../../services/api/cardApi";
import { theme } from "../../theme";
import { t } from "../../i18n";

export function CollectionPickerModal({ visible, title, collections, value, includeAll = false, onClose, onSelect }: {
  visible: boolean;
  title: string;
  collections: CardCollection[];
  value: string | null | undefined;
  includeAll?: boolean;
  onClose: () => void;
  onSelect: (collectionId: string | null | undefined) => Promise<void> | void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!visible) return;
    const expanded = new Set<string>();
    let currentId = value;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      expanded.add(currentId);
      currentId = collections.find((collection) => collection.id === currentId)?.parentId ?? null;
    }
    setExpandedIds(expanded);
    setQuery("");
    setSelecting(undefined);
  }, [visible, value, collections]);
  const treeRows = useMemo(() => {
    const rows: Array<{ collection: CardCollection; depth: number }> = [];
    const append = (parentId: string | null, depth: number) => {
      collections.filter((collection) => collection.parentId === parentId).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)).forEach((collection) => {
        rows.push({ collection, depth });
        if (expandedIds.has(collection.id)) append(collection.id, depth + 1);
      });
    };
    append(null, 0);
    return rows;
  }, [collections, expandedIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchMatches = normalizedQuery ? collections.filter((collection) => collectionPathName(collection, collections).toLocaleLowerCase().includes(normalizedQuery)).sort((left, right) => collectionPathName(left, collections).localeCompare(collectionPathName(right, collections))) : [];
  const select = async (collectionId: string | null | undefined) => {
    if (selecting !== undefined) return;
    if (value === collectionId) return onClose();
    setSelecting(collectionId);
    try { await onSelect(collectionId); onClose(); }
    catch (error) { Alert.alert(t("collection_picker.select_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again")); }
    finally { setSelecting(undefined); }
  };
  const renderTarget = (collection: CardCollection, showPath: boolean, depth = 0) => {
    const hasChildren = collections.some((candidate) => candidate.parentId === collection.id);
    return <View key={collection.id} style={styles.row}>
      {!showPath ? hasChildren ? <Pressable style={[styles.disclosure, { marginLeft: depth * 20 }]} disabled={selecting !== undefined} onPress={() => setExpandedIds((current) => { const next = new Set(current); if (next.has(collection.id)) next.delete(collection.id); else next.add(collection.id); return next; })}><Ionicons name={expandedIds.has(collection.id) ? "chevron-down" : "chevron-forward"} size={18} color={theme.colors.textMuted} /></Pressable> : <View style={[styles.disclosure, { marginLeft: depth * 20 }]} /> : null}
      <Pressable style={[styles.target, showPath && styles.searchTarget]} disabled={selecting !== undefined} onPress={() => void select(collection.id)}>
        <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
        <Text numberOfLines={1} style={styles.name}>{showPath ? collectionPathName(collection, collections) : collection.name}</Text>
        {value === collection.id ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
        {selecting === collection.id ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
      </Pressable>
    </View>;
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Pressable style={styles.headerSide} onPress={onClose}><Text style={styles.cancel}>{t("common.cancel")}</Text></Pressable><Text numberOfLines={1} style={styles.title}>{title}</Text><View style={styles.headerSide} /></View>
      {collections.length > 7 ? <View style={styles.search}><Ionicons name="search" size={18} color={theme.colors.textMuted} /><TextInput value={query} onChangeText={setQuery} placeholder={t("collection_picker.search_placeholder")} placeholderTextColor={theme.colors.textMuted} style={styles.searchInput} autoCorrect={false} clearButtonMode="while-editing" /></View> : null}
      <ScrollView contentContainerStyle={styles.list} alwaysBounceVertical={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {normalizedQuery ? searchMatches.length ? searchMatches.map((collection) => renderTarget(collection, true)) : <Text style={styles.empty}>{t("collection_picker.empty")}</Text> : <>
          {includeAll ? (
            <Pressable style={styles.hereRow} disabled={selecting !== undefined} onPress={() => void select(undefined)}>
              <Ionicons name="albums-outline" size={20} color={theme.colors.textSecondary} />
              <Text style={styles.name}>{t("sidebar.collections")}</Text>
              {value === undefined ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
            </Pressable>
          ) : (
            <View style={styles.hereRow}>
              <Ionicons name="albums-outline" size={20} color={theme.colors.textSecondary} />
              <Text style={styles.name}>{t("sidebar.collections")}</Text>
            </View>
          )}
          <View style={styles.row}>
            <View style={styles.disclosure} />
            <Pressable style={styles.target} disabled={selecting !== undefined} onPress={() => void select(null)}>
              <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
              <Text style={styles.name}>{t("sidebar.unclassified")}</Text>
              {value === null ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
              {selecting === null ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
            </Pressable>
          </View>
          {treeRows.map(({ collection, depth }) => renderTarget(collection, false, depth))}
        </>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

export function collectionPathName(collection: CardCollection, collections: CardCollection[]): string {
  const names = [collection.name];
  let parentId = collection.parentId;
  const visited = new Set<string>([collection.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = collections.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { minHeight: 58, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center" },
  headerSide: { width: 62, minHeight: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: theme.colors.text, fontSize: 16, fontWeight: "500", textAlign: "center" },
  cancel: { color: theme.colors.textSecondary, fontSize: 15 },
  search: { marginHorizontal: 18, marginTop: 14, height: 42, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, height: 42, color: theme.colors.text, fontSize: 14 },
  list: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40 },
  row: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "stretch" },
  target: { flex: 1, minWidth: 0, paddingRight: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  searchTarget: { paddingLeft: 10 },
  disclosure: { width: 34, alignItems: "center", justifyContent: "center" },
  hereRow: { minHeight: 54, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center", gap: 12 },
  name: { flex: 1, color: theme.colors.text, fontSize: 15 },
  empty: { paddingVertical: 36, color: theme.colors.textMuted, fontSize: 14, textAlign: "center" },
});
