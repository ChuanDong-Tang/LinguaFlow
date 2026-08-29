import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";

// A short, quiet rising tone stored as PCM WAV so feedback never depends on the network.
const SUCCESS_WAV_BASE64 = "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";

let activePlayer: AudioPlayer | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

export async function playSuccessFeedbackSound(): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" });
  const file = new File(Paths.cache, "memory-success-feedback.wav");
  if (!file.exists) file.write(decodeBase64(SUCCESS_WAV_BASE64));

  cleanupPlayer();
  const player = createAudioPlayer({ uri: file.uri });
  activePlayer = player;
  player.volume = 0.42;
  player.play();
  cleanupTimer = setTimeout(cleanupPlayer, 700);
}

export async function playIncorrectFeedbackSound(): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" });
  const file = new File(Paths.cache, "practice-incorrect-feedback.wav");
  if (!file.exists) file.write(createDescendingToneWav());

  cleanupPlayer();
  const player = createAudioPlayer({ uri: file.uri });
  activePlayer = player;
  player.volume = 0.34;
  player.play();
  cleanupTimer = setTimeout(cleanupPlayer, 520);
}

function cleanupPlayer(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = null;
  try { activePlayer?.remove(); } catch { /* Player may already be released. */ }
  activePlayer = null;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = globalThis.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function createDescendingToneWav(): Uint8Array {
  const sampleRate = 16_000;
  const durationSeconds = 0.28;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    const frequency = 330 - progress * 120;
    const envelope = Math.sin(Math.PI * progress) * 0.34;
    const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * envelope;
    view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
  }
  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
