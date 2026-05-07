import React, { useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  disabled: boolean;
  isSending: boolean;
};

const COLLAPSED_MIN_HEIGHT = 44;
const COLLAPSED_MAX_HEIGHT = 132;

export function ChatComposer({ value, onChangeText, onSend, onStop, onFocus, disabled, isSending }: ChatComposerProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [inputHeight, setInputHeight] = useState(COLLAPSED_MIN_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useMemo(() => Math.max(220, Math.min(420, Math.round(windowHeight * 0.5))), [windowHeight]);
  const shellHeightAnim = useRef(new Animated.Value(COLLAPSED_MIN_HEIGHT)).current;
  const displayValue = value;
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

  function handleChangeText(next: string): void {
    onChangeText(next);
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
          placeholder=""
          placeholderTextColor="#A0A4AF"
          value={displayValue}
          onChangeText={handleChangeText}
          onFocus={onFocus}
          returnKeyType="default"
          blurOnSubmit={false}
          cursorColor="#8E84FF"
          multiline
          onContentSizeChange={(event) => {
            handleContentSizeChange(event.nativeEvent.contentSize.height);
          }}
          scrollEnabled={expanded || inputHeight > COLLAPSED_MAX_HEIGHT}
        />
        {canExpand ? (
          <Pressable style={styles.expandButton} onPress={handleToggleExpand} hitSlop={6}>
            <Ionicons name={expanded ? "contract-outline" : "expand-outline"} size={16} color="#8E84FF" />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.sendButton, disabled && !isSending && styles.sendButtonDisabled]}
          onPress={isSending ? onStop : onSend}
          disabled={disabled && !isSending}
          hitSlop={6}
        >
          <Ionicons name={isSending ? "square" : "arrow-up"} size={16} color="#8E84FF" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E7E7EE",
  },
  inputShell: {
    minHeight: 44,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: "#FFFFFF",
    position: "relative",
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    paddingLeft: 12,
    paddingRight: 86,
    fontSize: 16,
    lineHeight: 22,
    color: "#111111",
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    includeFontPadding: false,
  },
  inputCollapsed: {
    textAlignVertical: "center",
    paddingTop: 10,
    paddingBottom: 10,
  },
  inputExpanded: {
    textAlignVertical: "top",
    paddingTop: 0,
    paddingBottom: 0,
  },
  expandButton: {
    position: "absolute",
    right: 7,
    top: 7,
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    position: "absolute",
    right: 7,
    bottom: 7,
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
});
