const { withAndroidManifest, withDangerousMod, withInfoPlist } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const WECHAT_PACKAGE = "com.tencent.mm";
const WECHAT_RN_PROJECT = "react-native-wechat-lib";

module.exports = function withWechatPay(config) {
  return withInfoPlist(
    withWechatAndroidNativeLink(
      withAndroidManifest(config, (androidConfig) => {
        const manifest = androidConfig.modResults.manifest;
        manifest.queries = manifest.queries || [];

        const hasWechatQuery = manifest.queries.some((query) =>
          query.package?.some((item) => item.$?.["android:name"] === WECHAT_PACKAGE)
        );
        if (!hasWechatQuery) {
          manifest.queries.push({ package: [{ $: { "android:name": WECHAT_PACKAGE } }] });
        }

        return androidConfig;
      })
    ),
    (iosConfig) => {
      const configuredAppId = iosConfig.extra?.wechatAppId;
      const appId =
        configuredAppId && !String(configuredAppId).includes("${")
          ? configuredAppId
          : process.env.EXPO_PUBLIC_WECHAT_APP_ID;
      const plist = iosConfig.modResults;
      plist.LSApplicationQueriesSchemes = Array.from(
        new Set([...(plist.LSApplicationQueriesSchemes || []), "wechat", "weixin", "weixinULAPI"])
      );

      if (appId) {
        const urlTypes = plist.CFBundleURLTypes || [];
        const hasWechatScheme = urlTypes.some((item) =>
          item.CFBundleURLSchemes?.includes(appId)
        );
        if (!hasWechatScheme) {
          urlTypes.push({
            CFBundleURLName: "wechat",
            CFBundleURLSchemes: [appId],
          });
        }
        plist.CFBundleURLTypes = urlTypes;
      }

      return iosConfig;
    }
  );
};

function withWechatAndroidNativeLink(config) {
  return withDangerousMod(config, [
    "android",
    (androidConfig) => {
      const androidRoot = androidConfig.modRequest.platformProjectRoot;
      patchSettingsGradle(path.join(androidRoot, "settings.gradle"));
      patchAppBuildGradle(path.join(androidRoot, "app", "build.gradle"));
      patchMainApplication(path.join(androidRoot, "app", "src", "main", "java", "com", "oio", "linguaflow", "MainApplication.kt"));
      return androidConfig;
    },
  ]);
}

function patchSettingsGradle(filePath) {
  const includeLine = `include ':${WECHAT_RN_PROJECT}'`;
  const projectDirLine = `project(':${WECHAT_RN_PROJECT}').projectDir = new File(rootProject.projectDir, '../node_modules/${WECHAT_RN_PROJECT}/android')`;
  let text = fs.readFileSync(filePath, "utf8");
  if (!text.includes(includeLine)) {
    text = `${text.trimEnd()}\n${includeLine}\n${projectDirLine}\n`;
  }
  fs.writeFileSync(filePath, text);
}

function patchAppBuildGradle(filePath) {
  const dependencyLine = `    implementation project(':${WECHAT_RN_PROJECT}')`;
  let text = fs.readFileSync(filePath, "utf8");
  if (!text.includes(dependencyLine.trim())) {
    text = text.replace(/dependencies\s*\{\s*/, (match) => `${match}${dependencyLine}\n`);
  }
  fs.writeFileSync(filePath, text);
}

function patchMainApplication(filePath) {
  let text = fs.readFileSync(filePath, "utf8");
  if (!text.includes("import com.theweflex.react.WeChatPackage")) {
    text = text.replace(
      "import expo.modules.ReactNativeHostWrapper\n",
      "import expo.modules.ReactNativeHostWrapper\nimport com.theweflex.react.WeChatPackage\n"
    );
  }
  if (!text.includes("add(WeChatPackage())")) {
    text = text.replace(
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())",
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())\n              add(WeChatPackage())"
    );
  }
  fs.writeFileSync(filePath, text);
}
