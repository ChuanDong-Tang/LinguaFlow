import { isAcquisitionSource, type AcquisitionSource } from "@lf/core/ports/repository/UserPreferenceRepository";
import type { AppLocale, LearningLanguage, PromptDifficulty } from "../api/meApi";

export type PreLoginOnboardingStep = 0 | 1 | 2 | 3;

export type PreLoginOnboardingDraft = {
  appLocale?: AppLocale;
  learningLanguage?: LearningLanguage;
  promptDifficulty?: PromptDifficulty;
  acquisitionSource?: AcquisitionSource;
};

export type PreLoginOnboardingState = {
  version: 1;
  status: "in_progress" | "completed";
  step: PreLoginOnboardingStep;
  draft: PreLoginOnboardingDraft;
  pendingSync: boolean;
  completedAt: string | null;
};

export function resolvePreLoginOnboardingLaunch(input: {
  isFreshInstall: boolean;
  state: PreLoginOnboardingState | null;
}): "begin" | "resume" | "skip" {
  if (input.state?.status === "in_progress") return "resume";
  if (input.state?.status === "completed") return "skip";
  return input.isFreshInstall ? "begin" : "skip";
}

export function isCompletePreLoginOnboardingDraft(
  draft: PreLoginOnboardingDraft,
): draft is Required<PreLoginOnboardingDraft> {
  return Boolean(
    draft.appLocale &&
    draft.learningLanguage &&
    draft.promptDifficulty &&
    draft.acquisitionSource,
  );
}

export function normalizePreLoginOnboardingState(value: unknown): PreLoginOnboardingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || (input.status !== "in_progress" && input.status !== "completed")) return null;
  const step = normalizeStep(input.step);
  const draft = normalizeDraft(input.draft);
  if (input.status === "completed" && !isCompletePreLoginOnboardingDraft(draft)) return null;
  return {
    version: 1,
    status: input.status,
    step,
    draft,
    pendingSync: input.pendingSync === true,
    completedAt: typeof input.completedAt === "string" ? input.completedAt : null,
  };
}

function normalizeStep(value: unknown): PreLoginOnboardingStep {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

function normalizeDraft(value: unknown): PreLoginOnboardingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(isAppLocale(input.appLocale) ? { appLocale: input.appLocale } : {}),
    ...(isLearningLanguage(input.learningLanguage) ? { learningLanguage: input.learningLanguage } : {}),
    ...(isPromptDifficulty(input.promptDifficulty) ? { promptDifficulty: input.promptDifficulty } : {}),
    ...(isAcquisitionSource(input.acquisitionSource) ? { acquisitionSource: input.acquisitionSource } : {}),
  };
}

function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "zh-TW" || value === "en-US" || value === "ja-JP";
}

function isLearningLanguage(value: unknown): value is LearningLanguage {
  return value === "en-US" || value === "ja-JP";
}

function isPromptDifficulty(value: unknown): value is PromptDifficulty {
  return value === "simple" || value === "native";
}
