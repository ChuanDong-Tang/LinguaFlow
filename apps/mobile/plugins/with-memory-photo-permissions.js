const { withAndroidManifest } = require("expo/config-plugins");

// Incremental prebuild retains tools:node="remove" from pre-1.2.0 builds.
// Replace only the photo-read entries; never enable storage writes or video.
module.exports = function withMemoryPhotoPermissions(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const readPermissions = [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.READ_EXTERNAL_STORAGE",
    ];
    manifest["uses-permission"] = (manifest["uses-permission"] || []).filter(
      (permission) => !readPermissions.includes(permission?.$?.["android:name"])
    );
    for (const name of readPermissions) {
      manifest["uses-permission"].push({
        $: {
          "android:name": name,
          ...(name.endsWith("READ_EXTERNAL_STORAGE") ? { "android:maxSdkVersion": "32" } : {}),
        },
      });
    }
    return androidConfig;
  });
};
