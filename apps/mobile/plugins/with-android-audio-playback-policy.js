const { withAndroidManifest } = require("@expo/config-plugins");

const MEDIA_PLAYBACK_PERMISSION =
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK";
const AUDIO_CONTROLS_SERVICE =
  "expo.modules.audio.service.AudioControlsService";

module.exports = function withAndroidAudioPlaybackPolicy(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;

    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    manifest["uses-permission"] = (manifest["uses-permission"] || []).filter(
      (permission) =>
        permission?.$?.["android:name"] !== MEDIA_PLAYBACK_PERMISSION
    );
    manifest["uses-permission"].push({
      $: {
        "android:name": MEDIA_PLAYBACK_PERMISSION,
        "tools:node": "remove",
      },
    });

    const application = manifest.application?.[0];
    if (application) {
      application.service = (application.service || []).filter((service) => {
        const serviceName = service?.$?.["android:name"];
        return (
          serviceName !== AUDIO_CONTROLS_SERVICE &&
          serviceName !== ".service.AudioControlsService"
        );
      });
      application.service.push({
        $: {
          "android:name": AUDIO_CONTROLS_SERVICE,
          "tools:node": "remove",
        },
      });
    }

    return androidConfig;
  });
};
