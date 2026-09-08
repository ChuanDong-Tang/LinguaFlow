import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CardClozeState, CardRecordDetail, saveCardClozeUpdate } from "../api/cardApi";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";

type Practice = NonNullable<CardRecordDetail["practice"]>;
type Update = Parameters<typeof saveCardClozeUpdate>[1];
type Block = CardRecordDetail["contentBlocks"][number];
const writes = new Map<string, Promise<unknown>>();

async function storageKey(detail: CardRecordDetail, block: Block): Promise<string> {
  const session = await getSession();
  if (!session?.user.id) throw new Error("Sign in to practice");
  return environmentStorageKey(`lf_tutorial_practice_v1:${session.user.id}:${detail.id}:${block.contentType}:${block.contentVersion}`);
}

async function load(key: string, fallback: Practice): Promise<Practice> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Practice;
    const state = value.clozeState as CardClozeState;
    if (state?.schemaVersion === 1 && Array.isArray(state.blanks) && Number.isInteger(value.clozeVersion)) return value;
  } catch { /* Discard unreadable local data and use the template. */ }
  return fallback;
}

export async function loadTutorialPractice(detail: CardRecordDetail): Promise<CardRecordDetail> {
  if (!detail.isSample) return detail;
  const contentBlocks = await Promise.all(detail.contentBlocks.map(async (block) => {
    if (!block.practice) return block;
    return { ...block, practice: await load(await storageKey(detail, block), block.practice) };
  }));
  return { ...detail, contentBlocks };
}

export async function saveTutorialPractice(detail: CardRecordDetail, input: Update): Promise<Practice> {
  const block = detail.contentBlocks.find((item) => item.contentType === (input.contentType ?? "rewrite"));
  if (!detail.isSample || !block?.practice || (input.contentVersion && input.contentVersion !== block.contentVersion)) {
    throw new Error("Tutorial content changed; reopen the Card");
  }
  const key = await storageKey(detail, block);
  const request = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const current = await load(key, block.practice!);
    if (current.clozeVersion !== input.baseVersion) throw new Error("Tutorial practice changed; reopen the Card");
    const state = JSON.parse(JSON.stringify(current.clozeState)) as CardClozeState;
    const operation = input.operation;
    if (operation.type === "add") {
      const segment = block.segments.find((item) => item.id === operation.segmentId);
      const { startUtf16: start, endUtf16: end } = operation;
      if (!segment || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > segment.text.length || start >= end) throw new Error("Invalid blank selection");
      const answer = segment.text.slice(start, end);
      if (!answer.trim() || state.blanks.some((blank) => blank.segmentId === segment.id && start < blank.endUtf16 && end > blank.startUtf16)) throw new Error("Invalid blank selection");
      state.blanks.push({ id: `tutorial-local-${segment.id}-${start}-${end}`, segmentId: segment.id, startUtf16: start, endUtf16: end, answer });
    } else if (operation.type === "remove") {
      state.blanks = state.blanks.filter((blank) => blank.id !== operation.blankId);
    } else if (operation.type === "master" || operation.type === "memory_result") {
      for (const blank of state.blanks) {
        if (operation.type === "master" ? blank.id === operation.blankId : operation.blankIds.includes(blank.id)) blank.mastered = true;
      }
    }
    const practice: Practice = {
      ...current, clozeState: state, clozeVersion: current.clozeVersion + 1,
      hasCloze: state.blanks.length > 0,
      clozeLastResult: input.result ?? current.clozeLastResult,
      nextReviewAt: null,
    };
    await AsyncStorage.setItem(key, JSON.stringify(practice));
    return practice;
  });
  writes.set(key, request);
  try { return await request; }
  finally { if (writes.get(key) === request) writes.delete(key); }
}
