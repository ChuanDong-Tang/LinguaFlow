import { requestPracticeFeedbackWithTargetPhrase, requestPracticeQuestion } from "../rewrite/rewriteClient";

export interface PracticeQuestionResult {
  question: string;
  usageDailyUsed?: number;
  usageDailyLimit?: number;
}

export interface PracticeFeedbackResult {
  isAlreadyNatural: boolean;
  rewrittenAnswer: string;
  feedback: string;
  usageDailyUsed?: number;
  usageDailyLimit?: number;
}

export async function generatePracticeQuestion({
  contextText,
  targetPhrase,
}: {
  contextText: string;
  targetPhrase: string;
}): Promise<PracticeQuestionResult> {
  const payload = await requestPracticeQuestion(contextText, targetPhrase);
  return {
    question: payload.question.trim(),
    usageDailyUsed: typeof payload.usage?.daily_used === "number" ? payload.usage.daily_used : undefined,
    usageDailyLimit: typeof payload.usage?.daily_limit === "number" ? payload.usage.daily_limit : undefined,
  };
}

export async function generatePracticeFeedback({
  question,
  answer,
  targetPhrase,
  referenceAnswer,
}: {
  question: string;
  answer: string;
  targetPhrase: string;
  referenceAnswer?: string;
}): Promise<PracticeFeedbackResult> {
  const payload = await requestPracticeFeedbackWithTargetPhrase(question, answer, targetPhrase, referenceAnswer);
  return {
    isAlreadyNatural: payload.is_already_natural,
    rewrittenAnswer: payload.rewritten_answer.trim(),
    feedback: payload.feedback.trim(),
    usageDailyUsed: typeof payload.usage?.daily_used === "number" ? payload.usage.daily_used : undefined,
    usageDailyLimit: typeof payload.usage?.daily_limit === "number" ? payload.usage.daily_limit : undefined,
  };
}
