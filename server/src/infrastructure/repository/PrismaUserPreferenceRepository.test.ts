import assert from "node:assert/strict";
import test from "node:test";
import { PrismaUserPreferenceRepository } from "./PrismaUserPreferenceRepository";

test("keeps the first acquisition source while allowing preference updates", async () => {
  const now = new Date("2026-09-20T00:00:00.000Z");
  let row: any = null;
  const repository = new PrismaUserPreferenceRepository({
    userPreference: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        row = row
          ? { ...row, ...update, updatedAt: now }
          : { ...create, createdAt: now, updatedAt: now };
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        if (row?.userId === where.userId && row.acquisitionSource == null) {
          row = { ...row, ...data, updatedAt: now };
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  });

  const first = await repository.upsert({
    userId: "user-1",
    appLocale: "zh-CN",
    acquisitionSource: "youtube",
  });
  const second = await repository.upsert({
    userId: "user-1",
    appLocale: "en-US",
    acquisitionSource: "douyin",
  });

  assert.equal(first.acquisitionSource, "youtube");
  assert.equal(second.acquisitionSource, "youtube");
  assert.equal(second.appLocale, "en-US");
});
