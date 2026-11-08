// Deterministic hand-drawn path generators (see skills/linguaflow-sketch-style).
// Pure functions: the same seed and size always produce the same path, so an
// outline never jitters between renders. Never use Math.random() here.

export type SketchPath = { d: string; length: number };
type Point = [number, number];

export function sketchSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 2147483645) + 1;
}

function random(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function smooth(points: Point[]): SketchPath {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  let length = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
    length += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  }
  return { d, length: Math.ceil(length * 1.04) };
}

function perimeter(w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  type Segment = { len: number; at: (t: number) => Point };
  const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({
    len: Math.hypot(x2 - x1, y2 - y1),
    at: (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t],
  });
  const arc = (cx: number, cy: number, a0: number): Segment => ({
    len: (Math.PI * r) / 2,
    at: (t) => {
      const a = a0 + (t * Math.PI) / 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    },
  });
  const segments = [
    line(r, 0, w - r, 0), arc(w - r, r, -Math.PI / 2),
    line(w, r, w, h - r), arc(w - r, h - r, 0),
    line(w - r, h, r, h), arc(r, h - r, Math.PI / 2),
    line(0, h - r, 0, r), arc(r, r, Math.PI),
  ];
  const total = segments.reduce((sum, segment) => sum + segment.len, 0);
  return {
    total,
    at(distance: number): Point {
      let s = ((distance % total) + total) % total;
      for (const segment of segments) {
        if (s <= segment.len) return segment.at(segment.len ? s / segment.len : 0);
        s -= segment.len;
      }
      return segments[0].at(0);
    },
  };
}

/** Rounded rectangle drawn in one stroke that slightly overshoots its start. */
export function wobbleRect(w: number, h: number, radius: number, seed: number, amplitude = 1.3, overshoot = 0.05): SketchPath {
  const rnd = random(seed);
  const shape = perimeter(w, h, radius);
  const count = Math.max(12, Math.round(shape.total / 15));
  const start = rnd() * shape.total;
  const phase = rnd() * 6;
  const points: Point[] = [];
  for (let i = 0; i <= Math.round(count * (1 + overshoot)); i += 1) {
    const [x, y] = shape.at(start + (i / count) * shape.total);
    points.push([
      x + amplitude * (Math.sin(i * 0.55 + phase) * 0.55 + (rnd() - 0.5) * 0.7),
      y + amplitude * (Math.cos(i * 0.47 + phase) * 0.55 + (rnd() - 0.5) * 0.7),
    ]);
  }
  return smooth(points);
}

/** Loose ellipse; turns > 1 gives the "circled it with a pen" look. */
export function wobbleEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, turns = 1.06, amplitude = 0.6): SketchPath {
  const rnd = random(seed);
  const count = Math.round(30 * turns);
  const a0 = rnd() * Math.PI * 2;
  const points: Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const a = a0 + (i / count) * turns * Math.PI * 2;
    const grow = 1 + (i / count) * 0.04 * turns;
    const jitter = 1 + (rnd() - 0.5) * 0.05 * amplitude;
    points.push([cx + rx * grow * jitter * Math.cos(a), cy + ry * grow * jitter * Math.sin(a)]);
  }
  return smooth(points);
}

/** Wavy pen underline across a width at height y. */
export function wave(w: number, y: number, seed: number, amplitude = 1.4): SketchPath {
  const rnd = random(seed);
  const points: Point[] = [];
  for (let x = -2; x <= w + 3; x += 8) points.push([x, y + Math.sin(x * 0.28 + seed) * amplitude + (rnd() - 0.5) * 1.2]);
  return smooth(points);
}

/** Pen check mark inside a size×size box. */
export function checkMark(size: number, seed: number): SketchPath {
  const rnd = random(seed);
  const j = () => (rnd() - 0.5) * size * 0.04;
  return smooth([[size * 0.18 + j(), size * 0.55 + j()], [size * 0.42 + j(), size * 0.78 + j()], [size * 0.84 + j(), size * 0.24 + j()]]);
}
