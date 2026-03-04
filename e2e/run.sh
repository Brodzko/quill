#!/usr/bin/env bash
#
# Local e2e test runner for Quill.
#
# Usage:
#   ./e2e/run.sh              # Interactive picker
#   ./e2e/run.sh <number>     # Run a specific scenario
#   ./e2e/run.sh list         # List all scenarios
#   ./e2e/run.sh build        # Build first, then pick scenario
#
# Each scenario launches Quill interactively. Exit with Ctrl+C (abort) or
# approve/deny to produce JSON output on stdout.
#
# Requires: node, git (for diff scenarios)
# Build first: npm run build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
QUILL="node $ROOT_DIR/dist/cli.js"
F="$SCRIPT_DIR/fixtures"

# Diff test repo (created lazily, cleaned up on exit)
DIFF_REPO=""
setup_diff_repo() {
  if [[ -z "$DIFF_REPO" ]]; then
    DIFF_REPO=$("$SCRIPT_DIR/setup-diff-repo.sh")
  fi
}
cleanup_diff_repo() {
  if [[ -n "$DIFF_REPO" && -d "$DIFF_REPO" ]]; then
    rm -rf "$DIFF_REPO"
  fi
}
trap cleanup_diff_repo EXIT

# Colors
B='\033[1m'
D='\033[2m'
C='\033[36m'
G='\033[32m'
Y='\033[33m'
R='\033[31m'
X='\033[0m'

# --- Scenario definitions (parallel arrays) ---

DESC=()
CMD=()
CHECK=()

add() { DESC+=("$1"); CMD+=("$2"); CHECK+=("$3"); }

# Raw mode basics
add "Raw mode — basic file view" \
    "$QUILL $F/sample.ts" \
    "Syntax highlighting, line numbers, cursor (j/k/G/gg), help bar"
add "Raw mode — start at line" \
    "$QUILL $F/sample.ts --line 50" \
    "Cursor at line 50, viewport scrolled"
add "Raw mode — horizontal scroll" \
    "$QUILL $F/sample.ts --line 80" \
    "Line 80 (long), h/l scrolls, ← indicator, 0 resets"
add "Raw mode — tiny file (1 line)" \
    "$QUILL $F/tiny.ts" \
    "Single line, ~ tildes fill viewport, no crash at boundaries"
add "Raw mode — empty file" \
    "$QUILL $F/empty.ts" \
    "No crash, ~ tildes, can approve/deny"

# Annotations from file
add "Annotations — load from file" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json" \
    "4 annotations, ● markers, Tab cycles, boxes expand/collapse"
add "Annotations — focus specific" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json --focus-annotation e2e-2" \
    "Starts at e2e-2 (L38-40), box expanded, ◎ marker"
add "Annotations — edge cases" \
    "$QUILL $F/sample.ts --annotations $F/annotations-edge.json" \
    "First-line ann works, multi on line 3 shows count, string coercion"
add "Annotations — pipe via stdin" \
    "cat $F/annotations-basic.json | $QUILL $F/sample.ts" \
    "Same as --annotations via pipe, 4 annotations loaded"
add "Annotations — empty set" \
    "$QUILL $F/sample.ts --annotations $F/annotations-empty.json" \
    "No markers, clean gutter, can create new annotations"

# Annotation CRUD
add "Create annotation" \
    "$QUILL $F/sample.ts" \
    "v select, j/k extend, a annotate, pick intent, type comment, Enter saves"
add "Reply to annotation" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json --focus-annotation e2e-1" \
    "r reply, type text, Enter saves, reply in box"
add "Edit annotation" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json --focus-annotation e2e-1" \
    "e edit, existing text in textbox, modify + Enter, updated"
add "Delete annotation" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json --focus-annotation e2e-1" \
    "x delete, confirm prompt, y confirms, annotation gone"
add "Approve/Deny workflow" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json" \
    "Shift+A decide, a=approve/d=deny, JSON on stdout, all annotations included"

# Search
add "Search mode" \
    "$QUILL $F/sample.ts" \
    "/ search, type 'annotation', matches highlighted, n/N cycle, Esc exits"

# Diff mode (uses self-contained temp git repo — no dependency on project history)
# Commands cd into the temp repo so git resolves refs correctly.
add "Diff — side-by-side view" \
    '(cd $DIFF_REPO && $QUILL code.ts --diff-ref base)' \
    "Side-by-side panes, add/remove/modify colors, hunk headers, title (diff: base)"
add "Diff — toggle raw/diff" \
    '(cd $DIFF_REPO && $QUILL code.ts --diff-ref base)' \
    "d toggles raw↔diff, cursor snaps on toggle, help bar updates"
add "Diff — horizontal scroll" \
    '(cd $DIFF_REPO && $QUILL code.ts --diff-ref base)' \
    "h/l scrolls both panes, ← indicator on long line, 0 resets"
add "Diff — annotations in diff" \
    '(cd $DIFF_REPO && $QUILL code.ts --diff-ref base)' \
    "v/j/a create annotation on diff line, box in right pane, Tab cycles, toggle preserves"
add "Diff — no changes fallback" \
    '(cd $DIFF_REPO && $QUILL code.ts --diff-ref HEAD)' \
    "'No differences found' message, opens raw, d is no-op"

# Resize / edge
add "Terminal resize" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json" \
    "Resize window, viewport reflows, no artifacts, boxes reflow"
add "Narrow terminal (≤60 cols)" \
    "$QUILL $F/sample.ts --annotations $F/annotations-basic.json" \
    "Shrink to ~60 cols, content truncates cleanly, no overlap"
add "Go-to-line" \
    "$QUILL $F/sample.ts" \
    ": goto, type number, Enter jumps, Esc cancels"

TOTAL=${#DESC[@]}

# --- Helpers ---

print_header() {
  echo -e "\n${B}${C}═══════════════════════════════════════════════${X}"
  echo -e "${B}${C}  Quill E2E Test Runner  (${TOTAL} scenarios)${X}"
  echo -e "${B}${C}═══════════════════════════════════════════════${X}\n"
}

list_scenarios() {
  for ((i=0; i<TOTAL; i++)); do
    echo -e "  ${B}$((i+1)))${X} ${DESC[$i]}"
    echo -e "     ${D}${CMD[$i]}${X}"
    echo -e "     ${G}${CHECK[$i]}${X}"
    echo
  done
}

run_scenario() {
  local idx=$(($1 - 1))
  echo -e "\n${B}${Y}━━━ Scenario $(($1)): ${DESC[$idx]} ━━━${X}"
  echo -e "${D}Command: ${CMD[$idx]}${X}"
  echo -e "${G}Check: ${CHECK[$idx]}${X}"
  echo -e "${D}Press Enter to launch, Ctrl+C to skip...${X}"
  read -r

  # Lazy-init diff repo if any diff scenario needs it
  setup_diff_repo

  echo -e "${C}Launching...${X}\n"
  eval "${CMD[$idx]}" || true

  echo -e "\n${Y}Did it pass? [y/n/s(kip)] ${X}"
  read -r -n1 result
  echo
  case "$result" in
    y|Y) echo -e "${G}✓ PASS${X}" ;;
    n|N) echo -e "${R}✗ FAIL${X}" ;;
    *)   echo -e "${D}— SKIPPED${X}" ;;
  esac
}

# --- Main ---

if [[ ! -f "$ROOT_DIR/dist/cli.js" ]]; then
  echo -e "${R}Build not found. Run 'npm run build' first.${X}"
  echo -e "${D}Or: ./e2e/run.sh build${X}"
  exit 1
fi

if [[ "${1:-}" == "build" ]]; then
  echo -e "${C}Building...${X}"
  (cd "$ROOT_DIR" && npm run build)
  echo -e "${G}Build complete.${X}\n"
  shift || true
fi

case "${1:-}" in
  list)
    print_header
    list_scenarios
    exit 0
    ;;
  [0-9]*)
    if (( $1 < 1 || $1 > TOTAL )); then
      echo -e "${R}Invalid scenario. Range: 1-${TOTAL}${X}"
      exit 1
    fi
    run_scenario "$1"
    exit 0
    ;;
esac

# Interactive picker
print_header
for ((i=0; i<TOTAL; i++)); do
  echo -e "  ${B}$((i+1)))${X} ${DESC[$i]}"
done
echo -e "\n  ${B}a)${X} Run all sequentially"
echo -e "  ${B}q)${X} Quit\n"

while true; do
  echo -ne "${C}Pick [1-${TOTAL}/a/q]: ${X}"
  read -r choice
  case "$choice" in
    q|Q) echo "Bye."; exit 0 ;;
    a|A)
      for ((i=1; i<=TOTAL; i++)); do run_scenario "$i"; done
      echo -e "\n${B}${G}All scenarios complete.${X}"
      exit 0
      ;;
    [0-9]*)
      if (( choice >= 1 && choice <= TOTAL )); then
        run_scenario "$choice"
      else
        echo -e "${R}Invalid. Range: 1-${TOTAL}${X}"
      fi
      ;;
    *) echo -e "${R}Invalid choice.${X}" ;;
  esac
done
