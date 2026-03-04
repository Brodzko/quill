#!/usr/bin/env bash
#
# Create a temporary git repo with two commits for diff e2e testing.
# Outputs the repo path to stdout. Caller is responsible for cleanup.
#
# Commit 1 (tag: base): diff-base.ts as "code.ts"
# Commit 2 (HEAD):      diff-modified.ts as "code.ts"
#
# Usage:
#   DIFF_REPO=$(./e2e/setup-diff-repo.sh)
#   node dist/cli.js "$DIFF_REPO/code.ts" --diff-ref base
#   rm -rf "$DIFF_REPO"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$SCRIPT_DIR/fixtures"

REPO=$(mktemp -d "${TMPDIR:-/tmp}/quill-e2e-diff-XXXXXX")

cd "$REPO"
git init -q
git config user.email "e2e@test"
git config user.name "e2e"

# Commit 1: base version
cp "$F/diff-base.ts" code.ts
git add code.ts
git commit -q -m "base version"
git tag base

# Commit 2: modified version
cp "$F/diff-modified.ts" code.ts
git add code.ts
git commit -q -m "modified version"

echo "$REPO"
