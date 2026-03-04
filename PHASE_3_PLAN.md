# Phase 3 — Diff Mode

Complete spec for implementing GitLab-style side-by-side diff view in Quill.
Written to be executable async without further questions.

---

## Table of Contents

1. [Goals & Non-Goals](#1-goals--non-goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Slice 3.1 — Diff Ingestion](#3-slice-31--diff-ingestion)
4. [Slice 3.2 — Diff Parser & Aligner](#4-slice-32--diff-parser--aligner)
5. [Slice 3.3 — Side-by-Side Renderer](#5-slice-33--side-by-side-renderer)
6. [Slice 3.4 — State, Dispatch & Navigation](#6-slice-34--state-dispatch--navigation)
7. [Slice 3.5 — Annotation Anchoring](#7-slice-35--annotation-anchoring)
8. [Slice 3.6 — Raw ↔ Diff Toggle](#8-slice-36--raw--diff-toggle)
9. [Edge Cases & Error Handling](#9-edge-cases--error-handling)
10. [Testing Strategy](#10-testing-strategy)
11. [File Map](#11-file-map)
12. [Open Questions (Resolved)](#12-open-questions-resolved)

---

## 1. Goals & Non-Goals

### Goals

- GitLab-like side-by-side diff view with syntax-highlighted old/new panes
- Empty-line padding on either side so removed/added lines align visually
- Annotations anchor to **new-file lines only** (right pane)
- Toggle between raw file view and diff view (`d` key)
- Cursor, selection, search, Tab-cycling, focus model — all work in diff mode
- JSON output includes `mode: 'diff'` and `diffRef` when applicable

### Non-Goals

- Annotations on old (left-side) code — not needed
- Collapsed/folded hunk regions — defer to v0.1
- Multi-file diff — single file only (matches Quill's core model)
- Inline (unified) diff view — side-by-side only
- Editing file contents — Quill is read-only

---

## 2. Architecture Overview

### Data flow

```
CLI flags → git diff / file / stdin → raw unified diff string
  → parse-diff → structured hunks
  → alignHunks() → AlignedRow[]
  → Shiki highlight old + new content → highlighted AlignedRow[]
  → DiffData (immutable, computed once at startup)
  → passed into RenderContext alongside existing `lines`
```

### State model

**No new mode.** `mode` stays `'browse' | 'select' | ...` — diff is a *view*,
not a mode. Add a single field:

```typescript
readonly viewMode: 'raw' | 'diff';
```

`DiffData` is **not** on `SessionState`. It's immutable input data (like `lines`
and `sourceLines`), passed through `SessionConfig` → `RenderContext`. The reducer
never touches it.

### Renderer branching

`buildFrame` checks `state.viewMode`:
- `'raw'` → existing `renderViewport` (unchanged)
- `'diff'` → new `renderDiffViewport`

All other frame components (status bar, help bar, modals) are shared.

### Module boundaries

```
src/
  diff.ts           — NEW: git diff execution, stdin/file diff reading
  diff-align.ts     — NEW: parse-diff wrapper, alignment algorithm, DiffData
  diff-align.test.ts
  diff.test.ts
  render.ts          — MODIFIED: add renderDiffViewport, branch in buildFrame
  state.ts           — MODIFIED: add viewMode, toggle_view_mode action
  dispatch.ts        — MODIFIED: add d-key handler, diff-aware cursor skipping
  keymap.ts          — MODIFIED: add toggleDiff binding
  cli.ts             — MODIFIED: new flags, diff resolution, DiffData construction
  session.ts         — MODIFIED: pass DiffData through config/context
  schema.ts          — MODIFIED: output mode 'diff', optional diffRef
  ansi.ts            — MODIFIED: add diff background color constants
```

---

## 3. Slice 3.1 — Diff Ingestion

**Goal:** Accept diff input from CLI flags and produce a raw unified diff string.

### New file: `src/diff.ts`

```typescript
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

export type DiffSource =
  | { type: 'ref'; ref: string }
  | { type: 'staged' }
  | { type: 'unstaged' }
  | { type: 'file'; path: string }
  | { type: 'stdin'; content: string };

/**
 * Resolve a DiffSource into a raw unified diff string.
 * Throws on git errors (non-zero exit).
 */
export const resolveDiff = (source: DiffSource, filePath: string): string => {
  switch (source.type) {
    case 'ref':
      return execGitDiff(['diff', source.ref, '--', filePath]);
    case 'staged':
      return execGitDiff(['diff', '--staged', '--', filePath]);
    case 'unstaged':
      return execGitDiff(['diff', '--', filePath]);
    case 'file':
      return readFileSync(source.path, 'utf-8');
    case 'stdin':
      return source.content;
  }
};

const execGitDiff = (args: string[]): string => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
  } catch (error: unknown) {
    // git diff exits 1 when there ARE differences — that's normal
    // It exits >1 on actual errors
    if (isExecError(error) && error.status === 1 && error.stdout) {
      return error.stdout as string;
    }
    const msg = isExecError(error) && error.stderr
      ? (error.stderr as string).trim()
      : 'git diff failed';
    throw new Error(msg);
  }
};

type ExecError = Error & { status: number | null; stdout: unknown; stderr: unknown };
const isExecError = (e: unknown): e is ExecError =>
  e instanceof Error && 'status' in e;
```

### CLI flag additions (`src/cli.ts`)

Add these args to the citty command definition:

```typescript
'diff-ref': {
  type: 'string',
  description: 'Diff against a git ref (runs git diff <ref> -- <file>)',
},
staged: {
  type: 'boolean',
  description: 'Diff staged changes',
},
unstaged: {
  type: 'boolean',
  description: 'Diff unstaged changes',
},
diff: {
  type: 'string',
  description: 'Read unified diff from file path, or - for stdin',
},
```

### Flag resolution logic (in `cli.ts` `run()`)

```
1. Count how many diff flags are set. If > 1, error:
   "Only one diff source allowed: --diff-ref, --staged, --unstaged, or --diff"

2. If --diff - is set AND stdin was already consumed for annotations
   (no --annotations flag), error:
   "Cannot read both annotations and diff from stdin. Use --annotations <file>"

3. Build DiffSource | null from whichever flag is set

4. If DiffSource is present:
   a. Call resolveDiff(source, filePath) → rawDiff string
   b. If rawDiff is empty, warn "No differences found" and fall through to raw mode
   c. Otherwise, pass rawDiff to alignment (Slice 3.2)
```

### Stdin routing rules

| Flags                          | stdin consumed as | annotations from |
| ------------------------------ | ----------------- | ---------------- |
| (none)                         | annotations       | stdin            |
| `--annotations file.json`      | ignored           | file.json        |
| `--diff -`                     | diff              | none (or --annotations) |
| `--diff - --annotations f.json`| diff              | f.json           |
| `--diff - ` + piped JSON (no --annotations) | **error** | — |

The key constraint: if `--diff -` is present, `readStdinIfPiped()` returns the
diff content (not annotations). If the user also wants to pipe annotations, they
must use `--annotations <file>`.

Implementation: read stdin early (as today). Then decide what it is based on flags:
- If `--diff -`: stdin content is the diff. Annotations must come from `--annotations`.
- Otherwise: stdin content is annotations (existing behavior).

### Tests (`src/diff.test.ts`)

- `resolveDiff` with `type: 'file'` — reads a fixture `.patch` file
- `resolveDiff` with `type: 'stdin'` — returns content as-is
- `resolveDiff` with `type: 'ref'` — mock `execFileSync` (or skip in CI)
- `execGitDiff` handles exit code 1 (has diff) vs exit code > 1 (actual error)
- CLI flag validation: multiple diff flags → error
- CLI flag validation: `--diff -` without `--annotations` when stdin has data → error

### Acceptance criteria

- [ ] `quill src/foo.ts --diff-ref main` shells out to git and captures diff
- [ ] `quill src/foo.ts --diff ./my.patch` reads diff from file
- [ ] `quill src/foo.ts --diff - --annotations anns.json < my.patch` reads diff from stdin
- [ ] Conflicting flags produce clear error messages
- [ ] Empty diff (no changes) falls through to raw mode gracefully
- [ ] All existing tests still pass (no regressions)

---

## 4. Slice 3.2 — Diff Parser & Aligner

**Goal:** Transform a raw unified diff string into an aligned, renderable data
structure with line number mappings.

### Install dependency

```bash
npm install parse-diff@0.11.1
```

`parse-diff` exports a function that takes a unified diff string and returns an
array of file objects, each containing hunks with changes. We only care about the
single file matching our `filePath`.

### New file: `src/diff-align.ts`

#### Types

```typescript
/**
 * Type of content on a single display row in the aligned diff.
 *
 * - context: unchanged line, present on both sides
 * - added: new line (right side only, left side is padding)
 * - removed: old line (left side only, right side is padding)
 * - hunk-header: @@ line separator between hunks
 */
export type DiffLineType = 'context' | 'added' | 'removed' | 'hunk-header';

/**
 * A single row in the aligned side-by-side diff.
 * Either side can be null (padding).
 */
export type AlignedRow = {
  readonly type: DiffLineType;
  /** 1-indexed old-file line number, or null for added lines / hunk headers. */
  readonly oldLineNumber: number | null;
  /** 1-indexed new-file line number, or null for removed lines / hunk headers. */
  readonly newLineNumber: number | null;
  /** Raw old-file line content (no highlighting), or null. */
  readonly oldContent: string | null;
  /** Raw new-file line content (no highlighting), or null. */
  readonly newContent: string | null;
};

/**
 * Complete aligned diff data, computed once at startup.
 * Immutable — never mutated after construction.
 */
export type DiffData = {
  /** Display rows in order. */
  readonly rows: readonly AlignedRow[];
  /**
   * Total number of lines in the new file.
   * Used for lineCount when in diff mode (cursor clamping).
   */
  readonly newFileLineCount: number;
  /**
   * Maps new-file line number (1-indexed) → display row index.
   * Used for cursor positioning: given a new-file line, find its row.
   * Only includes lines that appear in the diff (context + added).
   */
  readonly newLineToRowIndex: ReadonlyMap<number, number>;
  /**
   * Maps display row index → new-file line number, or null for
   * removed-only rows and hunk headers.
   * Used for: click → cursor, selection range computation.
   */
  readonly rowToNewLine: readonly (number | null)[];
  /**
   * Label describing the diff source, shown in the status bar.
   * Examples: "main", "staged", "unstaged", "custom.patch"
   */
  readonly label: string;
  /**
   * Raw old-file content lines (for search in old pane if ever needed).
   * For now, search only targets new-file content.
   */
  readonly oldSourceLines: readonly string[];
  /**
   * Raw new-file content lines (same as sourceLines passed to session).
   */
  readonly newSourceLines: readonly string[];
};
```

#### Alignment algorithm

```typescript
import parseDiff from 'parse-diff';

/**
 * Parse a unified diff and align into side-by-side rows.
 *
 * Algorithm:
 * 1. Parse with parse-diff → get hunks with changes
 * 2. Walk hunks. Between hunks, emit context lines paired 1:1.
 * 3. Within a hunk, walk changes sequentially:
 *    - 'normal' (context): paired left+right
 *    - 'del': accumulate into pending removals
 *    - 'add': if pending removals exist, pair with them (modified line);
 *      otherwise, emit as added (right only, left padding)
 *    - After processing all changes in a hunk, flush remaining pending
 *      removals as removed-only rows (left only, right padding)
 * 4. Between hunks, emit a hunk-header separator row
 *
 * This matches the standard side-by-side algorithm used by
 * `diff --side-by-side`, delta, and GitLab's diff view.
 */
export const alignDiff = (
  rawDiff: string,
  filePath: string,
  oldSourceLines: readonly string[],
  newSourceLines: readonly string[],
): DiffData => { ... };
```

**Pairing within a hunk (detail):**

```
Changes in order: [del, del, del, add, add, normal, del, add, add]

Processing:
1. del  → pending = [del1]
2. del  → pending = [del1, del2]
3. del  → pending = [del1, del2, del3]
4. add  → pair with del1 → emit row(removed+added). pending = [del2, del3]
5. add  → pair with del2 → emit row(removed+added). pending = [del3]
6. normal → flush pending del3 as removed-only. Then emit context row.
7. del  → pending = [del4]
8. add  → pair with del4 → emit row(removed+added). pending = []
9. add  → no pending → emit added-only row
```

The result is that consecutive del/add blocks get paired positionally (first del
with first add), overflow on either side gets padding. This produces the familiar
GitLab-style layout.

#### Reconstructing old file content

The `parse-diff` output gives us the change content within hunks, but we also
need the surrounding context (lines outside any hunk). Two approaches:

**Approach A (preferred):** Read both old and new file content directly.
- New file content: we already have it (`sourceLines` from `readFileSync`).
- Old file content: for `--diff-ref`, run
  `git show <ref>:<filePath>` → old content string → split into lines.
  For `--staged`, run `git show :<filePath>` (index version).
  For `--unstaged`, the old version is the index: `git show :<filePath>`.
  For `--diff <file>`, we can reconstruct from the new file + diff (reverse-apply).

**Approach B (simpler, sufficient for v0):** Only render lines that appear in
hunks (context + changed). Between hunks, show a `@@ ... @@` separator row
instead of rendering every unchanged line. This avoids the old-file
reconstruction problem entirely and matches how GitLab shows diffs (collapsed
unchanged regions between hunks).

**Decision: Approach B** — show only hunked lines with separators. This is
simpler, matches GitLab's default view, and avoids the old-file reconstruction
complexity. If the user wants to see the full file, they toggle to raw mode (`d`).

This means:
- `DiffData.rows` only contains lines from hunks + hunk-header separators
- The cursor in diff mode moves through these rows (not the full file)
- `lineCount` in diff mode = number of display rows (not the new file's total lines)
- Annotations still reference new-file line numbers (from `AlignedRow.newLineNumber`)

Wait — this changes the cursor model. Let me reconsider.

**Revised decision: Approach B with cursor on new-file lines.**

The display is hunk-based (like GitLab), but annotations and cursor positions
still reference **new-file line numbers**. The display row → new-file line
mapping handles the translation. When creating an annotation in diff mode, the
startLine/endLine are new-file line numbers — same as raw mode. This means
annotations are portable between raw and diff views.

#### Source line content

Within hunks, `parse-diff` gives us the line content (from the diff itself).
This is sufficient — we don't need to read old file content separately.

For syntax highlighting, we need the lines as continuous code so Shiki can
tokenize properly. But `parse-diff` gives us individual lines stripped of their
`+`/`-`/` ` prefix. We can:

1. Collect all old-side lines (in order) and all new-side lines (in order) from
   the hunks
2. Join each into a string, pass to Shiki for highlighting
3. Map highlighted lines back to their respective AlignedRows

Actually, this is tricky because Shiki needs full file context for proper
tokenization (multi-line strings, template literals, etc.). Isolated hunk lines
will produce degraded highlighting.

**Better approach:** We already have the full new-file highlighted lines (`lines`
from Shiki). For the old file, we reconstruct it from the diff and highlight it.

Let me settle this properly:

**For the new file (right side):**
- We already have `lines` (Shiki-highlighted) and `sourceLines` (raw).
- `AlignedRow.newLineNumber` maps directly into these arrays.
- No extra work needed.

**For the old file (left side):**
- Reconstruct old file content from new file + reverse-applied diff.
  OR: run `git show <ref>:<file>` to get old content directly.
- Highlight with Shiki → `oldLines` array.
- `AlignedRow.oldLineNumber` maps into `oldLines`.

**Simplest correct approach:**
- Extend `DiffSource` resolution to also return old file content.
- For `ref`/`staged`/`unstaged`: `git show <ref>:<file>` gives old content.
- For external diff (`--diff <file>`): reverse-apply heuristically from hunks,
  or just don't highlight old side (show raw). Start with the `git show` path
  since that's the primary use case.

### Revised module design

```typescript
export type DiffInput = {
  /** Raw unified diff string. */
  readonly rawDiff: string;
  /** Old file content (if available). Null = no highlighting for old side. */
  readonly oldContent: string | null;
  /** Label for status bar. */
  readonly label: string;
};
```

Update `resolveDiff` in `src/diff.ts` to return `DiffInput`:

```typescript
export const resolveDiff = (source: DiffSource, filePath: string): DiffInput => {
  switch (source.type) {
    case 'ref': {
      const rawDiff = execGitDiff(['diff', source.ref, '--', filePath]);
      const oldContent = execGitShow(`${source.ref}:${filePath}`);
      return { rawDiff, oldContent, label: source.ref };
    }
    case 'staged': {
      const rawDiff = execGitDiff(['diff', '--staged', '--', filePath]);
      // Index version is the "new" in staged context; HEAD is "old"
      const oldContent = execGitShow(`HEAD:${filePath}`);
      return { rawDiff, oldContent, label: 'staged' };
    }
    case 'unstaged': {
      const rawDiff = execGitDiff(['diff', '--', filePath]);
      // Index version is "old" for unstaged
      const oldContent = execGitShow(`:${filePath}`);
      return { rawDiff, oldContent, label: 'unstaged' };
    }
    case 'file':
      return {
        rawDiff: readFileSync(source.path, 'utf-8'),
        oldContent: null, // no git context
        label: basename(source.path),
      };
    case 'stdin':
      return {
        rawDiff: source.content,
        oldContent: null,
        label: 'stdin',
      };
  }
};
```

`execGitShow` is a new helper:
```typescript
const execGitShow = (revPath: string): string | null => {
  try {
    return execFileSync('git', ['show', revPath], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null; // file doesn't exist at that ref
  }
};
```

### `alignDiff` function signature (revised)

```typescript
export const alignDiff = (rawDiff: string, label: string): {
  rows: AlignedRow[];
  rowToNewLine: (number | null)[];
  newLineToRowIndex: Map<number, number>;
} => { ... };
```

This function only does structural alignment from the parsed diff. It does NOT
handle highlighting — that's the caller's job (Slice 3.3).

### Detailed alignment steps

1. Call `parseDiff(rawDiff)` → array of file objects. Take the first file
   (single-file diff). If empty, return empty DiffData.

2. Walk hunks. For each hunk:
   a. Emit a `hunk-header` row (both sides null, type = 'hunk-header')
   b. Walk changes using the pairing algorithm described above

3. Build `rowToNewLine` and `newLineToRowIndex` as a post-pass over rows.

### Tests (`src/diff-align.test.ts`)

Core test cases:
- **Simple addition**: 3 context + 2 added → 5 rows, added rows have null oldLineNumber
- **Simple removal**: 3 context + 2 removed → 5 rows, removed rows have null newLineNumber
- **Modification**: 2 removed + 2 added → 2 paired rows (each has both sides)
- **Asymmetric modification**: 3 removed + 1 added → 1 paired + 2 removed-only
- **Multiple hunks**: hunk-header rows between them
- **Empty diff**: returns empty rows
- **Context-only hunk**: all context rows
- **Line number mapping**: verify rowToNewLine and newLineToRowIndex consistency
- **No trailing newline**: handle `\ No newline at end of file`

Fixtures: create `test/fixtures/` with `.patch` files for each case. Or inline
diff strings in tests (simpler, more readable).

### Acceptance criteria

- [ ] `alignDiff` produces correct AlignedRow arrays for all test cases
- [ ] Line number mappings are consistent (round-trip: newLine → row → newLine)
- [ ] Hunk headers appear between hunks
- [ ] Pairing algorithm handles asymmetric del/add counts
- [ ] `parse-diff` installed and working

---

## 5. Slice 3.3 — Side-by-Side Renderer

**Goal:** Render aligned diff rows as a split-pane terminal frame.

### Layout

Terminal width is split into two panes separated by a thin column:

```
│[>][ oldNum ][ marker ]│ oldCode   ║ [>][ newNum ][ marker ]│ newCode   │
```

Concrete widths (for `cols` terminal columns):
- Center separator: 1 char (`║` or `│`)
- Each pane: `Math.floor((cols - 1) / 2)` characters
- Within each pane:
  - Pointer: 1 char (` ` or `>`, only on new/right side)
  - Line number: `gutterWidth` chars (padded, max of old/new line count)
  - Space: 1 char
  - Marker: 2 chars (annotation marker, same as raw mode)
  - Code: remaining chars

**Pointer placement:** The `>` cursor indicator only appears on the **right
(new) side**. The left side gets a space. This reinforces that the cursor lives
on new-file lines.

### Color scheme — new ANSI constants (`src/ansi.ts`)

```typescript
/** Diff: removed line background (subtle red tint). */
export const DIFF_REMOVED_BG = `${ESC}48;2;50;30;30m`;
/** Diff: added line background (subtle green tint). */
export const DIFF_ADDED_BG = `${ESC}48;2;30;50;30m`;
/** Diff: hunk header background. */
export const DIFF_HUNK_BG = `${ESC}48;2;35;40;50m`;
/** Diff: padding (empty) cell background — matches terminal background. */
export const DIFF_PAD_BG = `${ESC}48;2;25;27;32m`;
/** Diff: center separator. */
export const DIFF_SEPARATOR = `${ESC}38;2;60;65;75m`;
```

Exact RGB values will need visual tuning against one-dark-pro. Start with these
and adjust during smoke testing.

### New function: `renderDiffViewport`

Lives in `src/render.ts` alongside `renderViewport`. Same return type
(`ViewportResult`).

```typescript
const renderDiffViewport = (
  state: SessionState,
  diffData: DiffData,
  oldHighlightedLines: string[] | null, // null = no old-file highlighting
  newHighlightedLines: string[],         // existing `lines` array
  viewportHeight: number,
  cols: number,
  selection?: Selection,
  search?: SearchState,
): ViewportResult => { ... };
```

**Per-row rendering:**

For each `AlignedRow` in the visible window (based on viewport offset):

1. **hunk-header**: Full-width dim row: `@@ -old,count +new,count @@`
   Background: `DIFF_HUNK_BG`. No line numbers. `rowToLine` → `undefined`.

2. **context**: Both sides rendered. Old line number on left, new on right.
   No special background. Cursor indicator on right side if this is the cursor
   line. `rowToLine` → `newLineNumber`.

3. **added**: Left side is padding (dim `~` or empty, `DIFF_PAD_BG`). Right side
   has code with `DIFF_ADDED_BG`. `rowToLine` → `newLineNumber`.

4. **removed**: Right side is padding. Left side has code with `DIFF_REMOVED_BG`.
   `rowToLine` → `undefined` (can't place cursor on removed-only rows).

**Annotation boxes:** After rendering a row whose `newLineNumber` matches an
annotation's `endLine` and the annotation is expanded, emit annotation box rows
spanning full terminal width (same as raw mode). This reuses `renderAnnotationBox`
unchanged.

**Search highlighting:** Only applies to new-file (right side) content. Use
existing `highlightSearchMatches` on the new-side code string.

**Horizontal scroll:** Each pane scrolls independently? No — keep it simple.
In diff mode, horizontal scroll is disabled (long lines truncate with `…`).
The pane width is already constrained; horizontal scroll would require tracking
two offsets. Defer to later if users request it. `h`/`l` keys are no-ops in
diff view, and the status bar omits the horizontal scroll hint.

### buildFrame changes

```typescript
export type RenderContext = {
  filePath: string;
  lines: string[];                    // existing: new-file highlighted lines
  state: SessionState;
  terminalRows: number;
  terminalCols: number;
  // New optional fields for diff mode:
  diffData?: DiffData;                // undefined in raw mode
  oldHighlightedLines?: string[];     // undefined in raw mode or when old content unavailable
};
```

In `buildFrame`:

```typescript
const viewport = state.viewMode === 'diff' && ctx.diffData
  ? renderDiffViewport(
      ctx.state,
      ctx.diffData,
      ctx.oldHighlightedLines ?? null,
      ctx.lines,
      viewportHeight,
      ctx.terminalCols,
      ctx.state.selection,
      ctx.state.search,
    )
  : renderViewport(
      ctx.lines,
      ctx.state,
      viewportHeight,
      ctx.terminalCols,
      ctx.state.selection,
      ctx.state.search,
    );
```

### Status bar changes

When `viewMode === 'diff'`:
- Show `diff <label>` instead of `raw` in the info section
- Line numbers reference new-file line numbers (already the case)

### Title bar

When diff mode is active:
```
Quill — src/auth.ts (diff: main)
```

### Help bar

Diff mode browse help adds `[d] raw view` (or `[d] diff view` when in raw mode).
Omit `[h/l ←→] scroll` in diff mode.

### Tests (`src/render.test.ts` additions)

- `renderDiffViewport` produces correct row count
- Added lines get `DIFF_ADDED_BG`, removed lines get `DIFF_REMOVED_BG`
- Padding cells appear on the correct side
- Cursor indicator only on new (right) side
- Hunk headers render as separator rows
- Annotation boxes appear after the endLine row
- `rowToLine` correctly maps to new-file line numbers (undefined for removed/headers)
- Truncation works at half-width

### Acceptance criteria

- [ ] Side-by-side layout renders correctly at various terminal widths (80, 120, 200)
- [ ] Colors distinguish added/removed/context/padding
- [ ] Annotation boxes render below new-file lines
- [ ] Status bar shows diff label
- [ ] No horizontal scroll in diff mode
- [ ] All existing raw-mode render tests still pass

---

## 6. Slice 3.4 — State, Dispatch & Navigation

**Goal:** Make cursor movement, selection, and keyboard shortcuts work correctly
in diff mode.

### State changes (`src/state.ts`)

Add to `SessionState`:

```typescript
readonly viewMode: 'raw' | 'diff';
```

Default: `'raw'` (even when diff data is available — user toggles with `d`).
Actually, if diff flags are provided, default to `'diff'` and let the user
toggle to `'raw'`.

Add new action:

```typescript
| { type: 'toggle_view_mode' }
```

Reducer:

```typescript
case 'toggle_view_mode': {
  const next = state.viewMode === 'raw' ? 'diff' : 'raw';
  // When switching to diff mode, cursor may need re-clamping
  // because diff mode has fewer "lines" (only hunked lines).
  // But since cursor references new-file line numbers in both modes,
  // and new-file lines are a subset in diff mode, we need to snap
  // to the nearest valid new-file line that appears in the diff.
  // This is handled by the session layer which has access to DiffData.
  return { ...state, viewMode: next };
}
```

**Cursor model in diff mode:**

The cursor still tracks **new-file line numbers** (1-indexed), same as raw mode.
`state.cursorLine` always means "new-file line N". This is critical for
annotation portability between views.

However, in diff mode, not all new-file lines are visible (only those in hunks).
The cursor can only land on visible new-file lines. This means:

- `move_cursor` with delta ±1: in diff mode, skip to the next/previous visible
  new-file line (using `DiffData.rowToNewLine` to find adjacent valid lines).
- `set_cursor`: clamp to the nearest visible new-file line in diff mode.

**This requires the reducer to know about DiffData** for cursor clamping in diff
mode. Options:

A. Pass DiffData into the reducer (break pure signature).
B. Post-process cursor in the session layer after `reduce()`.
C. Store the set of valid new-file lines on state.

**Decision: Option C.** Add a derived field to SessionState:

```typescript
/**
 * Set of new-file line numbers visible in diff mode.
 * Only populated when diff data exists. Used for cursor clamping.
 * In raw mode, cursor clamps to 1..lineCount as usual.
 */
readonly diffVisibleLines?: readonly number[];
```

This is set once at startup (from `DiffData.rowToNewLine`, filtered to non-null,
deduplicated and sorted). It never changes.

Cursor movement in the reducer then becomes:

```typescript
case 'move_cursor': {
  if (state.viewMode === 'diff' && state.diffVisibleLines) {
    // Find the current index in the visible lines array
    const visLines = state.diffVisibleLines;
    const currentIdx = visLines.indexOf(state.cursorLine);
    const nextIdx = R.clamp(
      (currentIdx === -1 ? 0 : currentIdx) + action.delta,
      { min: 0, max: visLines.length - 1 }
    );
    const cursorLine = visLines[nextIdx]!;
    // ... compute viewport offset, focus
    return { ...state, cursorLine, viewportOffset, focusedAnnotationId };
  }
  // existing raw-mode logic
}
```

Wait, this gets complicated fast — every cursor-touching action would need this
branch. Let me think of a cleaner approach.

**Better: `clampLine` becomes view-mode-aware.**

```typescript
export const clampLine = (
  value: number,
  lineCount: number,
  visibleLines?: readonly number[],
): number => {
  if (visibleLines && visibleLines.length > 0) {
    // Snap to nearest visible line
    const clamped = R.clamp(value, { min: 1, max: Math.max(1, lineCount) });
    // Binary search for nearest
    let lo = 0, hi = visibleLines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (visibleLines[mid]! < clamped) lo = mid + 1;
      else hi = mid;
    }
    // lo is the index of the first visible line >= clamped
    // Check if lo-1 is closer
    if (lo > 0) {
      const distLo = Math.abs(visibleLines[lo]! - clamped);
      const distPrev = Math.abs(visibleLines[lo - 1]! - clamped);
      if (distPrev < distLo) return visibleLines[lo - 1]!;
    }
    return visibleLines[lo]!;
  }
  return R.clamp(value, { min: 1, max: Math.max(1, lineCount) });
};
```

Then every call to `clampLine` in the reducer passes
`state.viewMode === 'diff' ? state.diffVisibleLines : undefined`.

This is still repetitive. Cleanest approach: make a helper that the reducer uses
internally:

```typescript
const clampCursor = (state: SessionState, value: number): number =>
  clampLine(
    value,
    state.lineCount,
    state.viewMode === 'diff' ? state.diffVisibleLines : undefined,
  );
```

Then replace all `clampLine(x, state.lineCount)` calls with
`clampCursor(state, x)`. The raw-mode path is unchanged (visibleLines is
undefined, falls through to existing logic).

**move_cursor with delta in diff mode:** Delta ±1 should move to the
next/previous visible line, not ±1 in absolute line numbers. So:

```typescript
// In move_cursor handler, when diff mode:
if (state.viewMode === 'diff' && state.diffVisibleLines) {
  const visLines = state.diffVisibleLines;
  const currentIdx = visLines.indexOf(state.cursorLine);
  const base = currentIdx >= 0 ? currentIdx : findNearestIndex(visLines, state.cursorLine);
  const nextIdx = R.clamp(base + action.delta, { min: 0, max: visLines.length - 1 });
  cursorLine = visLines[nextIdx]!;
} else {
  cursorLine = clampLine(state.cursorLine + action.delta, state.lineCount);
}
```

This means delta ±1 steps through visible lines, and half-page deltas jump
multiple visible lines. The experience is: cursor skips non-visible lines,
moving smoothly through the diff.

### Viewport offset in diff mode

In diff mode, the viewport scrolls through `DiffData.rows`, not through
`lines`. The viewport offset should be in terms of **display row indices**
(into `DiffData.rows`), not new-file line numbers.

This is a problem: `state.viewportOffset` currently means "index into the lines
array" (0-based). In diff mode it would mean "index into DiffData.rows".

Two approaches:
A. Reinterpret `viewportOffset` based on `viewMode`.
B. Add a separate `diffViewportOffset`.

**Decision: Option A.** `viewportOffset` is reinterpreted based on view mode.
The `renderDiffViewport` function receives it and uses it as an index into
`DiffData.rows`. The `computeViewportOffset` function needs to work with the
diff's row count instead of `state.lineCount`.

For this to work, we need to know the total display row count in diff mode.
Add to state (or derive from `diffVisibleLines`):

Actually, the total display row count is `DiffData.rows.length`. But we said
DiffData isn't on state. We could put `diffRowCount` on state:

```typescript
/** Total display rows in diff mode (DiffData.rows.length). Undefined in raw-only sessions. */
readonly diffRowCount?: number;
```

And use it in `computeViewportOffset`:

```typescript
const effectiveLineCount = state.viewMode === 'diff' && state.diffRowCount
  ? state.diffRowCount
  : state.lineCount;
```

The mapping between cursor line (new-file line number) and display row is needed
for scroll offset computation. We need `newLineToRowIndex` for this — but that's
on DiffData, not state.

**Revised decision:** Put the minimal derived data on state:

```typescript
/** Diff mode display metadata. Undefined when no diff data exists. */
readonly diffMeta?: {
  /** Total display rows. */
  readonly rowCount: number;
  /** Sorted new-file line numbers that are visible in the diff. */
  readonly visibleLines: readonly number[];
  /** Maps new-file line number → display row index. */
  readonly newLineToRow: ReadonlyMap<number, number>;
};
```

Set once at startup, never mutated. This gives the reducer everything it needs
for cursor clamping and viewport offset computation in diff mode, without
needing access to the full DiffData.

**Viewport offset computation in diff mode:**

```typescript
// In move_cursor, after computing cursorLine:
if (state.viewMode === 'diff' && state.diffMeta) {
  const displayRow = state.diffMeta.newLineToRow.get(cursorLine) ?? 0;
  viewportOffset = computeViewportOffset({
    cursorLine: displayRow + 1, // 1-indexed for the algorithm
    currentOffset: state.viewportOffset,
    viewportHeight: state.viewportHeight,
    lineCount: state.diffMeta.rowCount,
  });
} else {
  // existing logic
}
```

This reuses `computeViewportOffset` unchanged — we just pass display-row-based
values instead of line-based values.

### Dispatch changes (`src/dispatch.ts`)

- `handleBrowseKey`: Add `BROWSE.toggleDiff` handler (see keymap below).
  Only fires when `state.diffMeta` exists (diff data was provided).
- Horizontal scroll keys (`h`/`l`/`←`/`→`): no-op in diff mode (or keep as-is
  since the renderer ignores `horizontalOffset` in diff mode).

### Keymap changes (`src/keymap.ts`)

Add to `BROWSE`:

```typescript
toggleDiff: {
  match: (k: Key): boolean => k.char === 'd',
  hint: 'd',
  description: 'toggle diff',
},
```

Help bar: include `[d] diff` / `[d] raw` contextually based on current viewMode.

**Conflict check:** `d` is not currently bound in browse mode. ✅ Safe.

### Selection in diff mode

Selection works on new-file line numbers, same as raw mode. When extending
selection, skip non-visible lines (same as cursor movement). The selection range
`startLine..endLine` always refers to new-file lines.

The `extend_select` handler needs the same diff-aware cursor stepping as
`move_cursor`.

### Tests

- Cursor movement in diff mode steps through visible lines only
- `clampCursor` snaps to nearest visible line
- Half-page jump skips correct number of visible lines
- `toggle_view_mode` flips viewMode
- Viewport offset computation uses display row count in diff mode
- Selection extends through visible lines only
- `d` key dispatches toggle (only when diffMeta present)

### Acceptance criteria

- [ ] Cursor movement in diff mode skips non-visible (non-hunked) lines
- [ ] Half-page / full-page jumps work proportionally
- [ ] gg / G jump to first/last visible line in diff mode
- [ ] Viewport scrolls correctly through diff rows
- [ ] Selection range captures only new-file lines
- [ ] `d` toggles between raw and diff views
- [ ] Cursor position translates correctly between views on toggle
- [ ] All raw-mode cursor/dispatch tests still pass

---

## 7. Slice 3.5 — Annotation Anchoring

**Goal:** Annotations work seamlessly in diff mode — create, display, focus, Tab-cycle.

### What changes

**Nothing in the annotation data model.** Annotations use `startLine`/`endLine`
referencing new-file line numbers. This is identical in both views.

### What needs wiring

1. **Annotation creation in diff mode**: When user selects lines and creates an
   annotation, the selection range is already in new-file line numbers. ✅ Works.

2. **Annotation display**: `renderDiffViewport` checks for expanded annotations
   on each row's `newLineNumber` and renders boxes below. Same as raw mode but
   using the diff row's `newLineNumber` instead of `lineIndex + 1`.

3. **Annotation markers in gutter**: The right-side (new) gutter shows ▸/▾
   markers. Left-side gutter never shows annotation markers (annotations don't
   reference old lines).

4. **Tab cycling**: `sortedAnnotations` and `jumpToNextAnnotation` use
   `annotation.endLine` (new-file line number). In diff mode, `set_cursor` to
   that line clamps to the nearest visible line. If the annotation's endLine is
   visible in the diff, it works directly. If not (annotation on an unchanged
   line not in any hunk), the cursor snaps to the nearest visible line — the
   annotation box won't be visible in diff mode, but the user can toggle to raw
   mode to see it. This is acceptable behavior.

5. **Focus model**: `computeFocus` checks cursor line against annotation ranges.
   Works unchanged.

6. **Output**: Annotations in JSON output always use new-file line numbers.
   Add `mode: 'diff'` and `diffRef` to output when in diff mode.

### Schema changes (`src/schema.ts`)

Update `outputEnvelopeSchema`:

```typescript
const outputEnvelopeSchema = z.object({
  file: z.string(),
  mode: z.enum(['raw', 'diff']),
  decision: z.enum(['approve', 'deny']),
  diffRef: z.string().optional(),
  annotations: z.array(annotationSchema),
});
```

Update `createOutput`:

```typescript
export const createOutput = (params: {
  filePath: string;
  mode: 'raw' | 'diff';
  decision: Decision;
  annotations: readonly Annotation[];
  diffRef?: string;
}): OutputEnvelope => ({
  file: params.filePath,
  mode: params.mode,
  decision: params.decision,
  ...(params.diffRef ? { diffRef: params.diffRef } : {}),
  annotations: [...params.annotations],
});
```

### Tests

- Annotation created in diff mode has correct new-file line numbers
- Tab cycling navigates to annotations visible in diff
- Annotation box renders in diff viewport at correct position
- Output JSON includes `mode: 'diff'` and `diffRef`

### Acceptance criteria

- [ ] Can create annotations in diff mode on new-file lines
- [ ] Annotation boxes display correctly in diff viewport
- [ ] Tab cycling works in diff mode
- [ ] Focus model (r/w/x) works in diff mode
- [ ] Output JSON has correct mode and diffRef fields

---

## 8. Slice 3.6 — Raw ↔ Diff Toggle

**Goal:** Seamless switching between raw file view and diff view.

### Behavior

- `d` in browse mode toggles `viewMode`
- Cursor position translates between views:
  - Raw → Diff: current `cursorLine` (new-file line) snaps to nearest visible
    diff line via `clampCursor`
  - Diff → Raw: current `cursorLine` is already a valid new-file line number,
    no translation needed
- Viewport offset recomputes for the target view's row space
- Search highlights persist across toggle (search operates on new-file content
  in both views)
- Expanded annotations persist (they key on annotation ID, not view mode)
- Focus persists

### Reducer for `toggle_view_mode`

```typescript
case 'toggle_view_mode': {
  const nextMode = state.viewMode === 'raw' ? 'diff' : 'raw';
  const cursorLine = nextMode === 'diff' && state.diffMeta
    ? clampCursor({ ...state, viewMode: nextMode }, state.cursorLine)
    : state.cursorLine;
  const effectiveLineCount = nextMode === 'diff' && state.diffMeta
    ? state.diffMeta.rowCount
    : state.lineCount;
  const displayCursor = nextMode === 'diff' && state.diffMeta
    ? (state.diffMeta.newLineToRow.get(cursorLine) ?? 0) + 1
    : cursorLine;
  const viewportOffset = computeViewportOffset({
    cursorLine: displayCursor,
    currentOffset: 0, // reset viewport on toggle
    viewportHeight: state.viewportHeight,
    lineCount: effectiveLineCount,
  });
  const focusedAnnotationId = computeFocus(
    cursorLine, state.annotations, state.expandedAnnotations
  );
  return {
    ...state,
    viewMode: nextMode,
    cursorLine,
    viewportOffset,
    focusedAnnotationId,
  };
}
```

### Edge case: no diff data

If the session was started without diff flags, `d` is a no-op (no `diffMeta`
on state). The keymap handler checks for this:

```typescript
if (BROWSE.toggleDiff.match(key)) {
  if (state.diffMeta) {
    return { state: reduce(state, { type: 'toggle_view_mode' }) };
  }
  return { state }; // no-op
}
```

### Tests

- Toggle from raw to diff snaps cursor to nearest visible line
- Toggle from diff to raw preserves cursor line
- Viewport offset resets appropriately on toggle
- Toggle without diff data is no-op
- Expanded annotations survive toggle
- Search highlights survive toggle

### Acceptance criteria

- [ ] `d` toggles view mode when diff data exists
- [ ] `d` is no-op when no diff data
- [ ] Cursor translates correctly in both directions
- [ ] No visual glitches on toggle (viewport recomputes cleanly)

---

## 9. Edge Cases & Error Handling

### Empty diff (no changes)

`git diff` returns empty string. Behavior: print info message
"No differences found — opening in raw mode" to stderr (before alt screen),
then proceed with raw mode only. `diffMeta` is not set, `d` key is no-op.

### Binary files

`git diff` may output `Binary files ... differ`. `parse-diff` handles this
(returns a file entry with `hunks: []`). Treat as empty diff.

### File doesn't exist at ref

`git show <ref>:<file>` fails. `oldContent` is null. Old side renders without
syntax highlighting (raw text from diff hunks, or dim placeholder).

### Extremely large diffs

`parse-diff` handles large diffs fine (it's a simple parser). The renderer
only displays `viewportHeight` rows at a time, so performance scales with
terminal size, not diff size. No special handling needed.

### New file (entire file is added)

All lines are `added` type. Left side is entirely padding. Works naturally
with the alignment algorithm.

### Deleted file (entire file is removed)

All lines are `removed` type. Right side is entirely padding. Cursor has no
valid new-file lines to land on. In this case, `diffVisibleLines` is empty.
Cursor stays at line 1 (raw mode fallback). Annotations cannot be created
in diff mode on a deleted file — this is correct behavior.

### Diff with only context (rename, permission change)

Hunks may have only context lines. All rows are `context` type. Works fine.

### `\r\n` line endings

`parse-diff` strips trailing `\r`. Our existing `sourceLines` split on `\n`.
Should be consistent. Test with a CRLF fixture to be safe.

---

## 10. Testing Strategy

### Unit tests (pure functions)

| Module | Tests |
| --- | --- |
| `diff.ts` | `resolveDiff` with mocked git, file/stdin sources, error cases |
| `diff-align.ts` | Alignment algorithm: all row types, asymmetric hunks, edge cases, line mappings |
| `state.ts` | `toggle_view_mode`, `clampCursor` with `diffMeta`, cursor movement in diff mode |
| `dispatch.ts` | `d` key handler, diff-aware cursor stepping, selection in diff mode |
| `render.ts` | `renderDiffViewport` output: colors, layout, annotation boxes, hunk headers |
| `schema.ts` | Output with `mode: 'diff'`, `diffRef` |

### Integration tests

- Full `buildFrame` with diff data → verify frame structure
- End-to-end: create annotation in diff mode, toggle to raw, verify annotation persists

### Manual smoke tests

- `quill src/state.ts --diff-ref main` on actual repo
- Toggle `d` back and forth
- Create annotation on added line
- Tab through annotations
- Search in diff mode
- Various terminal widths (80, 120, 200+)

---

## 11. File Map

### New files

| File | Purpose |
| --- | --- |
| `src/diff.ts` | Git diff execution, DiffSource resolution, DiffInput production |
| `src/diff.test.ts` | Tests for diff ingestion |
| `src/diff-align.ts` | parse-diff wrapper, alignment algorithm, DiffData/AlignedRow types |
| `src/diff-align.test.ts` | Alignment algorithm tests |

### Modified files

| File | Changes |
| --- | --- |
| `src/state.ts` | `viewMode`, `diffMeta` on SessionState; `toggle_view_mode` action; `clampCursor` helper; diff-aware cursor movement |
| `src/state.test.ts` | Tests for new state behavior |
| `src/dispatch.ts` | `d` key handler; diff-aware `jumpToNextAnnotation` |
| `src/dispatch.test.ts` | Tests for new dispatch behavior |
| `src/render.ts` | `renderDiffViewport`; `buildFrame` branching; `RenderContext` extension; diff title/status/help |
| `src/render.test.ts` | Tests for diff rendering |
| `src/keymap.ts` | `toggleDiff` binding; diff-mode help bars |
| `src/keymap.test.ts` | Test new binding |
| `src/ansi.ts` | Diff color constants |
| `src/cli.ts` | New CLI flags; DiffSource resolution; DiffData construction; `oldContent` highlighting |
| `src/session.ts` | `SessionConfig` gains `diffData`, `oldHighlightedLines`; `RenderContext` gains same; output includes mode/diffRef |
| `src/schema.ts` | `OutputEnvelope` gains `mode`, optional `diffRef`; `createOutput` updated |
| `src/schema.test.ts` | Output schema tests |
| `package.json` | Add `parse-diff` dependency |

---

## 12. Open Questions (Resolved)

| Question | Resolution |
| --- | --- |
| Annotations on old code? | No — new-file only |
| Toggle raw ↔ diff? | Yes, `d` key |
| Show full file or hunks only in diff view? | Hunks only (like GitLab). Toggle to raw for full file. |
| Horizontal scroll in diff mode? | Disabled. Panes truncate. |
| Where does DiffData live? | Immutable input in SessionConfig/RenderContext, not on SessionState. Minimal derived metadata (`diffMeta`) on state for reducer. |
| Old-file syntax highlighting? | Yes when `git show` succeeds. Graceful degradation (no color) when unavailable. |
| Cursor model in diff mode? | Same `cursorLine` = new-file line number. Clamped to visible lines. |
| Default viewMode when diff flags present? | `'diff'`. User toggles to `'raw'` with `d`. |
| What if annotation is on a line not in any hunk? | Invisible in diff view. Visible in raw view. Tab-cycle snaps to nearest visible line in diff mode. Acceptable tradeoff. |

---

## Execution Order

```
3.1  Diff ingestion (diff.ts, CLI flags)
  ↓
3.2  Parser + aligner (diff-align.ts, parse-diff)
  ↓
3.3  Renderer (renderDiffViewport in render.ts, ansi colors)
  ↓  depends on 3.2 types
3.4  State + dispatch (viewMode, diffMeta, cursor movement, d-key)
  ↓  depends on 3.2 types, 3.3 for visual verification
3.5  Annotation anchoring (output schema, annotation boxes in diff)
  ↓  depends on 3.3 + 3.4
3.6  Raw ↔ diff toggle (toggle_view_mode reducer, cursor translation)
     depends on everything above
```

Slices 3.1 and 3.2 are fully independent of the existing codebase and can be
built and tested in isolation. 3.3 and 3.4 can be developed in parallel once
3.2 types exist. 3.5 and 3.6 are integration slices.

---

## Estimated Effort

| Slice | Estimate | Notes |
| --- | --- | --- |
| 3.1 | 1–2 hours | CLI plumbing, git exec, tests |
| 3.2 | 3–4 hours | Core algorithm, extensive tests |
| 3.3 | 3–4 hours | Layout math, color tuning, tests |
| 3.4 | 2–3 hours | Cursor math, reducer changes, tests |
| 3.5 | 1–2 hours | Mostly wiring, schema update |
| 3.6 | 1–2 hours | Toggle logic, cursor translation |
| **Total** | **~1.5–2 days** | |
