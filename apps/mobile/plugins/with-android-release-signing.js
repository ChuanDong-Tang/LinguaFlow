const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const SIGNING_PROPERTIES_BLOCK = `
// OIO local release signing. Values live in the user's ~/.gradle/gradle.properties.
def releaseSigningPropertyNames = [
    'OIO_UPLOAD_STORE_FILE',
    'OIO_UPLOAD_KEY_ALIAS',
    'OIO_UPLOAD_STORE_PASSWORD',
    'OIO_UPLOAD_KEY_PASSWORD',
]
def missingReleaseSigningProperties = releaseSigningPropertyNames.findAll { !findProperty(it) }
def releaseBuildRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }

if (releaseBuildRequested && !missingReleaseSigningProperties.isEmpty()) {
    throw new GradleException(
        "Missing release signing properties: \${missingReleaseSigningProperties.join(', ')}. " +
        "Configure them in your user Gradle properties file."
    )
}
`;

const RELEASE_SIGNING_CONFIG = `
        release {
            if (missingReleaseSigningProperties.isEmpty()) {
                storeFile file(findProperty('OIO_UPLOAD_STORE_FILE'))
                storePassword findProperty('OIO_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('OIO_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('OIO_UPLOAD_KEY_PASSWORD')
            }
        }`;

module.exports = function withAndroidReleaseSigning(config) {
  return withDangerousMod(config, [
    "android",
    (androidConfig) => {
      patchAppBuildGradle(
        path.join(androidConfig.modRequest.platformProjectRoot, "app", "build.gradle")
      );
      return androidConfig;
    },
  ]);
};

function patchAppBuildGradle(filePath) {
  let text = fs.readFileSync(filePath, "utf8");

  if (!text.includes("def releaseSigningPropertyNames = [")) {
    const jscFlavorPattern = /(def jscFlavor = .*\r?\n)/;
    if (!jscFlavorPattern.test(text)) {
      throw new Error("Unable to locate jscFlavor in Android app build.gradle");
    }
    text = text.replace(jscFlavorPattern, `$1${SIGNING_PROPERTIES_BLOCK}\n`);
  }

  if (!text.includes("storeFile file(findProperty('OIO_UPLOAD_STORE_FILE'))")) {
    const debugSigningPattern = /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n        \})/;
    if (!debugSigningPattern.test(text)) {
      throw new Error("Unable to locate debug signing config in Android app build.gradle");
    }
    text = text.replace(debugSigningPattern, `$1${RELEASE_SIGNING_CONFIG}`);
  }

  const releaseBuildPattern = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (releaseBuildPattern.test(text)) {
    text = text.replace(releaseBuildPattern, "$1signingConfig signingConfigs.release");
  }

  if (!text.includes("signingConfig signingConfigs.release")) {
    throw new Error("Unable to configure Android release build signing");
  }

  fs.writeFileSync(filePath, text);
}
