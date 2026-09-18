#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

echo "[incident] local"
echo "branch=$(git branch --show-current)"
echo "head=$(git rev-parse HEAD)"
echo "working_tree_changes=$(git status --porcelain | wc -l | tr -d ' ')"

echo "[incident] production backend"
bash skills/linguaflow-backend-deploy/scripts/backend-status.sh

echo "[incident] snapshot complete (read-only)"
