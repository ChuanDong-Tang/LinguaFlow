const isPreview = process.env.EAS_BUILD_PROFILE === "preview";
const appVersion = process.env.OIO_APP_VERSION?.trim() || "1.2.0";
// Photo-library browsing requires the new native permission configuration.
const runtimeVersion = process.env.OIO_RUNTIME_VERSION?.trim() || "1.2.0";
const photosPermission = "OIO 需要读取你允许的照片，用于浏览生活照片和选择回忆素材。浏览不会上传，确认生成后才会上传所选照片；不会删除原照片。";

const scheme = isPreview ? "oio-preview" : "oio";
const updateChannelByBuildProfile = {
  preview: "preview",
  google: "production-google",
  china: "production-china",
};
const updateChannel = process.env.EXPO_UPDATES_CHANNEL?.trim()
  || updateChannelByBuildProfile[process.env.EAS_BUILD_PROFILE]
  || "production";
const updatesUrl = process.env.EXPO_UPDATES_URL?.trim()
  || "https://api.yueyantech.com/updates/manifest";
const updateSigningCertificate = process.env.EXPO_UPDATES_CODE_SIGNING_CERTIFICATE?.trim();

module.exports = {
  expo: {
    name: "OIO",
    slug: "oio",
    scheme,
    version: appVersion,
    orientation: "portrait",
    platforms: ["ios", "android"],
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      bundleIdentifier: "com.yueyantech.oio",
      buildNumber: "157",
      supportsTablet: true,
      icon: "./assets/app/logo_main_apple.png",
      infoPlist: {
        NSMicrophoneUsageDescription: "OIO 需要使用麦克风把你说的话转成文字。",
        NSPhotoLibraryUsageDescription: photosPermission,
        NSCameraUsageDescription: "OIO 需要使用相机，让你为生活记录拍摄图片。",
      },
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.yueyantech.oio",
      versionCode: 62,
      allowBackup: false,
      // POST_NOTIFICATIONS: local 回忆提醒 (Android 13+). expo-notifications is used
      // without its config plugin, so iOS gets no push entitlement (local only).
      permissions: ["RECORD_AUDIO", "POST_NOTIFICATIONS"],
      blockedPermissions: [
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/app/logo_main.png",
        backgroundColor: "#ffffff",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: "./assets/app/logo_main.png",
    },
    extra: {
      eas: {
        projectId: "0a8b5bb4-bdb1-4950-b3e9-6e2530b9c836",
      },
    },
    plugins: [
      [
        "expo-splash-screen",
        {
          image: "./assets/app/Splash_1.png",
          imageWidth: 320,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
            enableSceneSupport: true,
          },
        },
      ],
      "./plugins/with-ios-pod-deployment-target",
      "expo-asset",
      "expo-font",
      "expo-web-browser",
      "expo-audio",
      [
        "expo-image-picker",
        {
          photosPermission,
          cameraPermission: "OIO 需要使用相机，让你为生活记录拍摄图片。",
        },
      ],
      [
        "expo-media-library",
        {
          photosPermission,
          savePhotosPermission: "OIO 需要将图片保存到你的相册。",
          granularPermissions: ["photo"],
        },
      ],
      "./plugins/with-memory-photo-permissions",
      "expo-secure-store",
      "./plugins/with-chat-selectable-text",
      "./plugins/with-picovoice-voice-processor",
      "./plugins/with-android-release-signing",
    ],
    owner: "reedtang",
    runtimeVersion,
    updates: {
      url: updatesUrl,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 2500,
      requestHeaders: {
        "expo-channel-name": updateChannel,
      },
      ...(updateSigningCertificate
        ? {
            codeSigningCertificate: updateSigningCertificate,
            codeSigningMetadata: {
              keyid: "main",
              alg: "rsa-v1_5-sha256",
            },
          }
        : {}),
    },
  },
};
