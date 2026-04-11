import { requestPracticeFeedback } from "../rewrite/rewriteClient";

export interface PracticeFeedbackResult {
  isAlreadyNatural: boolean;
  rewrittenAnswer: string;
  feedback: string;
  usageDailyUsed?: number;
  usageDailyLimit?: number;
}

export async function generatePracticeFeedback({
  question,
  answer,
  referenceAnswer,
}: {
  question: string;
  answer: string;
  referenceAnswer?: string;
}): Promise<PracticeFeedbackResult> {
  const payload = await requestPracticeFeedback(question, answer, referenceAnswer);
  return {
    isAlreadyNatural: payload.is_already_natural,
    rewrittenAnswer: payload.rewritten_answer.trim(),
    feedback: payload.feedback.trim(),
    usageDailyUsed: typeof payload.usage?.daily_used === "number" ? payload.usage.daily_used : undefined,
    usageDailyLimit: typeof payload.usage?.daily_limit === "number" ? payload.usage.daily_limit : undefined,
  };
}
