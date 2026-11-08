import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";

// Game feedback sounds (skills/linguaflow-interaction-feel): soft and short, so
// they reward without startling. All synthesized as PCM WAV — no network, no
// third-party sound assets. Bump the file version when a waveform changes.

const SAMPLE_RATE = 22_050;

let activePlayer: AudioPlayer | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/** Correct answer: a bright two-note chime going up (like a small "ding-ding"). */
export function playSuccessFeedbackSound(): Promise<void> {
  return play("cloze-success-v3.wav", createChimeWav, 0.5, 700);
}

/** Wrong answer: a gentle two-note fall, low and soft — "not quite". */
export function playIncorrectFeedbackSound(): Promise<void> {
  return play("cloze-incorrect-v3.wav", createSoftFallWav, 0.42, 600);
}

/** Placing or removing a word: a tiny wooden "pop". */
export function playSelectionFeedbackSound(): Promise<void> {
  return play("cloze-tap-v3.wav", createPopWav, 0.32, 160);
}

async function play(fileName: string, create: () => Uint8Array, volume: number, holdMs: number): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" });
  const file = new File(Paths.cache, fileName);
  if (!file.exists) file.write(create());
  cleanupPlayer();
  const player = createAudioPlayer({ uri: file.uri });
  activePlayer = player;
  player.volume = volume;
  player.play();
  cleanupTimer = setTimeout(cleanupPlayer, holdMs);
}

function cleanupPlayer(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = null;
  try { activePlayer?.remove(); } catch { /* Player may already be released. */ }
  activePlayer = null;
}

/** Bell-like note: quick attack, exponential decay, a soft octave partial. */
function bell(time: number, start: number, frequency: number, decay: number, gain: number): number {
  const t = time - start;
  if (t < 0) return 0;
  const attack = Math.min(1, t / 0.004);
  const envelope = attack * Math.exp(-t * decay);
  return gain * envelope * (Math.sin(2 * Math.PI * frequency * t) + 0.28 * Math.sin(2 * Math.PI * frequency * 2 * t) + 0.08 * Math.sin(2 * Math.PI * frequency * 3 * t));
}

function createChimeWav(): Uint8Array {
  return synthesize(0.62, (time) => bell(time, 0, 880, 9, 0.42) + bell(time, 0.11, 1318.5, 7, 0.46));
}

function createSoftFallWav(): Uint8Array {
  return synthesize(0.5, (time) => {
    const note = (start: number, frequency: number) => {
      const t = time - start;
      if (t < 0) return 0;
      const envelope = Math.min(1, t / 0.012) * Math.exp(-t * 7);
      // Rounded tone (sine + a little third harmonic) reads warmer than a buzz.
      return envelope * (Math.sin(2 * Math.PI * frequency * t) + 0.12 * Math.sin(2 * Math.PI * frequency * 3 * t));
    };
    return 0.4 * (note(0, 349.2) + note(0.14, 261.6));
  });
}

function createPopWav(): Uint8Array {
  return synthesize(0.07, (time) => {
    const frequency = 720 - 260 * Math.min(1, time / 0.03);
    const envelope = Math.min(1, time / 0.002) * Math.exp(-time * 70);
    return 0.5 * envelope * Math.sin(2 * Math.PI * frequency * time);
  });
}

function synthesize(durationSeconds: number, sampleAt: (time: number) => number): Uint8Array {
  const sampleCount = Math.floor(SAMPLE_RATE * durationSeconds);
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const fadeOut = Math.floor(SAMPLE_RATE * 0.01);
  for (let index = 0; index < sampleCount; index += 1) {
    const tail = Math.min(1, (sampleCount - index) / fadeOut);
    const sample = Math.max(-1, Math.min(1, sampleAt(index / SAMPLE_RATE) * tail));
    view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
  }
  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
