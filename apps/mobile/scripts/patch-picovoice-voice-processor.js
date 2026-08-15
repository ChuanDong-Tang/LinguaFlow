const path = require("node:path");
const { patchInstalledPackage } = require("../plugins/with-picovoice-voice-processor");

patchInstalledPackage(path.resolve(__dirname, ".."));
