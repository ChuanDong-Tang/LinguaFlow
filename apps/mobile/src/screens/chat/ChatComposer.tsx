import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  onBlur?: () => void;
  onDisabledPress?: () => void;
  disabled: boolean;
  isSending: boolean;
};

const COLLAPSED_MIN_HEIGHT = 50;
const COLLAPSED_MAX_HEIGHT = 160;
const INPUT_LINE_HEIGHT = 22;
const INPUT_PADDING_TOP = Platform.OS === "android" ? 13 : 12;
const INPUT_PADDING_BOTTOM = Platform.OS === "android" ? 13 : 12;
const IS_IOS = Platform.OS === "ios";
const IOS_EXPAND_TEXT_LENGTH = 60;

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  onFocus,
  onBlur,
  onDisabledPress,
  disabled,
  isSending,
}: ChatComposerProps) {
  const inputRef = useRef<TextInput | null>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [inputHeight, setInputHeight] = useState(COLLAPSED_MIN_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [clipboardText, setClipboardText] = useState("");
  const expandedHeight = useMemo(() => Math.max(220, Math.min(420, Math.round(windowHeight * 0.5))), [windowHeight]);
  const estimatedInputHeight = IS_IOS ? estimateIosInputHeight(value, windowWidth) : COLLAPSED_MIN_HEIGHT;
  const effectiveInputHeight = IS_IOS ? Math.max(inputHeight, estimatedInputHeight) : inputHeight;
  const collapsedHeight = Math.max(
    COLLAPSED_MIN_HEIGHT,
    Math.min(COLLAPSED_MAX_HEIGHT, effectiveInputHeight)
  );
  const shellHeight = expanded ? expandedHeight : collapsedHeight;
  const canExpand = IS_IOS
    ? expanded || value.includes("\n") || value.length >= IOS_EXPAND_TEXT_LENGTH || effectiveInputHeight > COLLAPSED_MIN_HEIGHT + INPUT_LINE_HEIGHT
    : expanded || inputHeight >= COLLAPSED_MAX_HEIGHT;
  const textInputHeight = shellHeight;
  const showPasteButton = IS_IOS && focused && value.length === 0 && clipboardText.length > 0;

  useEffect(() => {
    if (value.length > 0) return;
    setInputHeight(COLLAPSED_MIN_HEIGHT);
    setExpanded(false);
  }, [value.length]);

  useEffect(() => {
    if (!IS_IOS || !focused || value.length > 0) return;
    void refreshClipboardText();
  }, [focused, value.length]);

  function handleToggleExpand(): void {
    setExpanded((current) => !current);
  }

  function handleContentSizeChange(nextHeight: number): void {
    const rawHeight = Math.ceil(nextHeight);
    setInputHeight(Math.max(COLLAPSED_MIN_HEIGHT, rawHeight));
  }

  function handleFocus(): void {
    setFocused(true);
    if (IS_IOS && value.length === 0) {
      void refreshClipboardText();
    }
    onFocus();
  }

  function handleBlur(): void {
    setFocused(false);
    onBlur?.();
  }

  async function refreshClipboardText(): Promise<void> {
    try {
      const nextText = await Clipboard.getStringAsync();
      setClipboardText(nextText.trim().length > 0 ? nextText : "");
    } catch {
      setClipboardText("");
    }
  }

  function handlePaste(): void {
    if (clipboardText.length === 0) return;
    onChangeText(clipboardText);
    setClipboardText("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <View style={styles.inputWrap}>
      <View style={[styles.inputShell, { height: shellHeight }]}>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            expanded ? styles.inputExpanded : styles.inputCollapsed,
            { height: textInputHeight },
          ]}
          placeholder=""
          placeholderTextColor="#A0A4AF"
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          returnKeyType="default"
          blurOnSubmit={false}
          cursorColor="#8E84FF"
          multiline
          onContentSizeChange={(event) => handleContentSizeChange(event.nativeEvent.contentSize.height)}
          scrollEnabled={expanded || collapsedHeight >= COLLAPSED_MAX_HEIGHT}
        />
        {showPasteButton ? (
          <Pressable style={styles.pasteButton} onPress={handlePaste} hitSlop={6}>
            <Ionicons name="clipboard-outline" size={16} color="#7F77F9" />
          </Pressable>
        ) : null}
        {canExpand ? (
          <Pressable style={styles.expandButton} onPress={handleToggleExpand} hitSlop={6}>
            <Ionicons name={expanded ? "contract-outline" : "expand-outline"} size={14} color="#8E84FF" />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.sendButton, (disabled || isSending) && styles.sendButtonDisabled]}
          onPress={isSending ? undefined : (disabled ? onDisabledPress : onSend)}
          disabled={isSending ? true : false}
          hitSlop={6}
        >
          <Ionicons name={"arrow-up"} size={18} color={disabled || isSending ? "#A0A4AF" : "#7F77F9"} />
        </Pressable>
      </View>
    </View>
  );
}

function estimateIosInputHeight(text: string, windowWidth: number): number {
  if (text.length === 0) return COLLAPSED_MIN_HEIGHT;

  const availableTextWidth = Math.max(120, windowWidth - 16 * 2 - 20 - 92);
  const estimatedCharsPerLine = Math.max(12, Math.floor(availableTextWidth / 8));
  const estimatedLines = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / estimatedCharsPerLine)), 0);

  return INPUT_PADDING_TOP + INPUT_PADDING_BOTTOM + estimatedLines * INPUT_LINE_HEIGHT;
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
    alignSelf: "stretch",
    paddingLeft: 20,
    paddingRight: 92,
    lineHeight: INPUT_LINE_HEIGHT,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  inputCollapsed: {
    paddingTop: INPUT_PADDING_TOP,
    paddingBottom: INPUT_PADDING_BOTTOM,
  },
  inputExpanded: {
    paddingTop: INPUT_PADDING_TOP,
    paddingBottom: INPUT_PADDING_BOTTOM,
  },
  expandButton: {
    position: "absolute",
    right: 15,
    top: 13,
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pasteButton: {
    position: "absolute",
    left: 14,
    top: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
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
