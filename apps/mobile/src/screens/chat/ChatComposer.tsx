import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  onDisabledPress?: () => void;
  disabled: boolean;
  isSending: boolean;
};

const COLLAPSED_MIN_HEIGHT = 50;
const COLLAPSED_MAX_HEIGHT = 160;
const HEIGHT_CHANGE_EPSILON = 2;
const SINGLE_LINE_LOCK_HEIGHT = 52;

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  onFocus,
  onDisabledPress,
  disabled,
  isSending,
}: ChatComposerProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [inputHeight, setInputHeight] = useState(COLLAPSED_MIN_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useMemo(() => Math.max(220, Math.min(420, Math.round(windowHeight * 0.5))), [windowHeight]);
  const [shellHeight, setShellHeight] = useState(COLLAPSED_MIN_HEIGHT);
  const lastCollapsedShellHeight = useRef(COLLAPSED_MIN_HEIGHT);
  const canExpand = expanded || inputHeight >= COLLAPSED_MAX_HEIGHT;

  function handleToggleExpand(): void {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      setShellHeight(expandedHeight);
      return;
    }
    const collapsedHeight = Math.max(
      COLLAPSED_MIN_HEIGHT,
      Math.min(COLLAPSED_MAX_HEIGHT, inputHeight)
    );
    lastCollapsedShellHeight.current = collapsedHeight;
    setShellHeight(collapsedHeight);
  }

  function handleContentSizeChange(nextHeight: number): void {
    const rawHeight = Math.ceil(nextHeight);
    const normalized = rawHeight <= SINGLE_LINE_LOCK_HEIGHT
      ? COLLAPSED_MIN_HEIGHT
      : Math.max(COLLAPSED_MIN_HEIGHT, rawHeight);
    setInputHeight(normalized);
    if (expanded) return;
    const nextCollapsedHeight = Math.min(COLLAPSED_MAX_HEIGHT, normalized);
    if (Math.abs(nextCollapsedHeight - lastCollapsedShellHeight.current) < HEIGHT_CHANGE_EPSILON) return;
    lastCollapsedShellHeight.current = nextCollapsedHeight;
    setShellHeight(nextCollapsedHeight);
  }

  return (
    <View style={styles.inputWrap}>
      <View style={[styles.inputShell, { height: shellHeight }]}>
        <TextInput
          style={[styles.input, expanded ? styles.inputExpanded : styles.inputCollapsed]}
          placeholder="输入你想改写的内容..."
          placeholderTextColor="#A0A4AF"
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          returnKeyType="default"
          blurOnSubmit={false}
          cursorColor="#8E84FF"
          multiline
          onContentSizeChange={(event) => handleContentSizeChange(event.nativeEvent.contentSize.height)}
          scrollEnabled={expanded || inputHeight > COLLAPSED_MAX_HEIGHT}
        />
        {canExpand ? (
          <Pressable style={styles.expandButton} onPress={handleToggleExpand} hitSlop={6}>
            <Ionicons name={expanded ? "contract-outline" : "expand-outline"} size={14} color="#8E84FF" />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.sendButton, disabled && !isSending && styles.sendButtonDisabled]}
          onPress={isSending ? onStop : (disabled ? onDisabledPress : onSend)}
          disabled={isSending ? false : false}
          hitSlop={6}
        >
          <Ionicons name={isSending ? "square" : "arrow-up"} size={18} color="#7F77F9" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    backgroundColor: "#FCFCFD",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  inputShell: {
    minHeight: COLLAPSED_MIN_HEIGHT,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#D9DDE6",
    backgroundColor: "#FFFFFF",
    position: "relative",
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    paddingLeft: 20,
    paddingRight: 92,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: true,
    textAlignVertical: "center",
  },
  inputCollapsed: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  inputExpanded: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  expandButton: {
    position: "absolute",
    right: 50,
    bottom: 13,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    position: "absolute",
    right: 12,
    bottom: 5,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
});
