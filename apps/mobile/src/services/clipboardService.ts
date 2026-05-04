import * as Clipboard from "expo-clipboard";

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;

  await Clipboard.setStringAsync(value);
  return true;
}
