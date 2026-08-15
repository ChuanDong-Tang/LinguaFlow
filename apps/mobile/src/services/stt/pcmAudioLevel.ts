export function calculatePcmAudioLevel(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < pcm.length; index += 1) {
    const normalized = pcm[index] / 32768;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
  }
  const rms = Math.sqrt(sumSquares / pcm.length);
  const signal = Math.max(rms, peak * 0.3);
  if (signal < 0.001) return 0;
  return Math.min(1, Math.log1p(signal * 120) / Math.log1p(12));
}
