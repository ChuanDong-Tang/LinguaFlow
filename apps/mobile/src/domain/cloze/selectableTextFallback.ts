export type SelectableTextRange = {
  start: number;
  end: number;
};

export type SelectableTextHighlightRange = SelectableTextRange & {
  groupIndex: number;
};

export type SelectableTextAnswerRange = SelectableTextRange & {
  text: string;
  incorrect?: boolean;
};

export type SelectableTextFallbackSegment = {
  key: string;
  text: string;
  hidden: boolean;
  highlighted: boolean;
  correct: boolean;
  blank: boolean;
  groupIndex?: number;
};

export function buildSelectableTextFallbackSegments({
  text,
  highlights,
  blanks,
  correct,
  answers,
  answersVisible,
}: {
  text: string;
  highlights: SelectableTextHighlightRange[];
  blanks: SelectableTextRange[];
  correct: SelectableTextRange[];
  answers: SelectableTextAnswerRange[];
  answersVisible: boolean;
}): SelectableTextFallbackSegment[] {
  const boundaries = new Set([0, text.length]);
  for (const range of [...highlights, ...blanks, ...correct, ...answers]) {
    boundaries.add(Math.max(0, Math.min(range.start, text.length)));
    boundaries.add(Math.max(0, Math.min(range.end, text.length)));
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.slice(0, -1).flatMap((start, index) => {
    const end = ordered[index + 1];
    if (start >= end) return [];
    const highlight = highlights.find((range) => range.start <= start && range.end >= end);
    const blank = blanks.find((range) => range.start <= start && range.end >= end);
    const mastered = correct.some((range) => range.start <= start && range.end >= end);
    const answer = answers.find((range) => range.start === start && range.end === end);
    return [{
      key: `${start}:${end}`,
      text: answer?.text || text.slice(start, end),
      hidden: !!blank && !answersVisible && !answer,
      highlighted: !!highlight,
      correct: mastered,
      blank: !!blank,
      groupIndex: highlight?.groupIndex,
    }];
  });
}
