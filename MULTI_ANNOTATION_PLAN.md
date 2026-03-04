# Multi-Annotation Per Line — Design Plan

## Problem

When multiple annotations overlap on the same line, the current model treats
them as a group with no way to distinguish or target individuals:

- Tab cycles **lines**, not annotations — two annotations on L5 are one stop
- `c` toggles **all** annotations on the cursor line at once
- `r`/`w`/`x` use `.find()` to pick the first expanded annotation — the second
  is unreachable
- Both boxes show action hints, misleadingly implying both are targets
- The gutter shows a single `●`/`▼` with no count indicator
- Lines covered by an expanded annotation's range get no visual emphasis

## Design

### New state: `focusedAnnotationId`

Add `focusedAnnotationId: string | null` to `SessionState`. This is the
**single annotation** currently targeted by keyboard actions. It's orthogonal to
`expandedAnnotations` (which controls visibility).

Rules:

- `focusedAnnotationId` is always either `null` or the id of an annotation
  whose range includes the current `cursorLine`
- Moving the cursor to a line with no annotations clears focus to `null`
- Moving the cursor to a line with annotations auto-focuses the first one
  (by array order) if focus was `null` or pointed to an annotation not on
  the new line
- Creating a new annotation auto-focuses it
- Deleting the focused annotation advances focus to the next annotation on
  the same line, or clears to `null` if none remain

New reducer action:

```
| { type: 'focus_annotation'; annotationId: string | null }
```

### Tab / Shift+Tab — cycle individual annotations

`jumpToNextAnnotation` changes from cycling unique `endLine` values to cycling
a flat list of individual annotations, sorted by `(endLine, startLine, arrayIndex)`.

Behavior:

1. Collect all annotations, sorted by `endLine` asc, then `startLine` asc, then
   insertion order.
2. Find the currently focused annotation in that list.
3. Advance by `direction` (wrapping).
4. **Collapse** the previously focused annotation (not all on the line).
5. **Move cursor** to the new annotation's `endLine`.
6. **Expand + focus** the new annotation.

This means two annotations on L5 are two separate Tab stops. The cursor stays
on L5 but focus shifts from annotation A to annotation B.

### `c` — toggle all annotations on cursor line (unchanged)

`c` remains a **line-level** operation: it toggles all annotations whose range
includes the cursor line. This is the fast "show/hide everything here" gesture.

Focus is **not** involved in `c`. After toggling:
- If annotations were expanded → they collapse. Focus clears to `null` (no
  expanded annotation to target).
- If annotations were collapsed → they expand. Focus auto-sets to the first
  newly-expanded annotation on the line.

### `C` (Shift+C) — toggle all annotations globally (unchanged)

Keep current behavior: if any are expanded, collapse all; otherwise expand all.
This is the bulk escape hatch.

### `r` / `w` / `x` — target focused annotation

Replace `.find(a => expandedAnnotations.has(a.id))` with a direct lookup of
`focusedAnnotationId`. If the focused annotation is not expanded, these are
no-ops (you must expand it first with `c`, or Tab into it).

### Action hints + border color — only on focused annotation's box

`renderAnnotationBox` receives a new `isFocused: boolean` option. When focused:

- **Border color** uses an accent color (e.g., the existing `USER_ACCENT` or a
  new `FOCUS_BORDER` constant) instead of the default dim `ANN_BORDER`. This
  makes the focused box visually pop when multiple boxes are on screen.
- **Action hints** (`[r]eply  [w] edit  [x] delete  [c] toggle`) render
  **only** when `isFocused && isCursorLine`.

Non-focused boxes keep the current dim border and show no hints.

### Gutter marker — `▸`/`▾` triangles with count

Switch from `●`/`▼`/`◎` to narrow triangles that pair cleanly with digits in
monospace fonts. The marker column becomes a fixed 2 chars wide.

| Condition | Marker | Notes |
|---|---|---|
| No annotations on line | `  ` | 2 spaces |
| 1 annotation, collapsed | `▸ ` | right-pointing triangle + space |
| 1 annotation, expanded | `▾ ` | down-pointing triangle + space |
| N>1, all collapsed | `▸N` | triangle + digit |
| N>1, any expanded | `▾N` | triangle + digit |

Focus is indicated by **color**, not a separate symbol. The focused annotation's
marker (on the line where its box renders, i.e., `endLine`) uses an accent
color. Non-focused markers use the default dim color.

The gutter format becomes: `pointer(1) + lineNum(padded) + space(1) + marker(2) + space(0)`
→ total gutter width = `1 + gutterWidth + 1 + 2` = `gutterWidth + 4` (same as
today since the old marker was 1 char + 1 trailing space, now 2 chars + 0
trailing space).

### Line highlighting for expanded annotation ranges

When an annotation is expanded, highlight its full `startLine..endLine` range
with a subtle background (distinct from cursor bg and selection bg). Call this
`ANNOTATION_RANGE_BG`.

If multiple expanded annotations overlap on a line, the background still applies
(it's binary — any expanded annotation covering this line triggers it).

The focused annotation's range could use a slightly brighter variant
(`FOCUSED_RANGE_BG`) to visually distinguish which annotation "owns" which
lines. This is optional for v1 — a single `ANNOTATION_RANGE_BG` for all
expanded annotations is sufficient to start.

### Overlapping multi-line ranges — worked example

```
L3  ▸2  some code     ← A(L3–L8) + B(L3–L5), both collapsed
L4  ▸2  more code
L5  ▸2  end of B      ← B's box would render here
L6  ▸   still in A
L7  ▸   still in A
L8  ▸   end of A      ← A's box would render here
```

User presses `c` on L4 (cursor line):
- All annotations covering L4 expand (both A and B).
- Focus auto-sets to first expanded annotation on L4 → B (earlier endLine).

```
L3  ▾2  some code     ← both expanded, range highlighted
L4 >▾2  more code     ← cursor here, both expanded
L5  ▾2  end of B      ← B's box renders here, range highlighted
    ┌─ you · comment ─────┐
    │ Fix the naming       │
    │ [r]eply [w] [x] [c] │  ← hints: B is focused
    └──────────────────────┘
L6  ▾   still in A    ← A's range highlighted
L7  ▾   still in A
L8  ▾   end of A      ← A's box renders here
    ┌─ agent · instruct ──┐
    │ Refactor this block  │   ← no hints: A is not focused
    └──────────────────────┘
```

User presses Tab:
- Focus advances from B → A. Cursor moves to L8 (A's endLine).
- B stays expanded (Tab doesn't collapse non-focused annotations).
- A's box now shows action hints; B's box loses them.

```
L3  ▾2  some code
L4  ▾2  more code
L5  ▾2  end of B
    ┌─ you · comment ─────┐
    │ Fix the naming       │   ← no hints: B lost focus
    └──────────────────────┘
L6  ▾   still in A    ← A's range highlighted
L7  ▾   still in A
L8 >▾   end of A      ← cursor here, A focused
    ┌─ agent · instruct ──┐
    │ Refactor this block  │
    │ [r]eply [w] [x] [c] │  ← hints: A is focused
    └──────────────────────┘
```

User presses `c` on L8:
- All annotations covering L8 toggle → only A covers L8, so A collapses.
- Focus clears (no expanded annotations on cursor line).

User presses Tab:
- Finds next annotation after A in sort order → wraps to B.
- Cursor moves to L5. B is already expanded, so it stays. B gets focus.

### Edge case: cursor movement clears/updates focus

When the user moves the cursor with `j`/`k` (not Tab):

- If the new line has no annotations → clear focus to `null`
- If the new line has annotations and the currently focused annotation's range
  covers the new line → keep focus (user is scrolling within the range)
- If the new line has expanded annotations and focus was elsewhere → auto-focus
  the **first expanded** annotation on the new line
- If the new line has annotations but none are expanded → focus is `null`
  (annotations are present but hidden; the user presses `c` to reveal, which
  auto-focuses the first one)

Key distinction: `j`/`k` only auto-focus **expanded** annotations. This avoids
surprising the user with a focus target they can't see. Tab is the explicit
"show me the next annotation" gesture.

### Edge case: creating an annotation on a line that already has one

No restrictions — overlapping annotations are allowed. After creation:
- The new annotation is auto-focused
- The new annotation is auto-expanded
- Previously expanded annotations on the line remain expanded

### Edge case: deleting the focused annotation

After delete:
- If other annotations remain on the cursor line → focus advances to the next
  one (by sort order, wrapping to first)
- If no annotations remain on the line → clear focus to `null`

### Edge case: `--focus-annotation` CLI flag

Currently sets `focusAnnotationId` as a render-time hint in `SessionConfig`.
Change: the CLI layer sets `focusedAnnotationId` directly in `initialState`,
and auto-expands it. Remove the separate `SessionConfig.focusAnnotationId`
field — it's now just initial state.

## Keymap changes

| Key | Current behavior | New behavior |
|---|---|---|
| `Tab` | Jump to next annotated **line** | Jump to next **annotation** |
| `Shift+Tab` | Jump to prev annotated **line** | Jump to prev **annotation** |
| `c` | Toggle all annotations on cursor line | **No change** — stays line-level |
| `C` | Toggle all annotations globally | No change |
| `r` | Reply to first expanded on cursor line | Reply to **focused** annotation |
| `w` | Edit first expanded on cursor line | Edit **focused** annotation |
| `x` | Delete first expanded on cursor line | Delete **focused** annotation |

## Files touched

| File | Changes |
|---|---|
| `src/state.ts` | Add `focusedAnnotationId` to `SessionState`, add `focus_annotation` action, update reducer |
| `src/dispatch.ts` | Rewrite `jumpToNextAnnotation`, update `c`/`r`/`w`/`x` handlers to use focus |
| `src/render.ts` | Update `lineMarker` for counts, pass `isFocused` to box renderer, add range highlighting |
| `src/annotation-box.ts` | Add `isFocused` option, conditionally render hints, swap border color |
| `src/ansi.ts` | Add `FOCUS_BORDER` color constant |
| `src/keymap.ts` | Update hint text for `c` ("toggle" → "toggle focused") |
| `src/session.ts` | Remove `focusAnnotationId` from `SessionConfig`, read from state |
| `src/cli.ts` | Set `focusedAnnotationId` in `initialState` instead of `SessionConfig` |
| Tests | Update all affected test files |

## Implementation order

1. **State**: Add `focusedAnnotationId` to `SessionState` + reducer action + auto-focus logic on cursor move
2. **Dispatch**: Rewrite `jumpToNextAnnotation` to cycle annotations; update `c`/`r`/`w`/`x` to use focus
3. **Render — gutter**: Update `lineMarker` to show counts
4. **Render — box**: Pass `isFocused`, conditionally show hints
5. **Render — range highlight**: Add `ANNOTATION_RANGE_BG` for expanded annotation ranges
6. **CLI/session**: Migrate `--focus-annotation` to initial state
7. **Tests**: Update existing, add multi-annotation scenarios

## Resolved decisions

1. **Gutter width**: Fixed 2-char marker column. `▸ ` / `▾ ` for single, `▸N` / `▾N` for multi.
2. **`c` scope**: Line-level (unchanged). Focus is only for `r`/`w`/`x` targeting.
3. **Cursor movement auto-focus**: Only auto-focuses the first **expanded** annotation on
   the new line. Collapsed-only lines get `null` focus. Tab is the explicit reveal gesture.
4. **Focus indication**: Color on the marker, not a separate symbol.

## Open questions

1. **Range highlight color**: Needs to be distinct from cursor, selection, and
   search match backgrounds. Suggest a very subtle dark blue or dark green.
2. **Tab collapse behavior**: Should Tab collapse the *previously focused*
   annotation when jumping away, or leave all expanded states untouched?
   Current plan: leave untouched (Tab only expands the target + moves focus).
   The user uses `c` to bulk-collapse on a line. This avoids surprising
   state changes during navigation.
3. **Count display cap**: What if a line has 10+ annotations? `▸9` is fine
   but `▸12` is 3 chars. Cap at `9+`? Unlikely in practice but worth defining.
