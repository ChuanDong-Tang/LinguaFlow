import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("version consumers use the installed binary, not OTA metadata", () => {
  for (const file of ["./appVersionApi.ts", "../../screens/AboutScreen.tsx", "../../screens/FeedbackScreen.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /import \* as Application from "expo-application"/);
    assert.match(source, /Application\.nativeApplicationVersion/);
    assert.doesNotMatch(source, /Constants\.(nativeAppVersion|expoConfig)/);
  }
});

test("production publisher rejects missing app version before export or upload", () => {
  const result = spawnSync(process.execPath, [
    new URL("../../../scripts/publish-self-hosted-update.mjs", import.meta.url).pathname,
    "--channel", "production", "--platform", "ios", "--dry-run",
  ], { env: { ...process.env, OIO_APP_VERSION: "" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicit OIO_APP_VERSION/);
});
