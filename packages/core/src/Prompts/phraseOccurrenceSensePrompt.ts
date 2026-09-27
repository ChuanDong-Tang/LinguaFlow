export const PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION = "phrase_occurrence_sense_v1" as const;
export const PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION = "usage_meaning_v1" as const;
export const PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION = "phrase_occurrence_context_meaning_v2_1" as const;
export const PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION = "usage_meaning_v2" as const;
export const PHRASE_OCCURRENCE_MARKED_SENTENCE_REPRESENTATION_VERSION = "marked_sentence_v1" as const;
export type PhraseOccurrenceRepresentationVersion =
  | typeof PHRASE_OCCURRENCE_MARKED_SENTENCE_REPRESENTATION_VERSION
  | typeof PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION
  | typeof PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION;

export const PHRASE_OCCURRENCE_POLARITIES = ["affirmed", "negated", "neutral"] as const;
export const PHRASE_OCCURRENCE_MODALITIES = [
  "plain",
  "possible",
  "hypothetical",
  "ability",
  "desired",
  "required",
  "permitted",
  "neutral",
] as const;
export const PHRASE_OCCURRENCE_MEANING_KINDS = [
  "referent",
  "process",
  "property",
  "relation",
  "quantity",
  "temporal",
  "spatial",
  "discourse",
] as const;
export type PhraseOccurrencePolarity = typeof PHRASE_OCCURRENCE_POLARITIES[number];
export type PhraseOccurrenceModality = typeof PHRASE_OCCURRENCE_MODALITIES[number];
export type PhraseOccurrenceMeaningKind = typeof PHRASE_OCCURRENCE_MEANING_KINDS[number];

export interface PhraseOccurrenceContextMeaning {
  meaning: string;
  polarity: PhraseOccurrencePolarity;
  modality: PhraseOccurrenceModality;
  meaningKind: PhraseOccurrenceMeaningKind;
}

export interface PhraseOccurrenceSensePromptInput {
  languageCode: string;
  canonicalText: string;
  sentence: string;
  startUtf16: number;
  endUtf16: number;
}

export function buildPhraseOccurrenceSensePrompt(input: PhraseOccurrenceSensePromptInput): {
  systemPrompt: string;
  userPrompt: string;
  version: typeof PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION;
} {
  const selected = selectedPhrase(input);
  const markedSentence = `${input.sentence.slice(0, input.startUtf16)}<selected>${selected}</selected>${input.sentence.slice(input.endUtf16)}`
    .normalize("NFKC")
    .trim();
  return {
    version: PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION,
    systemPrompt: `You identify the exact meaning of one selected language-learning expression as used in its sentence.

Return a short English usage meaning that can be compared with meanings from other sentences.

Hard rules:
- Describe the selected expression's lexical sense, not the sentence topic or situation.
- Use 2 to 12 English words.
- Prefer a dictionary-like verb or phrase, such as "laugh uncontrollably" or "be suitable for".
- Do not translate or summarize the full sentence.
- Do not repeat the selected expression unless no clearer wording exists.
- Do not add examples, alternatives, punctuation commentary, markdown, or text outside the required tag.

Return exactly:
<meaning>short English usage meaning</meaning>`,
    userPrompt: `<language>${input.languageCode.trim()}</language>
<canonical>${input.canonicalText.normalize("NFKC").trim()}</canonical>
<sentence>${markedSentence}</sentence>`,
  };
}

export function phraseOccurrenceSensePromptHashInput(input: PhraseOccurrenceSensePromptInput): string {
  const prompt = buildPhraseOccurrenceSensePrompt(input);
  return `${prompt.version}\n${prompt.systemPrompt}\n${prompt.userPrompt}`;
}

export function buildPhraseOccurrenceContextMeaningPrompt(input: PhraseOccurrenceSensePromptInput): {
  systemPrompt: string;
  userPrompt: string;
  version: typeof PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION;
} {
  const selected = selectedPhrase(input);
  const markedSentence = `${input.sentence.slice(0, input.startUtf16)}<selected>${selected}</selected>${input.sentence.slice(input.endUtf16)}`
    .normalize("NFKC")
    .trim();
  return {
    version: PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
    systemPrompt: `You identify the reusable meaning of one selected language-learning expression as it actually functions in its full sentence.

Return one compact contextual meaning plus three semantic features. Account for operators whose scope includes the selected expression even when they are outside <selected>, including negation, modal verbs, conditionals, questions, and commands.

Hard rules:
- The meaning must describe what the selected expression contributes in this sentence after those operators apply.
- Keep the reusable expression meaning; omit names and topic details unless required to disambiguate the sense.
- Use 2 to 16 English words for meaning.
- polarity must be exactly one of: affirmed, negated, neutral.
- Use affirmed when the expression's proposition or property applies, negated when it is denied or reversed, and neutral for non-propositional labels such as noun phrases.
- modality must be exactly one of: plain, possible, hypothetical, ability, desired, required, permitted, neutral.
- Modality describes an external operator governing the selected expression, not meaning already lexicalized inside the selected expression. Use neutral for non-propositional labels.
- meaning_kind must be exactly one of: referent, process, property, relation, quantity, temporal, spatial, discourse.
- Use referent for a person, thing, or place being named; process for an action, event, experience, or state; property for a quality or evaluation; relation for a comparison, fit, correspondence, or connection; and the remaining values for their literal functions.
- Do not add examples, alternatives, markdown, or text outside the required tags.

Return exactly:
<meaning>short contextual usage meaning</meaning>
<polarity>one allowed value</polarity>
<modality>one allowed value</modality>
<meaning_kind>one allowed value</meaning_kind>`,
    userPrompt: `<language>${input.languageCode.trim()}</language>
<canonical>${input.canonicalText.normalize("NFKC").trim()}</canonical>
<sentence>${markedSentence}</sentence>`,
  };
}

export function phraseOccurrenceContextMeaningPromptHashInput(input: PhraseOccurrenceSensePromptInput): string {
  const prompt = buildPhraseOccurrenceContextMeaningPrompt(input);
  return `${prompt.version}\n${prompt.systemPrompt}\n${prompt.userPrompt}`;
}

export function parsePhraseOccurrenceContextMeaningOutput(output: string): PhraseOccurrenceContextMeaning {
  const meaning = taggedValue(output, "meaning");
  if (!meaning) throw senseError("PHRASE_OCCURRENCE_CONTEXT_MEANING_EMPTY");
  const wordCount = meaning.split(/\s+/u).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 16 || Array.from(meaning).length > 160) {
    throw senseError("PHRASE_OCCURRENCE_CONTEXT_MEANING_INVALID_LENGTH");
  }
  const polarity = taggedValue(output, "polarity");
  if (!PHRASE_OCCURRENCE_POLARITIES.includes(polarity as PhraseOccurrencePolarity)) {
    throw senseError("PHRASE_OCCURRENCE_CONTEXT_POLARITY_INVALID");
  }
  const modality = taggedValue(output, "modality");
  if (!PHRASE_OCCURRENCE_MODALITIES.includes(modality as PhraseOccurrenceModality)) {
    throw senseError("PHRASE_OCCURRENCE_CONTEXT_MODALITY_INVALID");
  }
  const meaningKind = normalizeMeaningKind(taggedValue(output, "meaning_kind"));
  if (!meaningKind) {
    throw senseError("PHRASE_OCCURRENCE_CONTEXT_MEANING_KIND_INVALID");
  }
  if (/[<>]/u.test(meaning)) throw senseError("PHRASE_OCCURRENCE_CONTEXT_MEANING_INVALID_MARKUP");
  return {
    meaning,
    polarity: polarity as PhraseOccurrencePolarity,
    modality: modality as PhraseOccurrenceModality,
    meaningKind,
  };
}

export function buildPhraseOccurrenceContextMeaningEmbeddingInput(value: PhraseOccurrenceContextMeaning): string {
  return [
    `contextual usage meaning: ${value.meaning}`,
    `polarity: ${value.polarity}`,
    `external modality: ${value.modality}`,
    `meaning kind: ${value.meaningKind}`,
  ].join("\n");
}

export function parsePhraseOccurrenceSenseOutput(output: string): string {
  const meaning = /<meaning>\s*([\s\S]*?)\s*<\/meaning>/iu.exec(output)?.[1]
    ?.normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim() ?? "";
  if (!meaning) throw senseError("PHRASE_OCCURRENCE_SENSE_EMPTY");
  const wordCount = meaning.split(/\s+/u).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 12 || Array.from(meaning).length > 120) {
    throw senseError("PHRASE_OCCURRENCE_SENSE_INVALID_LENGTH");
  }
  if (/[<>]/u.test(meaning)) throw senseError("PHRASE_OCCURRENCE_SENSE_INVALID_MARKUP");
  return meaning;
}

export function buildPhraseOccurrenceSenseEmbeddingInput(meaning: string): string {
  const normalized = meaning.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) throw senseError("PHRASE_OCCURRENCE_SENSE_EMPTY");
  return `usage meaning: ${normalized}`;
}

function selectedPhrase(input: PhraseOccurrenceSensePromptInput): string {
  if (!Number.isInteger(input.startUtf16) || !Number.isInteger(input.endUtf16)
    || input.startUtf16 < 0 || input.endUtf16 <= input.startUtf16 || input.endUtf16 > input.sentence.length) {
    throw senseError("PHRASE_OCCURRENCE_SENSE_RANGE_INVALID");
  }
  const sentence = input.sentence.normalize("NFKC").trim();
  const canonical = input.canonicalText.normalize("NFKC").trim();
  if (!sentence || !canonical) throw senseError("PHRASE_OCCURRENCE_SENSE_INPUT_EMPTY");
  return input.sentence.slice(input.startUtf16, input.endUtf16);
}

function taggedValue(output: string, tag: string): string {
  return new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "iu").exec(output)?.[1]
    ?.normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim() ?? "";
}

function normalizeMeaningKind(value: string): PhraseOccurrenceMeaningKind | null {
  const normalized = value.toLocaleLowerCase().replace(/[\s-]+/gu, "_");
  if (PHRASE_OCCURRENCE_MEANING_KINDS.includes(normalized as PhraseOccurrenceMeaningKind)) {
    return normalized as PhraseOccurrenceMeaningKind;
  }
  const aliases: Record<string, PhraseOccurrenceMeaningKind> = {
    entity: "referent",
    person: "referent",
    thing: "referent",
    place: "referent",
    object: "referent",
    concept: "referent",
    action: "process",
    event: "process",
    experience: "process",
    state: "process",
    quality: "property",
    evaluation: "property",
    comparison: "relation",
    connection: "relation",
    correspondence: "relation",
    fit: "relation",
    amount: "quantity",
    number: "quantity",
    time: "temporal",
    location: "spatial",
    direction: "spatial",
    connector: "discourse",
    discourse_function: "discourse",
  };
  return aliases[normalized] ?? null;
}

function senseError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
