import assert from "node:assert/strict";
import test from "node:test";
import { appVersionPolicy } from "./routes.js";

test("returns the configured APK only for China Android", () => {
  const env = {
    LF_APP_LATEST_VERSION: "1.1.2",
    LF_APP_CHINA_ANDROID_LATEST_VERSION: "1.1.3",
    LF_APP_CHINA_ANDROID_DOWNLOAD_URL: "https://download.yueyantech.com/OIO-1.1.3-147.apk",
  };

  const china = appVersionPolicy("android", "china", env);
  assert.equal(china.latestVersion, "1.1.3");
  assert.equal(china.storeUrl, env.LF_APP_CHINA_ANDROID_DOWNLOAD_URL);
  assert.equal(appVersionPolicy("android", "google", env).latestVersion, "1.1.2");
  assert.equal(appVersionPolicy("ios", null, env).latestVersion, "1.1.2");
  assert.equal(
    appVersionPolicy("android", "google", env).storeUrl,
    "https://play.google.com/store/apps/details?id=com.yueyantech.oio",
  );
  assert.equal(
    appVersionPolicy("ios", "china", env).storeUrl,
    "https://apps.apple.com/app/id6776898160",
  );
});

test("keeps the website as a safe China fallback when no APK is configured", () => {
  assert.equal(appVersionPolicy("android", "china", {}).storeUrl, "https://yueyantech.com");
});
