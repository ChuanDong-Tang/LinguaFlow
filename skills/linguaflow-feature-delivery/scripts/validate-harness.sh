#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

git diff --check
git diff --cached --check

while IFS= read -r script; do
  bash -n "$script"
done < <(find skills/linguaflow-* -type f -name '*.sh' | sort)

while IFS= read -r script; do
  node --check "$script"
done < <(find skills/linguaflow-* -type f -name '*.mjs' | sort)

node skills/linguaflow-live-version-repair/scripts/repair-record.mjs self-test
node skills/linguaflow-android-release/scripts/release-acceptance.mjs self-test
node skills/linguaflow-feature-delivery/scripts/change-record.mjs self-test

while IFS= read -r skill; do
  first_line="$(sed -n '1p' "$skill")"
  name_line="$(sed -n '2p' "$skill")"
  description_line="$(sed -n '3p' "$skill")"
  fourth_line="$(sed -n '4p' "$skill")"
  [[ "$first_line" == '---' && "$fourth_line" == '---' ]] || fail "Invalid frontmatter boundary: $skill"
  [[ "$name_line" =~ ^name:\ [a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || fail "Invalid Skill name: $skill"
  [[ "$description_line" == description:\ * ]] || fail "Missing Skill description: $skill"
  ! grep -En '^\[TODO:|TODO placeholder' "$skill" >/dev/null || fail "Unfinished Skill placeholder: $skill"
done < <(find skills/linguaflow-* -mindepth 1 -maxdepth 1 -type f -name SKILL.md | sort)

if git ls-files 'skills/linguaflow-*/config/*.env' | grep -v '\.env\.example$' | grep -q .; then
  fail "A populated Skill environment file is tracked"
fi

echo "Harness validation passed"
