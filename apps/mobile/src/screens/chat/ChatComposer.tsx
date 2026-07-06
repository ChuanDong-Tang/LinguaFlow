import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
  useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { t } from "../../i18n";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSttPress?: (context: ChatComposerSttPressContext) => void;
  onFocus: () => void;
  onBlur?: () => void;
  onDisabledPress?: () => void;
  disabled: boolean;
  isSending: boolean;
  sttStatus?: "idle" | "connecting" | "recording" | "stopping";
  inputEditable?: boolean;
  selectionOverride?: { start: number; end: number } | null;
};

export type ChatComposerSttPressContext = {
  selection: { start: number; end: number };
  wasInputFocused: boolean;
};

const COLLAPSED_MIN_HEIGHT = 50;
const COLLAPSED_MAX_HEIGHT = 160;
const INPUT_LINE_HEIGHT = 22;
const INPUT_PADDING_TOP = Platform.OS === "android" ? 13 : 12;
const INPUT_PADDING_BOTTOM = Platform.OS === "android" ? 13 : 12;
const INPUT_VERTICAL_PADDING = INPUT_PADDING_TOP + INPUT_PADDING_BOTTOM;
const INPUT_RIGHT_ACTION_SPACE = 64;
const TEXT_MEASURE_EPSILON = 1;
const IS_IOS = Platform.OS === "ios";

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  onSttPress,
  onFocus,
  onBlur,
  onDisabledPress,
  disabled,
  isSending,
  sttStatus = "idle",
  inputEditable = true,
  selectionOverride = null,
}: ChatComposerProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [contentTextHeight, setContentTextHeight] = useState(INPUT_LINE_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const [inputFocused, setInputFocused] = useState(false);
  const [pasteText, setPasteText] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const expandedHeight = useMemo(() => Math.max(220, Math.min(420, Math.round(windowHeight * 0.5))), [windowHeight]);
  const measuredInputHeight = contentTextHeight + INPUT_VERTICAL_PADDING;
  const measuredLineCount = Math.max(1, Math.ceil(contentTextHeight / INPUT_LINE_HEIGHT));
  const collapsedHeight = Math.max(
    COLLAPSED_MIN_HEIGHT,
    Math.min(COLLAPSED_MAX_HEIGHT, measuredInputHeight)
  );
  const shellHeight = expanded ? expandedHeight : collapsedHeight;
  const canExpand = IS_IOS
    ? expanded || measuredLineCount >= 4
    : expanded || measuredInputHeight >= COLLAPSED_MAX_HEIGHT;
  const textInputHeight = shellHeight;
  const measureText = value.length > 0
    ? value.endsWith("\n") ? `${value} ` : value
    : " ";

  useEffect(() => {
    if (value.length > 0) return;
    setContentTextHeight(INPUT_LINE_HEIGHT);
    setExpanded(false);
  }, [value.length]);

  useEffect(() => {
    if (!selectionOverride) return;
    setSelection(selectionOverride);
  }, [selectionOverride]);

  function handleToggleExpand(): void {
    setExpanded((current) => !current);
    setPasteText(null);
  }

  function handleMeasureTextHeight(nextHeight: number): void {
    const rounded = Math.max(INPUT_LINE_HEIGHT, Math.ceil(nextHeight));
    setContentTextHeight((current) =>
      Math.abs(current - rounded) <= TEXT_MEASURE_EPSILON ? current : rounded
    );
  }

  function handleSelectionChange(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void {
    setSelection(event.nativeEvent.selection);
  }

  function handleFocus(): void {
    setInputFocused(true);
    setPasteText(null);
    onFocus();
  }

  function handleBlur(): void {
    setInputFocused(false);
    setPasteText(null);
    onBlur?.();
  }

  function handleMicPress(): void {
    if (!onSttPress) return;
    const nextSelection = inputFocused ? selection : { start: value.length, end: value.length };
    if (!inputFocused) {
      setSelection(nextSelection);
      inputRef.current?.focus();
    }
    onSttPress({ selection: nextSelection, wasInputFocused: inputFocused });
  }

  async function handleShowPaste(): Promise<void> {
    const text = await Clipboard.getStringAsync().catch(() => "");
    setPasteText(text.length > 0 ? text : null);
  }

  function handlePaste(): void {
    if (!pasteText) return;
    const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
    const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), value.length));
    onChangeText(`${value.slice(0, start)}${pasteText}${value.slice(end)}`);
    const nextCursor = start + pasteText.length;
    setSelection({ start: nextCursor, end: nextCursor });
    setPasteText(null);
  }

  return (
    <View style={styles.inputWrap}>
      {onSttPress ? (
        <Pressable
          style={[
            styles.micButton,
            sttStatus !== "idle" && styles.micButtonActive,
            isSending && styles.micButtonDisabled,
          ]}
          onPress={handleMicPress}
          disabled={isSending}
          hitSlop={6}
        >
          <Ionicons
            name={sttStatus === "recording" || sttStatus === "connecting" ? "stop" : "mic"}
            size={24}
            color={sttStatus === "idle" ? "#7F77F9" : "#FFFFFF"}
          />
        </Pressable>
      ) : null}
      <Pressable style={[styles.inputShell, { height: shellHeight }]} onLongPress={() => void handleShowPaste()}>
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
          editable={inputEditable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSelectionChange={handleSelectionChange}
          selection={selection}
          returnKeyType="default"
          blurOnSubmit={false}
          cursorColor="#8E84FF"
          autoComplete="off"
          contextMenuHidden={false}
          textContentType="none"
          multiline
          scrollEnabled={expanded || collapsedHeight >= COLLAPSED_MAX_HEIGHT}
        />
        {pasteText ? (
          <Pressable style={styles.pasteButton} onPress={handlePaste} hitSlop={8}>
            <Text style={styles.pasteButtonText}>{t("common.paste")}</Text>
          </Pressable>
        ) : null}
        <Text
          style={styles.measureText}
          pointerEvents="none"
          onLayout={(event) => handleMeasureTextHeight(event.nativeEvent.layout.height)}
        >
          {measureText}
        </Text>
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
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    backgroundColor: "#FCFCFD",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  inputShell: {
    flex: 1,
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
    paddingRight: INPUT_RIGHT_ACTION_SPACE,
    lineHeight: INPUT_LINE_HEIGHT,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  measureText: {
    position: "absolute",
    left: 20,
    right: INPUT_RIGHT_ACTION_SPACE,
    top: 0,
    opacity: 0,
    zIndex: -1,
    lineHeight: INPUT_LINE_HEIGHT,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: false,
  },
  pasteButton: {
    position: "absolute",
    left: 18,
    top: -38,
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
  },
  pasteButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
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
  micButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  micButtonActive: {
    backgroundColor: "#8E84FF",
  },
  micButtonDisabled: {
    opacity: 0.5,
  },
});
