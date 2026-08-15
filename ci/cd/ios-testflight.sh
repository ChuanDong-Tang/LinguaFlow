#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
CONFIG_FILE="$SCRIPT_DIR/ios-testflight.env"
ARTIFACT_DIR="$SCRIPT_DIR/artifacts/ios"

ASSUME_YES=false
BUILD_ONLY=false
CHECK_ONLY=false

usage() {
  cat <<'USAGE'
Usage: bash ci/cd/ios-testflight.sh [options]

Options:
  --yes         Skip the confirmation prompt.
  --build-only  Build and validate the IPA, but do not upload it.
  --check       Run local preflight checks without building.
  -h, --help    Show this help.
USAGE
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --yes) ASSUME_YES=true ;;
    --build-only) BUILD_ONLY=true ;;
    --check) CHECK_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || fail "Missing config: $CONFIG_FILE"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

load_dotenv() {
  local env_file="$1"
  local line
  [[ -f "$env_file" ]] || fail "Missing environment file: $env_file"

  # This loader supports both LF and CRLF files and does not evaluate values.
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    [[ "$line" == *=* ]] || fail "Invalid line in $env_file: $line"
    export "$line"
  done < "$env_file"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null
}

preflight() {
  log "Running macOS/iOS production preflight"
  [[ "$(uname -s)" == "Darwin" ]] || fail "This workflow must run on macOS."

  require_command node
  require_command npm
  require_command npx
  require_command git
  require_command unzip
  require_command xcodebuild
  require_command codesign
  require_command security

  xcode-select -p >/dev/null
  load_dotenv "$MOBILE_DIR/.env"
  export NODE_ENV=production
  export EXPO_APPLE_TEAM_ID="$EXPECTED_TEAM_ID"

  [[ "${EXPO_PUBLIC_API_BASE_URL:-}" == "$EXPECTED_API_URL" ]] || \
    fail "Local API URL is not production: ${EXPO_PUBLIC_API_BASE_URL:-<unset>}"
  [[ "${EXPO_PUBLIC_ENABLE_TEST_PASSWORD_LOGIN:-}" == "false" ]] || \
    fail "Test password login must be false."
  [[ "${EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL:-}" == "false" ]] || \
    fail "Debug prompt panel must be false."

  node - "$MOBILE_DIR/eas.json" "$BUILD_PROFILE" "$EXPECTED_CHANNEL" <<'NODE'
const fs = require('fs');
const [file, profileName, expectedChannel] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const profile = config.build?.[profileName];
if (!profile) throw new Error(`Missing EAS build profile: ${profileName}`);
if (profile.environment !== 'production') throw new Error('EAS environment must be production');
if (profile.channel !== expectedChannel) throw new Error(`EAS channel must be ${expectedChannel}`);
if (profile.distribution !== 'store') throw new Error('EAS distribution must be store');
if (profile.ios?.simulator !== false) throw new Error('EAS iOS simulator must be false');
const ascAppId = config.submit?.production?.ios?.ascAppId;
if (!ascAppId) throw new Error('Missing submit.production.ios.ascAppId');
NODE

  credentials_source="$(node - "$MOBILE_DIR/eas.json" "$BUILD_PROFILE" <<'NODE'
const fs = require('fs');
const [file, profileName] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
process.stdout.write(config.build?.[profileName]?.credentialsSource || 'remote');
NODE
)"
  if [[ "$credentials_source" == "local" ]]; then
    security find-identity -v -p codesigning | grep -F "$EXPECTED_TEAM_ID" >/dev/null || \
      fail "No valid Apple signing identity found for team $EXPECTED_TEAM_ID."
  else
    log "Using EAS remote iOS signing credentials"
  fi

  log "Preflight passed"
  printf 'Profile: %s\nChannel: %s\nAPI: %s\nTeam: %s\n' \
    "$BUILD_PROFILE" "$EXPECTED_CHANNEL" "$EXPECTED_API_URL" "$EXPECTED_TEAM_ID"
}

validate_ipa() {
  local ipa="$1"
  local verify_dir app_dir info_plist expo_plist hermesc dump_file
  verify_dir="$(mktemp -d "${TMPDIR%/}/linguaflow-ios-verify.XXXXXX")"
  trap '[[ -n "${verify_dir:-}" && "$verify_dir" == "${TMPDIR%/}"/linguaflow-ios-verify.* ]] && rm -rf "$verify_dir"' RETURN

  unzip -q "$ipa" -d "$verify_dir/unpacked"
  app_dir="$(find "$verify_dir/unpacked/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
  [[ -n "$app_dir" ]] || fail "No .app bundle found in IPA."
  info_plist="$app_dir/Info.plist"
  expo_plist="$app_dir/Expo.plist"

  IPA_BUNDLE_ID="$(plist_value "$info_plist" CFBundleIdentifier)"
  IPA_VERSION="$(plist_value "$info_plist" CFBundleShortVersionString)"
  IPA_BUILD="$(plist_value "$info_plist" CFBundleVersion)"
  IPA_CHANNEL="$(plist_value "$expo_plist" EXUpdatesRequestHeaders:expo-channel-name)"

  [[ "$IPA_BUNDLE_ID" == "$EXPECTED_BUNDLE_ID" ]] || \
    fail "Unexpected bundle ID: $IPA_BUNDLE_ID"
  [[ "$IPA_CHANNEL" == "$EXPECTED_CHANNEL" ]] || \
    fail "Unexpected Expo Updates channel: $IPA_CHANNEL"

  codesign --verify --deep --strict "$app_dir"
  codesign -dv --verbose=4 "$app_dir" 2>&1 | grep -F "TeamIdentifier=$EXPECTED_TEAM_ID" >/dev/null || \
    fail "IPA is not signed by team $EXPECTED_TEAM_ID."

  hermesc="$MOBILE_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
  [[ -x "$hermesc" ]] || fail "Hermes bytecode inspector not found: $hermesc"
  [[ -f "$app_dir/main.jsbundle" ]] || fail "main.jsbundle not found in IPA."
  dump_file="$verify_dir/hermes-bytecode.txt"
  "$hermesc" -b -dump-bytecode "$app_dir/main.jsbundle" > "$dump_file"
  grep -F "$EXPECTED_API_URL" "$dump_file" >/dev/null || \
    fail "Production API URL is not embedded in the JS bundle. Upload stopped."

  log "IPA validation passed"
  printf 'App: %s\nVersion: %s\nBuild: %s\nChannel: %s\nAPI: %s\n' \
    "$IPA_BUNDLE_ID" "$IPA_VERSION" "$IPA_BUILD" "$IPA_CHANNEL" "$EXPECTED_API_URL"
}

preflight
if $CHECK_ONLY; then
  exit 0
fi

log "Current source status"
git -C "$REPO_ROOT" status --short || true

if ! $ASSUME_YES; then
  printf '\nThis will allocate a new iOS build number, build locally, validate, and upload to TestFlight.\n'
  read -r -p 'Continue? [y/N] ' answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "Cancelled." ;;
  esac
fi

mkdir -p "$ARTIFACT_DIR"
timestamp="$(date '+%Y%m%d-%H%M%S')"
raw_ipa="$ARTIFACT_DIR/OIO-pending-$timestamp.ipa"

log "Building production IPA locally with EAS"
(
  cd "$MOBILE_DIR"
  # Keep ignored generated native sources synchronized with the tracked Expo
  # config plugins before a local build. Without this step `expo run:ios` and
  # local EAS builds can silently use stale Objective-C/Swift sources.
  npx expo prebuild --platform ios --no-install
  npx --yes eas-cli build \
    --platform ios \
    --profile "$BUILD_PROFILE" \
    --local \
    --non-interactive \
    --output "$raw_ipa"
)

[[ -s "$raw_ipa" ]] || fail "EAS build did not produce an IPA."
validate_ipa "$raw_ipa"

final_ipa="$ARTIFACT_DIR/OIO-$IPA_VERSION-$IPA_BUILD.ipa"
if [[ -e "$final_ipa" ]]; then
  final_ipa="$ARTIFACT_DIR/OIO-$IPA_VERSION-$IPA_BUILD-$timestamp.ipa"
fi
mv "$raw_ipa" "$final_ipa"
shasum -a 256 "$final_ipa"

if $BUILD_ONLY; then
  log "Build-only workflow completed"
  printf 'IPA: %s\n' "$final_ipa"
  exit 0
fi

log "Submitting validated IPA to TestFlight"
(
  cd "$MOBILE_DIR"
  npx --yes eas-cli submit \
    --platform ios \
    --profile "$SUBMIT_PROFILE" \
    --path "$final_ipa" \
    --non-interactive \
    --wait
)

log "TestFlight upload completed"
printf 'IPA: %s\nTestFlight: https://appstoreconnect.apple.com/apps/6776898160/testflight/ios\n' "$final_ipa"
