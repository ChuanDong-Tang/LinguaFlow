const isPreview = process.env.EAS_BUILD_PROFILE === "preview";

const scheme = isPreview ? "oio-preview" : "oio";

module.exports = {
  expo: {
    name: "OIO",
    slug: "oio",
    scheme,
    version: "1.1.1",
    orientation: "portrait",
    platforms: ["ios", "android"],
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/app/Splash_1.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      bundleIdentifier: "com.yueyantech.oio",
      buildNumber: "125",
      supportsTablet: true,
      icon: "./assets/app/logo_main_apple.png",
      infoPlist: {
        NSMicrophoneUsageDescription: "OIO 需要使用麦克风把你说的话转成文字。",
        NSPhotoLibraryUsageDescription: "OIO 需要访问相册，让你为生活记录选择图片。",
        NSCameraUsageDescription: "OIO 需要使用相机，让你为生活记录拍摄图片。",
      },
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.yueyantech.oio",
      versionCode: 61,
      allowBackup: false,
      permissions: ["RECORD_AUDIO"],
      blockedPermissions: [
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/app/logo_main.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
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
      "expo-asset",
      "expo-font",
      "expo-web-browser",
      "expo-audio",
      [
        "expo-image-picker",
        {
          photosPermission: "OIO 需要访问相册，让你为生活记录选择图片。",
          cameraPermission: "OIO 需要使用相机，让你为生活记录拍摄图片。",
        },
      ],
      [
        "expo-media-library",
        {
          photosPermission: "OIO 需要访问相册，让你选择和管理图片。",
          savePhotosPermission: "OIO 需要将图片保存到你的相册。",
          granularPermissions: ["photo"],
        },
      ],
      "./plugins/with-android-audio-playback-policy",
      "expo-secure-store",
      "./plugins/with-chat-selectable-text",
      "./plugins/with-picovoice-voice-processor",
      "./plugins/with-android-release-signing",
    ],
    owner: "reedtang",
    runtimeVersion: "1.1.1",
    updates: {
      url: "https://u.expo.dev/0a8b5bb4-bdb1-4950-b3e9-6e2530b9c836",
    },
  },
};
