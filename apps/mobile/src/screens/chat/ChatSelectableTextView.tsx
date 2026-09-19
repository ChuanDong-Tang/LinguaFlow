import {
  findNodeHandle,
  Platform,
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
  selectionRect?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
};

export type ChatSelectableTextRangeEvent = {
  groupIndex: number;
  selectionRect?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
};

type NativeProps = ViewProps & {
  text?: string;
  highlightRangesJson?: string;
  blankRangesJson?: string;
  correctRangesJson?: string;
  answerRangesJson?: string;
  activeRangeJson?: string;
  answersVisible?: boolean;
  visualsHidden?: boolean;
  textColor?: string;
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: string;
  menuOptions?: string[];
  selectionMode?: "range" | "all";
  onContentHeightChange?: (event: NativeSyntheticEvent<{ height: number }>) => void;
  onSelectionStart?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  onSelectionEnd?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  onSelection?: (event: NativeSyntheticEvent<ChatSelectableTextSelectionEvent>) => void;
  onClozeRangePress?: (event: NativeSyntheticEvent<ChatSelectableTextRangeEvent>) => void;
  onClozeRangeLongPress?: (event: NativeSyntheticEvent<ChatSelectableTextRangeEvent>) => void;
};

const COMPONENT_NAME = "ChatSelectableTextView";

/**
 * `requireNativeComponent` resolves lazily, so a binary that forgot to
 * register this manager only fails when the first Card is opened. Detect the
 * missing manager before render so released binaries can use the JS fallback.
 */
export const isChatSelectableTextViewAvailable =
  Platform.OS !== "android" || UIManager.getViewManagerConfig(COMPONENT_NAME) != null;

export const ChatSelectableTextView: HostComponent<NativeProps> | null =
  isChatSelectableTextViewAvailable
    ? requireNativeComponent<NativeProps>(COMPONENT_NAME)
    : null;

export type ChatSelectableTextViewInstance = React.ElementRef<HostComponent<NativeProps>>;

export function clearChatSelectableTextSelection(ref: React.RefObject<ChatSelectableTextViewInstance | null>): void {
  if (!isChatSelectableTextViewAvailable) return;
  const nodeHandle = findNodeHandle(ref.current);
  if (!nodeHandle) return;
  UIManager.dispatchViewManagerCommand(nodeHandle, "clearSelection", []);
}
