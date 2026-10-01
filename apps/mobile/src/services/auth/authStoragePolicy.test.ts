import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseIosSimulatorAuthStorage } from "./authStoragePolicy";

test("uses simulator storage only for an iOS Simulator", () => {
  assert.equal(shouldUseIosSimulatorAuthStorage("ios", true), true);
  assert.equal(shouldUseIosSimulatorAuthStorage("ios", false), false);
  assert.equal(shouldUseIosSimulatorAuthStorage("android", true), false);
});
