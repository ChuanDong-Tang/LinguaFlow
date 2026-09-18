#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

usage() {
  echo "Usage: $0 --commit <commit> --restart api|worker|both|none (--dry-run | --confirm-production)" >&2
  exit 2
}

requested_commit=""
restart=""
dry_run=false
confirm_production=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) requested_commit="${2:-}"; shift 2 ;;
    --restart) restart="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --confirm-production) confirm_production=true; shift ;;
    *) usage ;;
  esac
done

[[ -n "$requested_commit" && -n "$restart" ]] || usage
case "$restart" in api|worker|both|none) ;; *) usage ;; esac
if [[ "$dry_run" == "$confirm_production" ]]; then
  echo "Choose exactly one of --dry-run or --confirm-production" >&2
  exit 2
fi

commit="$(git rev-parse --verify "${requested_commit}^{commit}")"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit" >&2; exit 1; }
git merge-base --is-ancestor "$commit" origin/main || {
  echo "Commit is not present on the current origin/main tracking ref; push or fetch first" >&2
  exit 1
}

echo "host=oio-main"
echo "path=/opt/oio-production"
echo "commit=$commit"
echo "restart=$restart"

if [[ "$dry_run" == true ]]; then
  echo "dry_run=true (no SSH or production mutation performed)"
  exit 0
fi

ssh oio-main "set -euo pipefail
cd /opt/oio-production
test -z \"\$(git status --porcelain)\"
git fetch origin main
git merge-base --is-ancestor HEAD origin/main
git pull --ff-only origin main
test \"\$(git rev-parse HEAD)\" = '$commit'
case '$restart' in
  api) pm2 restart oio-api-production --update-env ;;
  worker) pm2 restart oio-worker-production --update-env ;;
  both) pm2 restart oio-api-production oio-worker-production --update-env ;;
  none) ;;
esac
sleep 2
test \"\$(pm2 pid oio-api-production)\" != \"0\"
test \"\$(pm2 pid oio-worker-production)\" != \"0\"
curl -fsS --max-time 10 http://127.0.0.1:3102/health >/dev/null
echo deployed_commit=\$(git rev-parse HEAD)
echo api_health=ok
echo worker_health=online"
