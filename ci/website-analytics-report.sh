#!/usr/bin/env bash
set -euo pipefail

log_file="${1:-/var/log/nginx/access.log}"

if [[ ! -r "$log_file" ]]; then
  echo "Cannot read $log_file. Run with sudo or pass a readable Nginx access log." >&2
  exit 1
fi

echo "OIO website report: $log_file"
echo
echo "Top public pages"
awk '$6 == "\"GET" && $9 ~ /^[23]/ && tolower($0) !~ /(bot|spider|crawler)/ {
  path=$7; sub(/\?.*/, "", path)
  if (path == "/" || path ~ /^\/(app\.html|wiki\/?|wiki\/[^/]+\.html)$/) pages[path]++
} END { for (path in pages) print pages[path], path }' "$log_file" | sort -rn | head -15

echo
echo "External referrers"
awk '$6 == "\"GET" && $9 ~ /^[23]/ {
  ref=$11; gsub(/"/, "", ref)
  if (ref ~ /^https?:\/\// && ref !~ /yueyantech\.com/) {
    sub(/^https?:\/\//, "", ref); sub(/\/.*/, "", ref)
    if (ref !~ /^[0-9.]+(:[0-9]+)?$/) refs[ref]++
  }
} END { for (ref in refs) print refs[ref], ref }' "$log_file" | sort -rn | head -15

echo
echo "Download clicks"
awk '$7 ~ /oio_event=download_(ios|android)/ { events[$7 ~ /download_ios/ ? "iOS" : "Android"]++ }
END { print events["iOS"] + 0, "iOS"; print events["Android"] + 0, "Android" }' "$log_file"
