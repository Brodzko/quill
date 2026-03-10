# Expandable Collapsed Regions in Diff Mode

## Goal

Replace static hunk-header separators with interactive collapsed regions that
can be expanded/collapsed on demand. Auto-expand regions when annotations need
to be visible. This eliminates all annotation-range/diff-range overlap bugs
at the root — annotations always render at their real `endLine`.

## Constraints

- `DiffData` stays immutable (computed once at startup)
- Expansion state lives on `SessionState`, survives mode toggles
- Expanded context lines are fully navigable (cursor, annotate, select, search)
- Expanded context lines are visually distinguished (subtle background tint)
- Old-file line numbers for expanded regions derived from hunk boundaries
- No performance regression — effective rows recomputed only on expand/collapse

---

## 1. Data Model

### 1.1 CollapsedRegion (new type in `diff-align.ts`)

Computed once by `alignDiff`, stored on `DiffData`. Each region represents a
gap between hunks (or before-first/after-last hunk).

```ts
type CollapsedRegion = {
  /** Stable index (0-based, ordered by position in file). */
  readonly index: number;
  /** New-file line range, 1-indexed, inclusive. */
  readonly newStartLine: number;
  readonly newEndLine: number;
  /** Old-file line range, 1-indexed, inclusive. */
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  /** Total hidden lines (newEndLine - newStartLine + 1). */
  readonly lineCount: number;
  /**
   * Index into base DiffData.rows where this region sits.
   * The region logically lives between rows[insertAfterRow] and
   * rows[insertAfterRow + 1]. -1 = before first row.
   */
  readonly insertAfterRow: number;
};
```

### 1.2 DiffData additions

```ts
type DiffData = {
  // ... existing fields ...
  /** Collapsed regions between/around hunks. Ordered by file position. */
  readonly collapsedRegions: readonly CollapsedRegion[];
};
```

### 1.3 RegionExpansion (new type in `state.ts`)

Per-region expansion state. Tracks how many lines are revealed from each edge.

```ts
type RegionExpansion = {
  /** Lines revealed from the top of the region (expanding downward from upper hunk boundary). */
  readonly fromTop: number;
  /** Lines revealed from the bottom of the region (expanding upward from lower hunk boundary). */
  readonly fromBottom: number;
};
```

A region is fully expanded when `fromTop + fromBottom >= region.lineCount`.
No entry in the map = fully collapsed.

### 1.4 SessionState additions

```ts
type SessionState = {
  // ... existing fields ...
  /** Per-region expansion state. Key = region index. */
  readonly expandedRegions: ReadonlyMap<number, RegionExpansion>;
};
```

### 1.5 DiffMeta becomes derived

Currently `DiffMeta` is set once at startup. With expandable regions,
`visibleLines`, `newLineToRow`, and `rowCount` change when regions
expand/collapse.

**Approach:** recompute `DiffMeta` from effective rows whenever
`expandedRegions` changes. This is O(effective rows) — fast enough since it
only runs on user-initiated expand/collapse, not on every cursor move.

Store on state as before, but reducer recomputes it after expand/collapse
actions.

### 1.6 DiffLineType changes

```ts
// Replace 'hunk-header' with:
type DiffLineType =
  | 'context'            // original diff context
  | 'added'
  | 'removed'
  | 'modified'
  | 'collapsed'          // replaces hunk-header — shows "N lines hidden"
  | 'expanded-context';  // user-expanded unchanged lines (visually distinct)
```

`AlignedRow` gains optional fields:

```ts
type AlignedRow = {
  // ... existing fields ...
  /** For 'collapsed' rows: the region index. */
  readonly regionIndex?: number;
  /** For 'collapsed' rows: number of currently hidden lines. */
  readonly hiddenLineCount?: number;
};
```

---

## 2. `alignDiff` Changes

### 2.1 Compute collapsed regions

After aligning all hunks, compute gaps using `parse-diff` chunk metadata:
- `chunk.oldStart`, `chunk.newStart`, `chunk.oldLines`, `chunk.newLines`

**Before first hunk** (if `chunk[0].newStart > 1`):
```
region.newStartLine = 1
region.newEndLine   = chunk[0].newStart - 1
region.oldStartLine = 1
region.oldEndLine   = chunk[0].oldStart - 1
```

**Between hunk N and hunk N+1:**
```
region.newStartLine = chunk[N].newStart + chunk[N].newLines
region.newEndLine   = chunk[N+1].newStart - 1
region.oldStartLine = chunk[N].oldStart + chunk[N].oldLines
region.oldEndLine   = chunk[N+1].oldStart - 1
```

**After last hunk** (needs `lineCount` as new parameter):
```
region.newStartLine = lastChunk.newStart + lastChunk.newLines
region.newEndLine   = lineCount
region.oldStartLine = lastChunk.oldStart + lastChunk.oldLines
region.oldEndLine   = region.oldStartLine + (region.newEndLine - region.newStartLine)
```

The after-last-hunk region needs `lineCount`. **`alignDiff` gains a
`lineCount` parameter** (the new-file total line count). Optional — when
omitted, no after-last-hunk region is emitted. Old-file line numbers
derived from hunk boundary offset (1:1 correspondence for unchanged lines).

### 2.2 Replace hunk-header rows with collapsed rows

Current code emits `type: 'hunk-header'` between hunks. Replace with
`type: 'collapsed'` rows carrying `regionIndex` and `hiddenLineCount`.

Skip emitting a collapsed row if the region has 0 lines (adjacent hunks with
overlapping context).

### 2.3 Backward compatibility

The `'hunk-header'` type goes away. Update `DiffLineType`, renderer, and
tests. The collapsed row carries more useful info (line count vs. raw `@@`
header).

---

## 3. Effective Row Resolution

### 3.1 Core function

```ts
const resolveEffectiveRows = (
  baseRows: readonly AlignedRow[],
  collapsedRegions: readonly CollapsedRegion[],
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
  sourceLines: readonly string[],
  oldSourceLines: readonly string[] | undefined,
): AlignedRow[] => { ... };
```

Walks `baseRows`. When encountering a `'collapsed'` row:

1. Look up the region by `regionIndex`.
2. Look up expansion state from `expandedRegions`.
3. Emit revealed lines from top edge as `'expanded-context'` rows (with correct
   old/new line numbers and content from `sourceLines` / `oldSourceLines`).
4. If remaining hidden > 0, emit a `'collapsed'` row with updated
   `hiddenLineCount`.
5. Emit revealed lines from bottom edge as `'expanded-context'` rows.
6. If fully expanded (no remaining hidden), skip the collapsed row entirely.

Non-collapsed rows pass through unchanged.

### 3.2 Line number computation for expanded rows

For a region with `newStartLine = S`, the k-th expanded line from the top:
- `newLineNumber = S + k` (0-indexed k)
- `oldLineNumber = region.oldStartLine + k`
- `content = sourceLines[newLineNumber - 1]` (both sides identical)

For lines expanded from the bottom (region with `newEndLine = E`):
- `newLineNumber = E - (fromBottom - 1 - k)` (0-indexed k from bottom)
- Same old-line offset logic

### 3.3 Performance

Called when: rendering, and when computing effective DiffMeta after
expand/collapse. NOT on every cursor move — cache the result on state or
derive lazily.

**Strategy:** the reducer computes `DiffMeta` from structural info only
(line numbers, row count — no source content needed). The renderer resolves
actual row content for display via `RenderContext`.

---

## 4. State & Reducer Changes

### 4.1 New actions

```ts
type BrowseAction =
  | // ... existing ...
  | { type: 'expand_region'; regionIndex: number; direction: 'up' | 'down'; step: number }
  | { type: 'expand_all_regions' }
  | { type: 'collapse_all_regions' };
```

### 4.2 `expand_region` reducer

1. Look up current `RegionExpansion` for `regionIndex` (default `{fromTop: 0, fromBottom: 0}`).
2. Compute new expansion:
   - `direction: 'down'` → increase `fromTop` by `min(step, remaining)`.
   - `direction: 'up'` → increase `fromBottom` by `min(step, remaining)`.
   - `remaining = region.lineCount - fromTop - fromBottom`.
3. Update `expandedRegions` map.
4. Recompute DiffMeta.
5. Cursor stays on same line (expanding only adds rows, never removes the cursor's line).
6. Recompute viewport offset to keep cursor visible.

### 4.3 `expand_all_regions` reducer

Set every region to fully expanded (`fromTop = region.lineCount, fromBottom = 0`).
Recompute DiffMeta.

### 4.4 `collapse_all_regions` reducer

Clear `expandedRegions` map. Recompute DiffMeta.
**Cursor displacement:** if cursor is on a line that was in an expanded region,
snap to nearest visible line via `clampCursor` (which uses the recomputed
`visibleLines`).

### 4.5 DiffMeta recomputation helper

```ts
const recomputeDiffMeta = (
  baseDiffData: DiffData,
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
): DiffMeta => {
  // Walk base rows + expanded region metadata to compute:
  // - total rowCount (base rows - collapsed rows + expanded lines + remaining separators)
  // - visibleLines (base visible + expanded region lines)
  // - newLineToRow (rebuild mapping with new row indices)
};
```

This is a pure function of structural metadata — no source line content
needed. Keeps the reducer pure.

### 4.6 Existing reducer adjustments

Every place that reads `state.diffMeta` already works — the data shape is
unchanged, only the _values_ change when regions expand. Key areas:

- `moveCursorDiff` — steps through `visibleLines`, now includes expanded lines ✅
- `clampCursor` — snaps to nearest visible, now includes expanded lines ✅
- `computeDiffViewportOffset` — uses `newLineToRow` and `rowCount` ✅
- `nudgeForAnnotationBox` — uses `newLineToRow` ✅

No structural changes needed — recomputing DiffMeta handles everything.

---

## 5. Keybindings

### 5.1 Keys (diff mode only, browse mode)

| Key | Action | Description |
|-----|--------|-------------|
| `[` | expand up | Reveal 20 lines from nearest collapsed region above cursor (from its bottom edge, growing view upward) |
| `]` | expand down | Reveal 20 lines from nearest collapsed region below cursor (from its top edge, growing view downward) |
| `E` | toggle all | If any regions collapsed → expand all. If all expanded → collapse all |

All three keys are no-ops in raw mode and in non-browse modes.

### 5.2 "Nearest region" resolution

**For `]` (expand down):** scan regions by position. Find the first region
whose line range starts at or after the cursor's current line. This is the
region directly below the current "block" (hunk + any already-expanded context
that is contiguous with the hunk). Expand from its top edge (`fromTop += step`).

**For `[` (expand up):** scan regions in reverse. Find the first region
whose line range ends at or before the cursor's current line. This is the
region directly above the current block. Expand from its bottom edge
(`fromBottom += step`).

**Expanded context is part of the current block:** when scanning for the
nearest region, expanded-context lines that are contiguous with the hunk
are treated as part of that hunk's block. So if hunk covers lines 10-20
and region below (lines 21-50) has `fromTop: 10` (lines 21-30 revealed),
the cursor on line 25 pressing `]` continues expanding the _same_ region
(lines 31-50 are still collapsed). The cursor on line 25 pressing `[`
looks for the region _above_ lines 10-30 (i.e., the region ending before
line 10).

### 5.3 Step size

Default step: **20 lines**. If fewer remain in that direction for the
region, all remaining are revealed (region becomes fully expanded from
that edge or overall).

### 5.4 Help bar

Diff mode help bar gains `[/] expand` hint. Added to `BROWSE_DIFF_HELP`.

---

## 6. Rendering Changes

### 6.1 Collapsed separator row

Full-width row (spans both panes), dimmed, centered:

```
              ··· 42 lines hidden ···
```

Background: `DIFF_HUNK_BG` (reuse existing hunk header background).

Not cursor-targetable — cursor skips over these rows during j/k navigation.
`rowToLine` maps to `undefined` for these rows (same as current hunk headers).

### 6.2 Expanded-context lines

Render as context rows (identical content both panes) with a distinct subtle
background tint — visually communicates "this is unchanged code you expanded,
not part of the diff."

New ANSI constant: `DIFF_EXPANDED_BG` — a very dim blue-gray, e.g.
`\x1b[48;2;28;32;38m`. Distinct from `CURSOR_BG`, `DIFF_ADDED_BG`, etc.

Cursor on an expanded-context line: blend with cursor bg →
`DIFF_EXPANDED_CURSOR_BG`.

### 6.3 `renderDiffViewport` changes

Currently iterates `diffData.rows` by `state.viewportOffset`. Change to
iterate **effective rows** — resolved from base rows + expansion state.

**Where resolution happens:** `session.ts` resolves effective rows once per
paint (in the `paint()` function) and passes them via `RenderContext`. The
reducer does NOT store effective rows — it only stores `expandedRegions` and
recomputed `DiffMeta`.

### 6.4 RenderContext additions

```ts
type RenderContext = {
  // ... existing fields ...
  /** Resolved effective diff rows (base + expanded context). Computed per-paint by session.ts. */
  effectiveDiffRows?: readonly AlignedRow[];
  /** Raw old-file source lines — for expanded region old-side content. */
  oldSourceLines?: readonly string[];
};
```

`session.ts` already has `sourceLines`. For `oldSourceLines`: `SessionConfig`
gains `oldSourceLines?: string[]`, populated from
`diffInput.oldContent.split('\n')` alongside `oldHighlightedLines`.

### 6.5 Annotation boxes on expanded lines

Works automatically — expanded-context lines have real `newLineNumber`s.
`annotationsOnLine` finds them, `a.endLine === newLine` triggers box
rendering. No special handling needed.

### 6.6 Gutter markers on expanded lines

Same — `lineMarker` checks `lineNumber >= a.startLine && lineNumber <= a.endLine`.
Expanded lines that fall within an annotation's range show markers. ✅

---

## 7. Annotation Auto-Expand

### 7.1 When to auto-expand

- **Tab jump (`jumpToNextAnnotation`):** before moving cursor to
  `target.endLine`, check if that line is in a collapsed region. If so,
  expand enough to reveal it.
- **`toggle_annotation`:** when expanding an annotation whose `endLine` is
  in a collapsed region, auto-expand that region.
- **Session start:** auto-expand regions for all pre-loaded annotations
  whose `endLine` falls in a collapsed region. Computed in `cli.ts` after
  building initial state, before launching the session. Ensures all
  annotations are immediately visible.

### 7.2 Auto-expand amount

Expand the **minimum** to make `endLine` visible, plus 3 lines of context
around the target line within the region. Unlike manual expand (fixed 20-line
step), auto-expand is surgical — reveals just enough.

Implementation: compute which edge of the region is closer to `endLine`,
expand from that edge.

```ts
const autoExpandForLine = (
  line: number,
  region: CollapsedRegion,
  current: RegionExpansion,
): RegionExpansion => {
  const padding = 3;
  const offsetFromTop = line - region.newStartLine;
  const offsetFromBottom = region.newEndLine - line;

  if (offsetFromTop <= offsetFromBottom) {
    // Closer to top edge — expand from top
    const needed = offsetFromTop + 1 + padding;
    return { ...current, fromTop: Math.max(current.fromTop, needed) };
  } else {
    // Closer to bottom edge — expand from bottom
    const needed = offsetFromBottom + 1 + padding;
    return { ...current, fromBottom: Math.max(current.fromBottom, needed) };
  }
};
```

### 7.3 Finding the region for a line

Helper: given a new-file line number, find which `CollapsedRegion` contains
it (binary search on `newStartLine`/`newEndLine`). Returns `undefined` if
the line is already in a hunk (not in any collapsed region).

```ts
const findRegionForLine = (
  regions: readonly CollapsedRegion[],
  line: number,
): CollapsedRegion | undefined =>
  regions.find(r => line >= r.newStartLine && line <= r.newEndLine);
```

Also needs to account for current expansion state — if the line has already
been revealed by a prior expansion, no further expansion is needed. Check:
is the line within `region.newStartLine..newStartLine + fromTop - 1` (top
expansion) or `region.newEndLine - fromBottom + 1..newEndLine` (bottom
expansion)?

### 7.4 Multi-annotation case

If multiple annotations have `endLine`s in the same collapsed region,
each auto-expand call takes the `max` of current and needed expansion.
The union naturally covers all.

### 7.5 Annotation range spanning multiple regions

If an annotation's `startLine` is in one region and `endLine` in another
(with visible hunks in between), only the `endLine` region needs
auto-expanding (that's where the box renders). Gutter markers on visible
hunk lines within the range already display correctly.

### 7.6 Auto-expand on `goto` (`:N`)

When the user navigates to a specific line via `:N` and that line is in a
collapsed region, auto-expand before placing the cursor. Uses the same
`autoExpandForLine` helper. Integrated in `handleGotoKey` — after parsing
the target line, check if it's in a collapsed region, dispatch expand if so,
then `set_cursor`.

### 7.7 Auto-expand on session start

In `cli.ts`, after computing the initial `SessionState` with `diffMeta`,
iterate all pre-loaded annotations. For each annotation whose `endLine`
falls in a collapsed region, compute the needed expansion via
`autoExpandForLine`. Collect all expansions, build the initial
`expandedRegions` map, and recompute `DiffMeta` before launching the session.

### 7.8 Programmatic auto-expand in dispatch

`jumpToNextAnnotation` in `dispatch.ts` currently does:
```
set_cursor → toggle_annotation → focus_annotation
```

With auto-expand, it needs to:
1. Check if `target.endLine` is in a collapsed region
2. If so, dispatch `expand_region` with computed expansion (via `autoExpandForLine`)
3. Then proceed with `set_cursor` → `toggle_annotation` → `focus_annotation`

The expand action updates `DiffMeta`, so subsequent `set_cursor` sees the
expanded line in `visibleLines` and doesn't snap away.

---

## 8. Edge Cases

### 8.1 No collapsed regions

Single hunk covering the entire file, or new file (all additions).
`collapsedRegions` is empty. `[`/`]`/`E` are no-ops. Everything works
as today.

### 8.2 Zero-line collapsed region

Adjacent hunks with overlapping context. Region `lineCount` = 0.
Don't emit a collapsed separator row. Don't include in
`collapsedRegions` array.

### 8.3 Very large collapsed region (e.g. 5000 lines)

Manual expand: 20 lines per keypress. User can hold `]` to expand rapidly.
Auto-expand (annotation): surgical, reveals only needed lines + padding.
Expand all: reveals everything. May produce thousands of rows.
Viewport/scroll handles this — same as a very large raw file. No special
capping needed.

### 8.4 Expand all + large file performance

`recomputeDiffMeta` is O(total lines). For a 50k-line file this is ~1ms.
Rendering is already viewport-bounded (only visible rows painted).
Effective row resolution is also O(total) but only runs on expand/collapse
and at paint time. No concern.

### 8.5 Cursor on expanded-context line → collapse all

`E` toggle collapses all regions. Cursor may be on an expanded line that
disappears. `clampCursor` snaps to nearest visible line in the recomputed
`visibleLines` (nearest hunk boundary). Viewport offset recomputed.

### 8.6 Expanded annotation in collapsing region

If annotation's `endLine` is in a region being collapsed (via `E` toggle),
the annotation box disappears. The annotation stays expanded/focused in
state — it just has no visible render target. Tab will auto-expand the
region again when cycling to it.

Acceptable — the user explicitly chose to collapse. Tab restores access.

### 8.7 Selection across expanded regions

Visual select (`v` mode) works normally across expanded-context lines.
`extend_select` uses `moveCursorDiff` which steps through `visibleLines` —
expanded lines are in `visibleLines`. ✅

`[`/`]` are no-ops during select mode to avoid invalidating the selection
range mapping.

### 8.8 Search in collapsed regions

Search operates on `sourceLines` (the full file). Matches may be in
collapsed regions.

**Behavior:** search navigation only jumps to visible lines (in current
`DiffMeta.visibleLines`). Matches on collapsed lines are counted but not
navigable. The status bar shows `3/15 matches (12 hidden)` so the user
knows matches exist in collapsed regions. They can `E` to expand all, then
search again to navigate all matches. This avoids surprise mass-expansion.

### 8.9 New file (all added) / deleted file (all removed)

- All-added: every line is in a hunk. No collapsed regions. ✅
- All-removed: no new-file lines. No collapsed regions on new side. ✅

### 8.10 Diff with no old content (`oldContent: null`)

For expanded-context rows: old side = new side content (unchanged lines are
identical). Even without `oldSourceLines`, copy from `sourceLines`. Old line
numbers still computable from region metadata.

### 8.11 Diff mode → raw mode → diff mode round-trip

`expandedRegions` persists on state across `toggle_view_mode`. When
switching back to diff, the same regions remain expanded. Cursor position
preserved via `clampCursor`.

### 8.12 Expand keys during non-browse modes

`[`/`]`/`E` are no-ops in: select, annotate, reply, edit, confirm, decide,
goto, search. Keys are captured by modal handlers.

### 8.13 Old-file line numbers at start/end of file

**Before first hunk:** old/new lines both start at 1. Offset is 0.

**After last hunk:** old-file offset derived from last chunk boundary.
Since unchanged lines have 1:1 old/new correspondence, the offset from the
last hunk carries forward.

### 8.14 Hunk context overlap

Git diff typically includes 3 context lines around changes. If two hunks
are separated by ≤6 unchanged lines, git merges them into one hunk. So the
minimum gap between separate hunks is typically 7+ lines. However, diffs
with `--unified=0` or non-standard context can have smaller gaps. The region
computation handles any gap size, including 0 (no collapsed region emitted).

### 8.15 Collapsed row is not cursor-targetable

The collapsed separator row has no `newLineNumber`. Cursor navigation
(`moveCursorDiff`) steps through `visibleLines` — collapsed rows are
skipped. The cursor jumps from the last visible line of one block to the
first visible line of the next. Same as current hunk-header behavior. ✅

### 8.16 Viewport offset with expanded regions

`computeDiffViewportOffset` uses `newLineToRow` and `rowCount` from
`DiffMeta`. After recomputing DiffMeta, these reflect expanded rows.
The offset calculation works correctly. ✅

### 8.17 Mouse click on collapsed separator row

Maps to `undefined` in `rowToLine`, ignored. Same as current hunk-header. ✅

### 8.18 Mouse click on expanded-context lines

Maps to the line's `newLineNumber` → `set_cursor`. Works like any other
line. ✅

### 8.19 Expanded context lines contiguous with hunk form a "block"

When the user has expanded lines above/below a hunk, the expanded lines
are considered part of that hunk's block for `[`/`]` resolution. Pressing
`]` while on an expanded-context line that is contiguous with a hunk continues
expanding the _same_ region (not the one on the other side of the block).

### 8.20 Region fully expanded from one side

If a region is fully expanded via `fromTop` alone (the user only pressed `]`
from the hunk above), `fromBottom` stays 0. The lines are all visible. If the
user is now on the lower hunk and presses `[`, the region is already fully
expanded — no-op.

### 8.21 `fromTop + fromBottom` overlap

If `fromTop + fromBottom > region.lineCount`, clamp to `lineCount`.
Effective resolution emits each line at most once. The overlap check:
`actualFromTop = min(fromTop, lineCount)`,
`actualFromBottom = min(fromBottom, lineCount - actualFromTop)`.

---

## 9. Implementation Order

### Phase 1: Data model + region computation
1. Add `CollapsedRegion` type to `diff-align.ts`
2. Add `lineCount` parameter to `alignDiff`
3. Compute `collapsedRegions` in `alignDiff`
4. Replace `'hunk-header'` rows with `'collapsed'` rows
5. Update `DiffData` type with `collapsedRegions` field
6. Update all callers of `alignDiff` to pass `lineCount`
7. Tests: collapsed region computation for various hunk configurations

### Phase 2: Effective row resolution
1. Add `RegionExpansion` type to `state.ts`
2. Implement `resolveEffectiveRows()` pure function
3. Implement `recomputeDiffMeta()` from base DiffData + expanded regions
4. Tests: effective rows for partial/full expansion, DiffMeta consistency

### Phase 3: State + reducer
1. Add `expandedRegions` to `SessionState`
2. Add new actions: `expand_region`, `expand_all_regions`, `collapse_all_regions`
3. Implement reducers with DiffMeta recomputation + cursor displacement
4. Tests: state transitions, cursor displacement, DiffMeta after expand

### Phase 4: Keybindings + dispatch
1. Add `[`, `]`, `E` to `BROWSE` keymap (diff-only guard)
2. Implement nearest-region resolution helper
3. Wire keys in `handleBrowseKey`
4. Update help bars
5. Tests: keypress → correct action dispatch, no-op in raw mode

### Phase 5: Rendering
1. Add `DIFF_EXPANDED_BG` / `DIFF_EXPANDED_CURSOR_BG` ANSI constants
2. Add `effectiveDiffRows` / `oldSourceLines` to `RenderContext`
3. Resolve effective rows in `session.ts` `paint()`, pass to renderer
4. Render collapsed separator rows (centered line count)
5. Render expanded-context rows with distinct background
6. Remove old hunk-header rendering code
7. Tests: frame output for collapsed, expanded, mixed states

### Phase 6: Auto-expand
1. Implement `autoExpandForLine` + `findRegionForLine` helpers
2. Integrate into `jumpToNextAnnotation` (Tab) — expand before cursor move
3. Integrate into `toggle_annotation` — expand when endLine is collapsed
4. Integrate into `handleGotoKey` — expand when target line is collapsed
5. Integrate into `cli.ts` startup — expand for all pre-loaded annotations
6. Tests: Tab to annotation in collapsed region → auto-expand → box at real endLine
7. Tests: goto collapsed line → auto-expand → cursor on target
8. Tests: startup with annotations in collapsed regions → regions pre-expanded

### Phase 7: Search integration
1. Filter search navigation to visible lines only
2. Show "(N hidden)" in search match counter when collapsed matches exist
3. Tests: search with matches in collapsed regions, count display

---

## 10. Decisions (resolved)

1. **Step size** — 20 lines per expand keypress. If fewer than 20 remain in
   the expansion direction, reveal all remaining. ✅

2. **Old-file line numbers for after-last-hunk region** — derived from hunk
   boundary offset: `oldLine = region.oldStartLine + (newLine - region.newStartLine)`.
   No old-file total line count needed — unchanged lines have 1:1
   correspondence, and the offset is fully determined by the last chunk's
   `oldStart + oldLines`. ✅

3. **Expand all** — no cap. `E` reveals everything. Viewport-bounded
   rendering handles large files fine. ✅

4. **Annotation auto-expand on startup** — yes. When pre-loaded annotations
   have `endLine` in a collapsed region, auto-expand those regions at
   session init (in `cli.ts`, after computing initial state). This ensures
   all annotations are immediately visible/navigable. ✅

5. **Old-side highlighting fallback** — expanded context uses
   `oldHighlightedLines` when available, falls back to unhighlighted
   content. Same as current diff behavior. ✅

6. **Modal no-ops** — `[`/`]`/`E` are silently ignored in annotate, reply,
   edit, confirm, decide, goto, search modes. ✅

7. **`goto` line in collapsed region** — auto-expand. `:42` where line 42
   is in a collapsed region triggers `autoExpandForLine` before cursor
   placement. Explicit navigation intent warrants expansion. ✅
