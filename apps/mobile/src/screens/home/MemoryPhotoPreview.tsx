import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "../../components/Typography";
import * as MediaLibrary from "expo-media-library/legacy";
import { getLanguage } from "../../i18n";
import { theme } from "../../theme";
import { readMemoryPhotoSource } from "../../services/device/memoryPhotoLibrary";

// Resolve only mounted deck cards, never the whole library. ph:// identifiers
// are not file URLs; do not hand them directly to React Native's Image loader.
export function MemoryPhotoPreview({ asset, style, cover = false }: { asset: MediaLibrary.Asset; style: StyleProp<ViewStyle>; cover?: boolean }) {
  const [preview, setPreview] = useState<{ id: string; uri: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(null); setFailed(false);
    void readMemoryPhotoSource(asset).then(source => {
      if (active) setPreview({ id: asset.id, uri: source.uri });
    }).catch(() => { if (active) setPreview({ id: asset.id, uri: null }); });
    return () => { active = false; };
  }, [asset.id, asset.uri]);
  const current = preview?.id === asset.id ? preview : null;
  const labels = { "zh-CN": "照片暂不可预览", "zh-TW": "照片暫不可預覽", "en-US": "Photo preview unavailable", "ja-JP": "写真をプレビューできません" };
  return <View style={[style, { overflow: "hidden", alignItems: "center", justifyContent: "center" }]}>
    {!current ? <ActivityIndicator color={theme.colors.accentStrong} /> : current.uri && !failed
      ? <Image source={{ uri: current.uri }} style={{ width: "100%", height: "100%" }} resizeMode={cover ? "cover" : "contain"} onError={() => setFailed(true)} />
      : <Text style={{ color: theme.colors.textMuted }}>{labels[getLanguage() as keyof typeof labels] ?? labels["en-US"]}</Text>}
  </View>;
}
