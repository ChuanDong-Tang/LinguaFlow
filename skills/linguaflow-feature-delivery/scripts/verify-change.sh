#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

usage() {
  echo "Usage: $0 --scope backend|mobile|all [--profile focused|affected-flow|release-core]" >&2
  exit 2
}

scope=""
profile=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      scope="${2:-}"
      shift 2
      ;;
    --profile)
      profile="${2:-}"
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$scope" in
  backend|mobile|all) ;;
  *) usage ;;
esac

if [[ "$scope" == "mobile" || "$scope" == "all" ]]; then
  case "$profile" in
    focused|affected-flow|release-core) ;;
    *) usage ;;
  esac
elif [[ -n "$profile" ]]; then
  usage
fi

echo "[verify] git diff"
git diff --check
git diff --cached --check

run_tests() {
  local label="$1"
  shift
  local -a files=("$@")
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "[verify] $label: no tests"
    return
  fi
  echo "[verify] $label: ${#files[@]} test file(s)"
  node --import tsx --test "${files[@]}"
}

if [[ "$scope" == "backend" || "$scope" == "all" ]]; then
  backend_tsc="$repo_root/api/node_modules/.bin/tsc"
  [[ -x "$backend_tsc" ]] || { echo "Missing API TypeScript compiler: $backend_tsc" >&2; exit 1; }
  backend_tests=()
  while IFS= read -r file; do backend_tests+=("$file"); done < <(find packages/core/src server/src api/src -type f -name '*.test.ts' | sort)
  run_tests "backend" "${backend_tests[@]}"
  echo "[verify] backend types"
  "$backend_tsc" --noEmit -p api/tsconfig.json
fi

if [[ "$scope" == "mobile" || "$scope" == "all" ]]; then
  mobile_tsc="$repo_root/apps/mobile/node_modules/.bin/tsc"
  [[ -x "$mobile_tsc" ]] || { echo "Missing Mobile TypeScript compiler: $mobile_tsc" >&2; exit 1; }
  mobile_tests=()
  while IFS= read -r file; do mobile_tests+=("$file"); done < <(find apps/mobile/src -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort)
  run_tests "mobile" "${mobile_tests[@]}"
  echo "[verify] mobile types"
  "$mobile_tsc" --noEmit -p apps/mobile/tsconfig.json

  if [[ "$profile" == "release-core" ]]; then
    echo "[verify] sequential iOS 26 / iOS 27 / Android startup gate"
    bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --run
  else
    echo "[verify] simulator matrix deferred by profile=$profile; record the affected interaction evidence in the change record"
  fi
fi

echo "[verify] passed scope=$scope${profile:+ profile=$profile}"
