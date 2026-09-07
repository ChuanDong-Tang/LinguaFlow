#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

usage() {
  echo "Usage: $0 --check | --deploy --confirm-production" >&2
  exit 2
}

mode="${1:-}"
case "$mode" in
  --check)
    [[ $# -eq 1 ]] || usage
    npx prisma validate --schema prisma/schema.prisma
    npx prisma migrate status --schema prisma/schema.prisma
    ;;
  --deploy)
    [[ "${2:-}" == "--confirm-production" && $# -eq 2 ]] || usage
    git diff --check
    npx prisma validate --schema prisma/schema.prisma
    npx prisma migrate status --schema prisma/schema.prisma || true
    npx prisma migrate deploy --schema prisma/schema.prisma
    npx prisma migrate status --schema prisma/schema.prisma || true
    ;;
  *)
    usage
    ;;
esac
