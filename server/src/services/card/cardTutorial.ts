import type { AppLocale } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { CardRecordDetailView } from "@lf/core/types/cardRecord.js";

export const TUTORIAL_CLIENT_ID = "sample:tutorial:v1";
const sentences = {
  "en-US": [
    "This is a Card, where your everyday thoughts become learning material.",
    "Switch to playback mode to listen to each sentence.",
    "Try the blanks in this teaching Card to practice useful expressions.",
    "On this Card or your own Cards, long-press a word or phrase in the learning text, select the part you want to remember, and choose “Blank out”.",
    "Automatic blanks are enabled by default, so new learning content comes with selected expressions to practice.",
    "To change how often blanks appear, open language settings, then advanced learning settings, and adjust the automatic blank frequency.",
    "Low selects about one expression every three sentences, medium every two sentences, and high every sentence; you can also turn automatic blanks off.",
    "Record something of your own, and build your collection one Card at a time."
  ],
  "ja-JP": [
    "これはCardで、日々の思いが学習素材になります。",
    "再生モードに切り替えると、一文ずつ聞けます。",
    "このチュートリアルCardの穴埋めで、役立つ表現を練習してみましょう。",
    "このCardでも自分のCardでも、学習テキストの単語やフレーズを長押しし、覚えたい部分を選んで穴埋めにできます。",
    "自動穴埋めは初期設定でオンになっており、新しく生成された学習内容から練習する表現が選ばれます。",
    "穴埋めの頻度は、言語設定の学習詳細設定から、自動穴埋めの頻度を変更できます。",
    "低頻度では約3文に1つ、中頻度では約2文に1つ、高頻度では約1文に1つの表現が選ばれ、自動穴埋めをオフにすることもできます。",
    "自分の言葉を記録して、Cardを一枚ずつ増やしましょう。"
  ],
  "zh-CN": [
    "这是一张 Card，你的日常想法可以变成学习资料。",
    "切换到播放模式，就可以逐句听。",
    "这张教学卡片已经准备了示范空格，你可以试着填空，练习实用表达。",
    "在这张教学卡片或你自己的 Card 中，长按学习内容里的单词或短语，选中想记住的部分，再点「挖空」，就能添加自己的填空练习。",
    "自动挖空默认开启，新生成的学习内容会自动选出一些值得练习的表达。",
    "想调整自动挖空的频率，可以打开「语言设置」里的「学习高级设置」，在「自动挖空」下调整「挖空频率」。",
    "低频大约每 3 句选择 1 个表达，中频大约每 2 句选择 1 个，高频大约每句选择 1 个；你也可以关闭自动挖空。",
    "记录自己的内容，让 Card 一张张积累起来。"
  ],
  "zh-TW": [
    "這是一張 Card，你的日常想法可以變成學習資料。",
    "切換到播放模式，就可以逐句聽。",
    "這張教學卡片已經準備了示範空格，你可以試著填空，練習實用表達。",
    "在這張教學卡片或你自己的 Card 中，長按學習內容裡的單字或片語，選取想記住的部分，再點「挖空」，就能新增自己的填空練習。",
    "自動挖空預設開啟，新產生的學習內容會自動選出一些值得練習的表達。",
    "想調整自動挖空的頻率，可以開啟「語言設定」裡的「學習進階設定」，在「自動挖空」下調整「挖空頻率」。",
    "低頻大約每 3 句選擇 1 個表達，中頻大約每 2 句選擇 1 個，高頻大約每句選擇 1 個；你也可以關閉自動挖空。",
    "記錄自己的內容，讓 Card 一張張累積起來。"
  ]
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

// Cloud template only; clients keep tutorial practice changes in account-scoped local storage.
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
