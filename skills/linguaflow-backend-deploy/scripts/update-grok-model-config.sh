#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --model grok-4.3|grok-4-20-non-reasoning --confirm-production" >&2
  exit 2
}

model=""
confirm_production=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) model="${2:-}"; shift 2 ;;
    --confirm-production) confirm_production=true; shift ;;
    *) usage ;;
  esac
done

[[ "$confirm_production" == true ]] || usage
case "$model" in
  grok-4.3|grok-4-20-non-reasoning) ;;
  *) echo "Unsupported Grok model: $model" >&2; exit 1 ;;
esac

ssh oio-main bash -s -- "$model" <<'REMOTE'
set -euo pipefail
cd /opt/oio-production
model="$1"
env_file=.env
[[ -f "$env_file" ]] || { echo "Production .env not found" >&2; exit 1; }
backup=".env.grok-model.$(date -u +%Y%m%dT%H%M%SZ).bak"
cp -p "$env_file" "$backup"

node - "$env_file" "$model" <<'NODE'
const fs = require('node:fs');
const [file, model] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const existingAllowedLine = source.split(/\r?\n/).find((line) => line.startsWith('GROK_ALLOWED_MODELS='));
const existingAllowed = existingAllowedLine
  ? existingAllowedLine.slice('GROK_ALLOWED_MODELS='.length).split(',').map((value) => value.trim()).filter(Boolean)
  : [];
const allowed = [...new Set([...existingAllowed, 'grok-4.3', model])].join(',');
const updates = new Map([
  ['GROK_DEFAULT_MODEL', model],
  ['GROK_ALLOWED_MODELS', allowed],
]);
const seen = new Set();
const lines = source.split(/\r?\n/).map((line) => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!match || !updates.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${updates.get(match[1])}`;
});
for (const [key, value] of updates) {
  if (!seen.has(key)) lines.push(`${key}=${value}`);
}
const temporary = `${file}.grok-model.tmp`;
fs.writeFileSync(temporary, `${lines.filter((line, index) => line || index < lines.length - 1).join('\n')}\n`, { mode: 0o600 });
fs.renameSync(temporary, file);
NODE

restart_and_verify() {
  pm2 restart ecosystem.production.config.cjs --update-env || return 1
  sleep 2
  for process_name in oio-api-production oio-worker-production; do
    pid="$(pm2 pid "$process_name")"
    [[ "$pid" != "0" ]] || return 1
    tr '\0' '\n' < "/proc/$pid/environ" | grep -Fqx "GROK_DEFAULT_MODEL=$model" || return 1
  done
  curl -fsS --max-time 10 http://127.0.0.1:3102/health >/dev/null || return 1
}

if ! restart_and_verify; then
  cp -p "$backup" "$env_file"
  pm2 restart ecosystem.production.config.cjs --update-env >/dev/null
  echo "Model update failed; restored $backup" >&2
  exit 1
fi

echo "config_backup=$backup"
echo "grok_default_model=$model"
echo "api_health=ok"
echo "worker_health=online"
REMOTE
