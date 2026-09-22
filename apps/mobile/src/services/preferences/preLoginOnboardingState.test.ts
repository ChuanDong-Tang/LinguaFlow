import assert from "node:assert/strict";
import test from "node:test";
import {
  accountOnboardingKey,
  isCompletePreLoginOnboardingDraft,
  normalizePreLoginOnboardingState,
  resolvePreLoginOnboardingLaunch,
} from "./preLoginOnboardingState";

test("local onboarding draft is keyed to one authenticated account", () => {
  assert.notEqual(accountOnboardingKey("onboarding", "user-a"), accountOnboardingKey("onboarding", "user-b"));
  assert.throws(() => accountOnboardingKey("onboarding", ""));
});

test("requires all four explicit onboarding choices", () => {
  assert.equal(isCompletePreLoginOnboardingDraft({
    appLocale: "zh-CN",
    learningLanguage: "en-US",
    promptDifficulty: "native",
  }), false);
  assert.equal(isCompletePreLoginOnboardingDraft({
    appLocale: "zh-CN",
    learningLanguage: "en-US",
    promptDifficulty: "native",
    acquisitionSource: "xiaohongshu",
  }), true);
});

test("uses remote account completion over a stale local draft", () => {
  assert.equal(resolvePreLoginOnboardingLaunch({ accountCompleted: false, state: null }), "begin");
  assert.equal(resolvePreLoginOnboardingLaunch({ accountCompleted: true, state: null }), "skip");
  assert.equal(resolvePreLoginOnboardingLaunch({
    accountCompleted: false,
    state: {
      version: 1,
      status: "in_progress",
      step: 2,
      draft: { appLocale: "zh-CN", learningLanguage: "en-US" },
      pendingSync: false,
      completedAt: null,
    },
  }), "resume");
  assert.equal(resolvePreLoginOnboardingLaunch({
    accountCompleted: true,
    state: {
      version: 1,
      status: "in_progress",
      step: 2,
      draft: {},
      pendingSync: false,
      completedAt: null,
    },
  }), "skip");
});

test("rejects a completed state with missing or invalid choices", () => {
  assert.equal(normalizePreLoginOnboardingState({
    version: 1,
    status: "completed",
    step: 3,
    draft: {
      appLocale: "zh-CN",
      learningLanguage: "en-US",
      promptDifficulty: "native",
      acquisitionSource: "unknown",
    },
    pendingSync: true,
  }), null);
});

test("keeps valid in-progress state and clamps an invalid step", () => {
  const state = normalizePreLoginOnboardingState({
    version: 1,
    status: "in_progress",
    step: 99,
    draft: { appLocale: "en-US" },
    pendingSync: false,
  });
  assert.equal(state?.step, 0);
  assert.deepEqual(state?.draft, { appLocale: "en-US" });
});
