import {
  findNodeHandle,
  requireNativeComponent,
  UIManager,
  type HostComponent,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import type React from "react";

export type ChatSelectableTextSelectionEvent = {
  chosenOption: string;
  highlightedText: string;
  selectionStart?: number;
  selectionEnd?: number;
};

export type ChatSelectableTextRangeEvent = {
  groupIndex: number;
};

type NativeProps = ViewProps & {
  text?: string;
  highlightRangesJson?: string;
  blankRangesJson?: string;
  correctRangesJson?: string;
  answersVisible?: boolean;
  textColor?: string;
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: string;
  menuOptions?: string[];
  selectionMode?: "range" | "all";
  onContentHeightChange?: (event: NativeSyntheticEvent<{ height: number }>) => void;
  onSelectionStart?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  onSelection?: (event: NativeSyntheticEvent<ChatSelectableTextSelectionEvent>) => void;
  onClozeRangePress?: (event: NativeSyntheticEvent<ChatSelectableTextRangeEvent>) => void;
  onClozeRangeLongPress?: (event: NativeSyntheticEvent<ChatSelectableTextRangeEvent>) => void;
};

export const ChatSelectableTextView: HostComponent<NativeProps> =
  requireNativeComponent<NativeProps>("ChatSelectableTextView");

export function clearChatSelectableTextSelection(ref: React.RefObject<React.ElementRef<typeof ChatSelectableTextView> | null>): void {
  const nodeHandle = findNodeHandle(ref.current);
  if (!nodeHandle) return;
  UIManager.dispatchViewManagerCommand(nodeHandle, "clearSelection", []);
}
