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
add "Diff — whitespace-only changes suppressed" \
    '(cd $DIFF_REPO && $QUILL whitespace.ts --diff-ref base)' \
    "config block re-indentation (2→4 spaces) shows as context (no red/green bg), NOT as modified. Both old/new sides visible with different indent but no diff coloring."
add "Diff — offset-only changes suppressed" \
    '(cd $DIFF_REPO && $QUILL whitespace.ts --diff-ref base)' \
    "Lines pushed down by the added import (greet, process, FORMAT, export) show as context, NOT as modified. Only the actual changes are highlighted: added import, added Array.isArray check, added log() call."
add "Diff — Tab annotation cycling with file-level annotation" \
    '(cd $DIFF_REPO && $QUILL long.ts --diff-ref base --annotations $F/annotations-diff-tab.json)' \
    "Tab cycles: diff-fl (file-level, L1) → diff-mid (L24-26, divide fn) → diff-bottom (L70-73, well off-screen). Each Tab scrolls box fully into view in right pane. File-level box shows 📄 marker. Shift+Tab reverses. No blank/empty screen on any Tab press. Bottom annotation must scroll into view from off-screen."

# Expandable collapsed regions — uses expand.ts (311 lines, 7 hunks, 6 collapsed
# regions including two large gaps: ~89 lines between sections 1↔3 and ~84
# lines between sections 3↔5)
add "Diff — collapsed region display (large gaps)" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Multiple collapsed separators visible with @@ hunk headers: e.g. '@@ -34,89 +34,89 @@ ··· 89 lines hidden ···'. The two largest should show ~89 and ~84 hidden lines (sections 2 and 4 — string/math utils). Help bar shows [[/]] expand hint. j/k cursor movement skips over collapsed rows. Scroll through all hunks to verify separators between each."
add "Diff — expand down (] key) on large region" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Start at top (hunk 1: config changes). Press G to go near bottom of hunk 1. Press ] → first 20 lines of the 89-line gap expand with distinct blue-gray bg (capitalize, camelCase, snakeCase…). Separator updates to show ~69 hidden. Press ] again → 20 more expand (~49 hidden). Press ] twice more → region fully expanded, separator disappears. Expanded lines show section 2 string utility functions."
add "Diff — expand up ([ key) on large region" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Navigate to hunk 2 (section 3: array utils ~line 123). Press [ → bottom 20 lines of the 89-line gap expand upward (reverse, isPalindrome, countOccurrences…). Separator updates to ~69 hidden. Cursor stays on the same hunk line. Repeated [ reveals more lines from the bottom edge of the gap."
add "Diff — expand all / collapse all (E key) with many regions" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Press E: ALL 6 collapsed regions expand — entire 311-line file visible in diff mode. Expanded sections (string utils, math utils) show with expanded-context bg. Scroll through to verify all content present. Press E again: all regions collapse back, separators return with original line counts. Cursor snaps to nearest visible hunk line."
add "Diff — expand persists across raw/diff toggle" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Press ] a couple times to expand part of the 89-line string utils gap. Note which functions are visible (e.g. capitalize through padRight). Press d to toggle to raw mode — see full file. Press d again to return to diff mode. The same expanded lines are still visible, separator still shows correct reduced hidden count."
add "Diff — annotation auto-expand on Tab (hidden annotations)" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base --annotations $F/annotations-diff-expand.json)' \
    "Three annotations loaded: expand-visible (L18-20, inside hunk 1), expand-hidden-sec2 (L60-63, padLeft/padRight area inside 89-line gap), expand-hidden-sec4 (L170-175, median area inside 84-line gap). Tab to expand-visible: normal, already in hunk. Tab to expand-hidden-sec2: region auto-expands surgically around lines 60-63 with padding, annotation box visible. Tab to expand-hidden-sec4: second large region expands around lines 170-175. Both collapsed regions partially expand — some lines still hidden on edges."
add "Diff — goto auto-expand (:N) into collapsed region" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Press : then type 50 Enter → line 50 is deep inside the 89-line collapsed gap (truncate function). Region auto-expands to reveal line 50, cursor lands on it. Collapsed separator updates to show fewer hidden lines. Try :180 Enter → inside the 84-line math gap (factorial area). That region also auto-expands. Both regions now partially expanded."
add "Diff — pre-loaded annotations auto-expand at startup" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base --annotations $F/annotations-diff-expand.json)' \
    "On launch (diff mode), the two annotations targeting collapsed regions (expand-hidden-sec2 at L60-63, expand-hidden-sec4 at L170-175) cause their regions to auto-expand immediately. Scroll to see: the 89-line gap shows some expanded lines around padLeft/padRight area with annotation box. The 84-line gap shows expanded lines around median area with annotation box. No manual expand needed — annotation boxes visible from the start."
add "Diff — search with hidden matches in large gaps" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "/ search for 'return' — matches exist in visible hunks AND in collapsed sections 2 and 4. Status bar shows total match count with '(N hidden)' indicator where N is substantial (many return statements in the ~170 hidden lines). n/N only jumps between visible matches. Press E to expand all, search again — all matches now navigable, hidden count drops to 0."
add "Diff — expanded context cursor navigation and interaction" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Press ] to expand top of first gap. j/k moves cursor through expanded-context lines (capitalize, camelCase functions). Can navigate smoothly between hunk 1 context → expanded lines → collapsed separator → hunk 2 context. Try v to start selection on an expanded line, extend with j, press a to create annotation — annotation is created on expanded-context lines. Expanded lines are fully interactive, not read-only."
add "Diff — stable cursor position on expand ([/])" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Move cursor to a hunk line (e.g. j j j to line 3). Note cursor's visual position on screen. Press ] to expand nearest region below. Cursor stays on the SAME SCREEN ROW — viewport scrolls so the cursor doesn't jump. Press ] again — same behavior. Press [ — cursor stays pinned at same screen row. Press E to expand all — cursor stays visually stable."
add "Diff — stable cursor position on raw/diff toggle (d)" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Scroll down to a mid-file hunk. Note cursor's visual position (e.g. middle of screen). Press d to toggle to raw mode. The same line should appear at the same vertical position on screen — no jump to top or scroll-off repositioning. Press d again to go back to diff — cursor stays at same screen position."
add "Diff — stable cursor position on goto (:N)" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Move cursor to roughly middle of viewport. Press :100 Enter. Line 100 should appear at the SAME screen row where the cursor was, not at scroll-off position. Try :200 — same behavior. The viewport scrolls such that the target line lands exactly where your cursor was."
add "Diff — stable cursor position on search navigation (n/N)" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Search for 'const'. Cursor lands on first match. Note screen row. Press n — next match appears at same screen row, viewport scrolls to accommodate. Press N — previous match at same screen position. Rapid n/N should feel like the cursor is pinned and content scrolls past it."
add "Diff — expand keys no-op in select mode" \
    '(cd $DIFF_REPO && $QUILL expand.ts --diff-ref base)' \
    "Navigate to hunk 1. Press v to enter select mode. Press ] — no expansion happens, no crash. Press [ — same, no-op. Press E — no-op. Press Esc to exit select. Now press ] — expansion works normally. Select mode blocks expand keys."

# Diff pairing quality — verifies del/add alignment produces minimal, readable diffs
add "Diff pairing — reorder (functions moved + new import)" \
    '(cd $DIFF_REPO && $QUILL pairing-reorder.ts --diff-ref base)' \
    "Look at the top of the diff, around the imports. BUG: you'll see a row where the LEFT pane shows an empty line and the RIGHT pane shows 'import { gamma }...' — both sides have text, both colored. This is wrong. EXPECTED after fix: 'import { gamma }' should appear ONLY in the right pane (green bg) with the left pane being a solid dark empty fill — because this is a pure addition, not an edit of the empty line."
add "Diff pairing — unequal blocks (2 dels, 5 adds)" \
    '(cd $DIFF_REPO && $QUILL pairing-unequal.ts --diff-ref base)' \
    "Look at lines 2-3 area. BUG: you'll see rows where LEFT shows 'const b = 2' and RIGHT shows 'function helper()' on the same row, as if one was edited into the other. Same for 'const c = 3' paired with 'console.log(x)'. EXPECTED after fix: 'const b' and 'const c' should each appear ONLY on the left (red bg, dark empty right), and the entire function helper block should appear ONLY on the right (green bg, dark empty left)."
add "Diff pairing — equal size unrelated (3 imports → 3 calculations)" \
    '(cd $DIFF_REPO && $QUILL pairing-equal.ts --diff-ref base)' \
    "Look at lines 2-4. BUG: you'll see 'import { foo }' on the left paired with 'const x = calculate()' on the right, on the same row — as if the import was edited into the calculation. Same for bar/transform and baz/finalize. EXPECTED after fix: all 3 imports should appear ONLY on the left (red bg, dark empty right), all 3 calculations ONLY on the right (green bg, dark empty left)."
add "Diff pairing — true edits (control case, should NOT change)" \
    '(cd $DIFF_REPO && $QUILL pairing-true-edit.ts --diff-ref base)' \
    "Look at lines 2-4. You should see 'const b = 2' on the left and 'const b = 22' on the right, ON THE SAME ROW. Same for c=3→33 and d=4→44. This is CORRECT — these are genuine edits of the same line, so showing them side-by-side is the right behavior. This should look the same before and after the fix."

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
add "File-level comments — display and output" \
    "$QUILL $F/sample.ts --annotations $F/annotations-file-level.json" \
    "Tab to fl-1/fl-2: boxes on L1 show 📄 file marker. Tab to fl-line (L12): normal box. Approve → check output: fl-1/fl-2 have startLine:0,endLine:0,fileLevel:true; fl-line has startLine:12"
add "Annotation status cycle — [s] key" \
    "$QUILL $F/sample.ts --annotations $F/annotations-approve-dismiss.json --focus-annotation ad-1" \
    "ad-1 focused: [s] → 👍 approved, [s] → 👎 dismissed, [s] → cleared. Box height stays stable on each toggle. Tab to ad-pre-approved (L50): [s] cycles to dismissed then none. Approve → output JSON has correct status fields"
add "Scroll into view — annotation on last line" \
    "$QUILL $F/long-tail.ts --annotations $F/annotations-long-tail.json" \
    "Tab to tail-2 (L58–60): entire box visible incl. replies, hints, bottom border. No clipping."

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
