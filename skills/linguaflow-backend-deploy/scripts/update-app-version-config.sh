#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --ios <version> --google <version> --china <version> --china-url <https-url> --confirm-production" >&2
  exit 2
}

ios_version=""
google_version=""
china_version=""
china_url=""
confirm_production=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ios) ios_version="${2:-}"; shift 2 ;;
    --google) google_version="${2:-}"; shift 2 ;;
    --china) china_version="${2:-}"; shift 2 ;;
    --china-url) china_url="${2:-}"; shift 2 ;;
    --confirm-production) confirm_production=true; shift ;;
    *) usage ;;
  esac
done

[[ "$confirm_production" == true ]] || usage
version_pattern='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ "$ios_version" =~ $version_pattern ]] || { echo "Invalid iOS version" >&2; exit 1; }
[[ "$google_version" =~ $version_pattern ]] || { echo "Invalid Google Android version" >&2; exit 1; }
[[ "$china_version" =~ $version_pattern ]] || { echo "Invalid China Android version" >&2; exit 1; }
[[ "$china_url" =~ ^https://download\.yueyantech\.com/OIO-${china_version}-[0-9]+\.apk$ ]] || {
  echo "China URL must be the immutable versioned download URL for the requested version" >&2
  exit 1
}

ssh oio-main bash -s -- "$ios_version" "$google_version" "$china_version" "$china_url" <<'REMOTE'
set -euo pipefail
cd /opt/oio-production
env_file=.env
[[ -f "$env_file" ]] || { echo "Production .env not found" >&2; exit 1; }
backup=".env.app-version.$(date -u +%Y%m%dT%H%M%SZ).bak"
cp -p "$env_file" "$backup"
node - "$env_file" "$1" "$2" "$3" "$4" <<'NODE'
const fs = require('node:fs');
const [file, ios, google, china, chinaUrl] = process.argv.slice(2);
const updates = new Map([
  ['LF_APP_IOS_LATEST_VERSION', ios],
  ['LF_APP_GOOGLE_ANDROID_LATEST_VERSION', google],
  ['LF_APP_CHINA_ANDROID_LATEST_VERSION', china],
  ['LF_APP_CHINA_ANDROID_DOWNLOAD_URL', chinaUrl],
]);
const seen = new Set();
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!match || !updates.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${updates.get(match[1])}`;
});
for (const [key, value] of updates) {
  if (!seen.has(key)) lines.push(`${key}=${value}`);
}
const temporary = `${file}.app-version.tmp`;
fs.writeFileSync(temporary, `${lines.filter((line, index) => line || index < lines.length - 1).join('\n')}\n`, { mode: 0o600 });
fs.renameSync(temporary, file);
NODE

if ! pm2 restart ecosystem.production.config.cjs --only oio-api-production --update-env; then
  cp -p "$backup" "$env_file"
  pm2 restart ecosystem.production.config.cjs --only oio-api-production --update-env
  echo "API restart failed; restored $backup" >&2
  exit 1
fi
sleep 2
test "$(pm2 pid oio-api-production)" != "0"
curl -fsS --max-time 10 http://127.0.0.1:3102/health >/dev/null
echo "config_backup=$backup"
echo "api_health=ok"
REMOTE

