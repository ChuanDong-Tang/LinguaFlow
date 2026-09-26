#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --status | (--enable|--disable) phrase|alignment|both --confirm-production" >&2
  exit 2
}

action="${1:-}"
if [[ "$action" == "--status" ]]; then
  [[ $# -eq 1 ]] || usage
  ssh oio-main 'set -euo pipefail
    cd /opt/oio-production
    node --env-file=.env -e '\''
      const bool = (name) => String(process.env[name] ?? "false").trim().toLowerCase() === "true";
      const value = (name, fallback) => String(process.env[name] ?? fallback);
      console.log(`phrase_enabled=${bool("CARD_PHRASE_EMBEDDING_BACKFILL_ENABLED")}`);
      console.log(`phrase_batch_size=${value("CARD_PHRASE_EMBEDDING_BACKFILL_BATCH_SIZE", "20")}`);
      console.log(`phrase_max_outstanding=${value("CARD_PHRASE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "40")}`);
      console.log(`phrase_scan_interval_ms=${value("CARD_PHRASE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "30000")}`);
      console.log(`alignment_enabled=${bool("CARD_REWRITE_ALIGNMENT_BACKFILL_ENABLED")}`);
      console.log(`alignment_batch_size=${value("CARD_REWRITE_ALIGNMENT_BATCH_SIZE", "20")}`);
      console.log(`alignment_scan_interval_ms=${value("CARD_REWRITE_ALIGNMENT_SCAN_INTERVAL_MS", "30000")}`);
    '\''
    echo worker_status=$(pm2 jlist | node -e '\''
      let raw = "";
      process.stdin.on("data", (chunk) => raw += chunk);
      process.stdin.on("end", () => {
        const app = JSON.parse(raw).find((item) => item.name === "oio-worker-production");
        process.stdout.write(app?.pm2_env?.status ?? "missing");
      });
    '\'')'
  exit 0
fi

[[ "$action" == "--enable" || "$action" == "--disable" ]] || usage
target="${2:-}"
[[ "$target" == "phrase" || "$target" == "alignment" || "$target" == "both" ]] || usage
[[ "${3:-}" == "--confirm-production" && $# -eq 3 ]] || usage

enabled=false
[[ "$action" == "--enable" ]] && enabled=true

ssh oio-main "bash -s -- '$target' '$enabled'" <<'REMOTE'
set -euo pipefail
target="$1"
enabled="$2"
cd /opt/oio-production
test -f .env
backup=".env.backup-card-backfills-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$backup"

TARGET="$target" ENABLED="$enabled" node <<'NODE'
const fs = require("node:fs");
const path = ".env";
const target = process.env.TARGET;
const enabled = process.env.ENABLED;
const updates = new Map();
if (target === "phrase" || target === "both") {
  updates.set("CARD_PHRASE_EMBEDDING_BACKFILL_ENABLED", enabled);
  updates.set("CARD_PHRASE_EMBEDDING_BACKFILL_BATCH_SIZE", "20");
  updates.set("CARD_PHRASE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "40");
  updates.set("CARD_PHRASE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "30000");
}
if (target === "alignment" || target === "both") {
  updates.set("CARD_REWRITE_ALIGNMENT_BACKFILL_ENABLED", enabled);
  updates.set("CARD_REWRITE_ALIGNMENT_BATCH_SIZE", "20");
  updates.set("CARD_REWRITE_ALIGNMENT_SCAN_INTERVAL_MS", "30000");
}
const original = fs.readFileSync(path, "utf8");
const kept = original.split(/\r?\n/u).filter((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=/u);
  return !match || !updates.has(match[1]);
});
while (kept.length && kept.at(-1) === "") kept.pop();
const next = `${kept.join("\n")}\n${[...updates].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
const temp = `${path}.card-backfills-${process.pid}.tmp`;
const mode = fs.statSync(path).mode;
fs.writeFileSync(temp, next, { mode });
fs.renameSync(temp, path);
NODE

pm2 restart ecosystem.production.config.cjs --only oio-worker-production --update-env >/dev/null
sleep 2
test "$(pm2 pid oio-worker-production)" != "0"
echo "target=$target"
echo "enabled=$enabled"
echo "backup=$backup"
echo "worker_health=online"
REMOTE

"$0" --status
