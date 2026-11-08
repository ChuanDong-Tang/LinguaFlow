import React, { type ComponentProps } from "react";
import type { StyleProp, TextStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { theme } from "../theme";
import {
  ArrowClockwise, ArrowDown, ArrowLeft, ArrowRight, ArrowsClockwise, ArrowsIn, ArrowsOut, ArrowsOutCardinal, ArrowUp, ArrowUUpLeft,
  BookOpen, BookOpenText, CalendarBlank, CalendarDot, Camera, Cards, CaretDown, CaretLeft, CaretRight, CaretUp, ChatCircleDots,
  ChatTeardropDots, Check, CircleHalf, CheckCircle, Checks, CircleIcon as Circle, CloudArrowDown, Code, Copy, Cube, DotsThree, DownloadSimple, Ear, Eye,
  EyeSlash, FileText, Flag, Folder, FolderOpen, GearSix, Globe, GraduationCap, Headphones, Image, ImageSquare, Info, Leaf, Lightbulb,
  Link, List, MagnifyingGlass, Microphone, MusicNote, MusicNotes, Pause, PencilSimple, Play, Plus, PlusCircle, ShareNetwork,
  ShieldCheck, Shuffle, SignOut, SkipBack, SkipForward, SpeakerHigh, SpeakerLow, Square, SquaresFour, Star, Stop, TextT, Translate,
  Trash, User, UserMinus, Users, WarningCircle, X, XCircle, type IconProps, type IconWeight,
} from "phosphor-react-native";

export type IconName = ComponentProps<typeof Ionicons>["name"];
type PhosphorIcon = React.ComponentType<IconProps>;

// Existing call sites use Ionicons glyph names; map them onto one consistent
// Phosphor family. Solid Ionicons glyphs map to the "fill" weight.
const MAP: Partial<Record<string, [PhosphorIcon, IconWeight?]>> = {
  close: [X], "close-outline": [X], "close-circle": [XCircle, "fill"], "close-circle-outline": [XCircle],
  checkmark: [Check], "checkmark-outline": [Check], "checkmark-circle": [CheckCircle, "fill"], "checkmark-circle-outline": [CheckCircle],
  "checkmark-done-circle": [Checks, "bold"],
  "chevron-forward": [CaretRight], "chevron-back": [CaretLeft], "chevron-down": [CaretDown], "chevron-up": [CaretUp],
  "arrow-forward": [ArrowRight], "arrow-back": [ArrowLeft], "arrow-up": [ArrowUp], "arrow-up-outline": [ArrowUp], "arrow-down-outline": [ArrowDown],
  "arrow-undo-outline": [ArrowUUpLeft],
  add: [Plus], "add-outline": [Plus], "add-circle-outline": [PlusCircle],
  "trash-outline": [Trash], "folder-outline": [Folder], "folder-open-outline": [FolderOpen],
  refresh: [ArrowClockwise], "refresh-outline": [ArrowClockwise], "sync-outline": [ArrowsClockwise], shuffle: [Shuffle],
  "ellipsis-horizontal": [DotsThree, "bold"], "person-outline": [User], "people-outline": [Users], "person-remove-outline": [UserMinus],
  "albums-outline": [Cards], "volume-high-outline": [SpeakerHigh], "volume-medium-outline": [SpeakerLow],
  search: [MagnifyingGlass], "search-outline": [MagnifyingGlass], "document-text-outline": [FileText], "reader-outline": [BookOpenText],
  "create-outline": [PencilSimple], "text-outline": [TextT], "language-outline": [Translate], "globe-outline": [Globe],
  play: [Play, "fill"], pause: [Pause, "fill"], stop: [Stop, "fill"], "play-skip-forward": [SkipForward, "fill"], "play-skip-back": [SkipBack, "fill"],
  "images-outline": [ImageSquare], "image-outline": [Image], "today-outline": [CalendarDot], "calendar-outline": [CalendarBlank],
  "copy-outline": [Copy], "alert-circle": [WarningCircle, "fill"], "alert-circle-outline": [WarningCircle],
  "settings-outline": [GearSix], "musical-notes-outline": [MusicNotes], "musical-note-outline": [MusicNote], "move-outline": [ArrowsOutCardinal],
  "mic-outline": [Microphone], "link-outline": [Link], "information-circle-outline": [Info], "git-network-outline": [ShareNetwork],
  flag: [Flag, "fill"], "exit-outline": [SignOut], "log-out-outline": [SignOut], "ear-outline": [Ear], "download-outline": [DownloadSimple],
  "cloud-download-outline": [CloudArrowDown], "camera-outline": [Camera], "book-outline": [BookOpen], "school-outline": [GraduationCap],
  "eye-outline": [Eye], "eye-off-outline": [EyeSlash], "ellipse-outline": [Circle], "contrast-outline": [CircleHalf], "square-outline": [Square],
  "chatbubble-ellipses-outline": [ChatCircleDots], "chatbox-ellipses-outline": [ChatTeardropDots],
  "contract-outline": [ArrowsIn], "expand-outline": [ArrowsOut], "apps-outline": [SquaresFour], "grid-outline": [SquaresFour],
  "list-outline": [List], "menu-outline": [List], "bulb-outline": [Lightbulb], "code-slash-outline": [Code], "cube-outline": [Cube],
  "headset-outline": [Headphones], "leaf-outline": [Leaf], "shield-outline": [ShieldCheck], "star-outline": [Star], star: [Star, "fill"],
};

export function Icon({ name, size = 22, color, style, weight }: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  weight?: IconWeight;
}) {
  const mapped = MAP[name];
  color ??= theme.colors.text;
  if (!mapped) return <Ionicons name={name} size={size} color={color} style={style} />;
  const [Glyph, defaultWeight = "regular"] = mapped;
  return <Glyph size={size} color={color} weight={weight ?? defaultWeight} style={style as never} />;
}
