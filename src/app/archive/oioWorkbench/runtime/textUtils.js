const WHITELIST_PHRASE_PATTERNS = [
  /\bPh\.D\.\b/gi,
  /\bM\.D\.\b/gi,
  /\bB\.A\.\b/gi,
  /\bM\.A\.\b/gi,
  /\bM\.B\.A\.\b/gi,
  /\bU\.S\.A\.\b/gi,
  /\bU\.S\.\b/gi,
  /\bU\.K\.\b/gi,
  /\bE\.U\.\b/gi,
  /\bU\.N\.\b/gi,
  /\be\.g\.\b/gi,
  /\bi\.e\.\b/gi,
  /\bet al\.\b/gi,
  /\ba\.m\.\b/gi,
  /\bp\.m\.\b/gi,
  /\bNo\.\b/gi,
  /\bFig\.\b/gi,
  /\bVol\.\b/gi,
  /\bpp\.\b/gi,
  /\bapprox\.\b/gi,
  /\bca\.\b/gi,
];

const ABBREV_END =
  /(?:^|[\s"'(])(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sr|Jr|St|Mt|Ft|vs|etc|Inc|Ltd|Corp|Co|Rep|Sen|Gov|Lt|Capt|Sgt|Col|Gen|Rev|Hon|Pres|Dist|Ave|Rd|Blvd|Ste|Dept|Vol|Fig|pp|ca|approx|No)\.$/i;

export function splitSentences(text) {
  const t = text.trim();
  if (!t) return [];

  const { masked, phraseBucket, decimalBucket } = maskPhrasesAndDecimals(t);

  let rawParts;
  if (typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
      rawParts = [];
      for (const seg of segmenter.segment(masked)) {
        const s = seg.segment.trim();
        if (s) rawParts.push(s);
      }
    } catch {
      rawParts = null;
    }
  }

  if (!rawParts || rawParts.length === 0) {
    rawParts = splitSentencesByPunctuation(masked);
  }

  const parts = rawParts.map((s) => unmaskPhrasesAndDecimals(s, phraseBucket, decimalBucket));
  return mergeAbbreviationChunks(parts);
}

function maskPhrasesAndDecimals(text) {
  const phraseBucket = [];
  let s = text;
  for (const re of WHITELIST_PHRASE_PATTERNS) {
    s = s.replace(re, (match) => {
      phraseBucket.push(match);
      return `\uE010${phraseBucket.length - 1}\uE011`;
    });
  }

  const decimalBucket = [];
  s = s.replace(/\b\d+\.\d+\b/g, (m) => {
    decimalBucket.push(m);
    return `\uE000${decimalBucket.length - 1}\uE001`;
  });

  return { masked: s, phraseBucket, decimalBucket };
}

function unmaskPhrasesAndDecimals(segment, phraseBucket, decimalBucket) {
  let out = segment.replace(/\uE010(\d+)\uE011/g, (_, i) => phraseBucket[Number(i)] ?? "");
  out = out.replace(/\uE000(\d+)\uE001/g, (_, i) => decimalBucket[Number(i)] ?? "");
  return out;
}

function splitSentencesByPunctuation(masked) {
  const re = /[^\n.!?…]+[.!?…]+(?:\s+|$)/gu;
  const out = [];
  let lastIndex = 0;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const chunk = m[0].trim();
    if (chunk) out.push(chunk);
    lastIndex = re.lastIndex;
  }
  const tail = masked.slice(lastIndex).trim();
  if (tail) out.push(tail);
  return out;
}

function mergeAbbreviationChunks(parts) {
  if (parts.length <= 1) return parts;
  const out = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prev = out[out.length - 1];
    if (ABBREV_END.test(prev.trimEnd())) {
      out[out.length - 1] = `${prev} ${parts[i]}`;
    } else {
      out.push(parts[i]);
    }
  }
  return out;
}

export function tokenizeWords(s) {
  return String(s).trim().split(/\s+/).filter(Boolean);
}

export function normFillToken(w) {
  return w
    .replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, "")
    .toLowerCase();
}

export function normFillAnswer(s) {
  return normFillToken(String(s).trim());
}

export function formatClockSec(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
