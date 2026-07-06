const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PODSPEC_PATH = path.join(
  "node_modules",
  "@picovoice",
  "react-native-voice-processor",
  "react-native-voice-processor.podspec"
);

module.exports = function withPicovoiceVoiceProcessor(config) {
  return withDangerousMod(config, [
    "ios",
    (iosConfig) => {
      const podspecPath = path.join(iosConfig.modRequest.projectRoot, PODSPEC_PATH);
      patchPodspec(podspecPath);
      return iosConfig;
    },
  ]);
};

function patchPodspec(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing Picovoice Voice Processor podspec: ${filePath}`);
  }

  const dependencyLine = '    s.dependency "RCT-Folly"';
  const patchedLine = "    # Expo SDK 54 / RN 0.81 provides RCT-Folly via React Native's pod helpers.";
  let text = fs.readFileSync(filePath, "utf8");

  if (!text.includes(dependencyLine)) {
    return;
  }

  text = text.replace(dependencyLine, patchedLine);
  fs.writeFileSync(filePath, text);
}
