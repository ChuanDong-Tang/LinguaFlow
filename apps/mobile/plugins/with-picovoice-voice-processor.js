const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PODSPEC_PATH = path.join(
  "node_modules",
  "@picovoice",
  "react-native-voice-processor",
  "react-native-voice-processor.podspec"
);
const IOS_SOURCE_PATH = path.join(
  "node_modules",
  "@picovoice",
  "react-native-voice-processor",
  "ios",
  "VoiceProcessor.swift"
);

module.exports = function withPicovoiceVoiceProcessor(config) {
  return withDangerousMod(config, [
    "ios",
    (iosConfig) => {
      patchInstalledPackage(iosConfig.modRequest.projectRoot);
      return iosConfig;
    },
  ]);
};

function patchInstalledPackage(projectRoot) {
  patchPodspec(path.join(projectRoot, PODSPEC_PATH));
  patchIosEmitter(path.join(projectRoot, IOS_SOURCE_PATH));
}

module.exports.patchInstalledPackage = patchInstalledPackage;

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

function patchIosEmitter(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing Picovoice Voice Processor iOS source: ${filePath}`);
  }

  let text = fs.readFileSync(filePath, "utf8");
  if (text.includes("private var hasActiveReactListeners = false")) return;

  const propertyAnchor = "    private var isSettingsErrorReported = false\n";
  const initAnchor = "    public override init() {\n";
  const frameSend = "                self.sendEvent(withName: self.frameEmitterKey, body: Array(frame))";
  const errorSend = "                self.sendEvent(withName: self.errorEmitterKey, body: error.errorDescription)";
  if (![propertyAnchor, initAnchor, frameSend, errorSend].every((anchor) => text.includes(anchor))) {
    throw new Error("Unsupported Picovoice VoiceProcessor.swift layout");
  }

  text = text
    .replace(propertyAnchor, `${propertyAnchor}    private var hasActiveReactListeners = false\n`)
    .replace(initAnchor, `    override func startObserving() {\n        hasActiveReactListeners = true\n    }\n\n    override func stopObserving() {\n        hasActiveReactListeners = false\n    }\n\n${initAnchor}`)
    .replace(frameSend, `                guard self.hasActiveReactListeners else { return }\n${frameSend}`)
    .replace(errorSend, `                guard self.hasActiveReactListeners else { return }\n${errorSend}`);
  fs.writeFileSync(filePath, text);
}
