const { IOSConfig, withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const { addBuildSourceFileToGroup } = require("@expo/config-plugins/build/ios/utils/Xcodeproj");
const fs = require("node:fs");
const path = require("node:path");

const IOS_FILES = [
  "ChatSelectableTextView.h",
  "ChatSelectableTextView.m",
  "ChatSelectableTextViewManager.m",
  "ChatSelectableTextShadowView.h",
  "ChatSelectableTextShadowView.m",
];

const ANDROID_FILES = [
  "ChatSelectableTextPackage.kt",
  "ChatSelectableTextView.kt",
  "ChatSelectableTextViewManager.kt",
];

module.exports = function withChatSelectableText(config) {
  return withAndroidSelectableText(withIosSelectableText(config));
};

function withIosSelectableText(config) {
  return withXcodeProject(config, (iosConfig) => {
    const iosRoot = iosConfig.modRequest.platformProjectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(iosConfig.modRequest.projectRoot);
    const sourceRoot = path.join(iosRoot, projectName);
    const templateRoot = path.join(__dirname, "chat-selectable-text", "ios");

    fs.mkdirSync(sourceRoot, { recursive: true });

    for (const filename of IOS_FILES) {
      const sourcePath = path.join(templateRoot, filename);
      const targetPath = path.join(sourceRoot, filename);
      fs.copyFileSync(sourcePath, targetPath);
      addBuildSourceFileToGroup({
        filepath: `${projectName}/${filename}`,
        groupName: projectName,
        project: iosConfig.modResults,
      });
    }

    return iosConfig;
  });
}

function withAndroidSelectableText(config) {
  const androidPackage = config.android?.package;
  if (!androidPackage) {
    throw new Error("with-chat-selectable-text requires expo.android.package to locate MainApplication.kt");
  }

  return withDangerousMod(config, [
    "android",
    (androidConfig) => {
      const androidRoot = androidConfig.modRequest.platformProjectRoot;
      const packagePath = androidPackage.split(".");
      const javaRoot = path.join(androidRoot, "app", "src", "main", "java", ...packagePath);
      const targetRoot = path.join(javaRoot, "chatselectabletext");
      const templateRoot = path.join(__dirname, "chat-selectable-text", "android");

      fs.mkdirSync(targetRoot, { recursive: true });

      for (const filename of ANDROID_FILES) {
        const source = fs.readFileSync(path.join(templateRoot, filename), "utf8");
        fs.writeFileSync(
          path.join(targetRoot, filename),
          source.replace(
            "package com.yueyantech.oio.chatselectabletext",
            `package ${androidPackage}.chatselectabletext`
          )
        );
      }

      patchMainApplication(path.join(javaRoot, "MainApplication.kt"), androidPackage);
      return androidConfig;
    },
  ]);
}

function patchMainApplication(filePath, androidPackage) {
  let text = fs.readFileSync(filePath, "utf8");
  const packageImport = `import ${androidPackage}.chatselectabletext.ChatSelectableTextPackage`;
  if (!text.includes(packageImport)) {
    text = text.replace(
      "import expo.modules.ReactNativeHostWrapper\n",
      `import expo.modules.ReactNativeHostWrapper\n${packageImport}\n`
    );
  }
  if (!text.includes("add(ChatSelectableTextPackage())")) {
    text = text.replace(
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())",
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())\n              add(ChatSelectableTextPackage())"
    );
  }
  fs.writeFileSync(filePath, text);
}
