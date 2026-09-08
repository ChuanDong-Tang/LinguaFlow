import type { AppLocale } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { CardRecordDetailView } from "@lf/core/types/cardRecord.js";

export const TUTORIAL_CLIENT_ID = "sample:tutorial:v1";
const sentences = {
  "en-US": ["This is a Card, where your everyday thoughts become learning material.", "Switch to playback mode to listen to each sentence.", "Try the blanks to practice useful expressions.", "Record something of your own, and build your collection one Card at a time."],
  "ja-JP": ["これはCardで、日々の思いが学習素材になります。", "再生モードに切り替えると、一文ずつ聞けます。", "穴埋めで、役立つ表現を練習してみましょう。", "自分の言葉を記録して、Cardを一枚ずつ増やしましょう。"],
  "zh-CN": ["这是一张 Card，你的日常想法可以变成学习资料。", "切换到播放模式，就可以逐句听。", "试试填空，练习实用表达。", "记录自己的内容，让 Card 一张张积累起来。"],
  "zh-TW": ["這是一張 Card，你的日常想法可以變成學習資料。", "切換到播放模式，就可以逐句聽。", "試試填空，練習實用表達。", "記錄自己的內容，讓 Card 一張張累積起來。"],
};
export function tutorialContent(languageCode: string, locale: AppLocale) {
  if (languageCode !== "en-US" && languageCode !== "ja-JP") throw new Error("CARD_LANGUAGE_UNSUPPORTED");
  const target = sentences[languageCode];
  const auxiliary = sentences[locale];
  return {
    text: target.join("\n"),
    title: locale === "en-US" ? "This is a Card" : locale === "ja-JP" ? "これはCardです" : locale === "zh-TW" ? "這是一張 Card" : "这是一张 Card",
    auxiliary: auxiliary.map((text, ordinal) => ({ text, ordinal })),
  };
}

// Demo state is reconstructed on every detail load; no learning records are written.
export function tutorialPractice(segments: CardRecordDetailView["rewriteSegments"], languageCode: string): NonNullable<CardRecordDetailView["practice"]> {
  const answers = languageCode === "ja-JP" ? ["再生モード", "役立つ表現"] : ["playback mode", "useful expressions"];
  const blanks = answers.flatMap((answer, index) => {
    const segment = segments.find((row) => row.text.includes(answer));
    if (!segment) return [];
    const start = segment.text.indexOf(answer);
    return [{ id: `tutorial-blank-${index}`, segmentId: segment.id, startUtf16: start, endUtf16: start + answer.length, answer }];
  });
  return {
    hasCloze: Boolean(blanks.length), dictationCompleted: false, nextReviewAt: null,
    clozeVersion: 0, clozeLastResult: null, dictationLastResult: null,
    clozeState: { schemaVersion: 1, blanks },
  };
}
