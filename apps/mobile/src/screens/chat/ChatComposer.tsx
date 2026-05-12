import React, { useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
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

const COLLAPSED_MIN_HEIGHT = 58;
const COLLAPSED_MAX_HEIGHT = 160;

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
  const shellHeightAnim = useRef(new Animated.Value(COLLAPSED_MIN_HEIGHT)).current;
  const canExpand = expanded || inputHeight >= COLLAPSED_MAX_HEIGHT;

  function setShellHeight(next: number): void {
    Animated.timing(shellHeightAnim, {
      toValue: next,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }

  function handleToggleExpand(): void {
    const next = !expanded;
    setExpanded(next);
    setShellHeight(next ? expandedHeight : Math.max(COLLAPSED_MIN_HEIGHT, Math.min(COLLAPSED_MAX_HEIGHT, inputHeight)));
  }

  function handleContentSizeChange(nextHeight: number): void {
    const normalized = Math.max(COLLAPSED_MIN_HEIGHT, Math.ceil(nextHeight));
    setInputHeight(normalized);
    if (expanded) return;
    setShellHeight(Math.min(COLLAPSED_MAX_HEIGHT, normalized));
  }

  return (
    <View style={styles.inputWrap}>
      <Animated.View style={[styles.inputShell, { height: shellHeightAnim }]}>
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
      </Animated.View>
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
    fontSize: 16,
    lineHeight: 22,
    color: "#111111",
    includeFontPadding: false,
  },
  inputCollapsed: {
    textAlignVertical: "center",
    paddingTop: 14,
    paddingBottom: 14,
  },
  inputExpanded: {
    textAlignVertical: "top",
    paddingTop: 14,
    paddingBottom: 14,
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
    bottom: 9,
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
