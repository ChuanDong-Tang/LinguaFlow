import React from "react";
import {
  findNodeHandle,
  Platform,
  requireNativeComponent,
  StyleSheet,
  Text,
  UIManager,
  type StyleProp,
  type TextStyle,
} from "react-native";

export type NativeTextSelectionPayload = {
  start: number;
  end: number;
  selectedText: string;
  endX: number;
  endY: number;
  isBackward?: boolean;
};

export type NativeClozeHighlightRange = {
  start: number;
  end: number;
  groupIndex?: number;
};

export type NativeClozeBlankRange = {
  start: number;
  end: number;
};

type NativeEvent = {
  nativeEvent: NativeTextSelectionPayload;
};

type NativeClozeRangeEvent = {
  nativeEvent: {
    groupIndex: number;
    start: number;
    end: number;
  };
};

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  highlightRanges?: NativeClozeHighlightRange[];
  blankRanges?: NativeClozeBlankRange[];
  onSelectionChange?: (payload: NativeTextSelectionPayload) => void;
  onClozeRangePress?: (groupIndex: number) => void;
  onClozeRangeLongPress?: (groupIndex: number) => void;
};

type NativeProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  highlightRanges?: NativeClozeHighlightRange[];
  blankRanges?: NativeClozeBlankRange[];
  onSelectionChange?: (event: NativeEvent) => void;
  onClozeRangePress?: (event: NativeClozeRangeEvent) => void;
  onClozeRangeLongPress?: (event: NativeClozeRangeEvent) => void;
};

const NativeSelectableMessageText =
  Platform.OS === "android" || Platform.OS === "ios"
    ? requireNativeComponent<NativeProps>("LFSelectableMessageText")
    : null;

export const SelectableMessageText = React.forwardRef<{ clearSelection: () => void }, Props>(
  function SelectableMessageText({
    text,
    style,
    highlightRanges,
    blankRanges,
    onSelectionChange,
    onClozeRangePress,
    onClozeRangeLongPress,
  }, ref) {
    const nativeRef = React.useRef<any>(null);

    React.useImperativeHandle(ref, () => ({
      clearSelection() {
        const tag = findNodeHandle(nativeRef.current);
        if (!tag) return;
        const command =
          UIManager.getViewManagerConfig("LFSelectableMessageText")?.Commands?.clearSelection ?? "clearSelection";
        UIManager.dispatchViewManagerCommand(tag, command, []);
      },
    }));

    if (!NativeSelectableMessageText) {
      return (
        <Text selectable selectionColor="#8E7BFF" style={style}>
          {text}
        </Text>
      );
    }

    const flattened = StyleSheet.flatten(style) ?? {};
    return (
      <NativeSelectableMessageText
        ref={nativeRef}
        text={text}
        style={style}
        highlightRanges={highlightRanges}
        blankRanges={blankRanges}
        fontSize={typeof flattened.fontSize === "number" ? flattened.fontSize : undefined}
        lineHeight={typeof flattened.lineHeight === "number" ? flattened.lineHeight : undefined}
        color={typeof flattened.color === "string" ? flattened.color : undefined}
        onSelectionChange={(event) => onSelectionChange?.(event.nativeEvent)}
        onClozeRangePress={(event) => onClozeRangePress?.(event.nativeEvent.groupIndex)}
        onClozeRangeLongPress={(event) => onClozeRangeLongPress?.(event.nativeEvent.groupIndex)}
      />
    );
  },
);
