# Quill — Implementation Plan (v0)

## Concept

**Quill** is a standalone TypeScript TUI/Node CLI that opens a single file (raw
or diff), renders it with syntax highlighting, allows line-range selection with
structured annotations, supports inline annotation threads (reply, approve,
dismiss), and outputs JSON on finish. Can accept pre-seeded annotations (e.g.,
from an agent) so the user opens the viewer with existing context.

Completely standalone — no pi, no agent runtime. JSON in, JSON out. Any
wrapper (pi, Claude Code, shell script) can spawn it and parse the result.
Target platforms for v0 are macOS and Linux.

The goal is to validate the workflow: is code-anchored structured feedback (to
an agent, to a review system, or to yourself) actually useful in practice?

---

## What exists today (current architecture)

The current architecture uses **raw ANSI terminal rendering** with an alternate
screen buffer. This replaced both the original raw `while(true)` loop prototype
and a brief Ink/React phase (removed due to unfixable full-screen flicker caused
by Ink's clear→rewrite rendering strategy).

The core loop is: `stdin keypress → reduce(state, action) → buildFrame(state) → single write()`.
No React, no framework — just a pure reducer, pure render functions, and direct
terminal I/O.

| File | Responsibility |
|------|----------------|
| `src/schema.ts` | Zod schemas, types, normalize/parse/output helpers |
| `src/state.ts` | `BrowseState`, `BrowseAction`, `reduce`, viewport math (pure, framework-agnostic) |
| `src/render.ts` | Pure frame builder: `buildFrame(ctx) → string`. Viewport, status bar, help bar, decision picker, annotation flow — all as ANSI strings |
| `src/keypress.ts` | Minimal raw-mode stdin keypress parser: `parseKeypress(data) → Key` |
| `src/terminal.ts` | TTY I/O: piped stdin reading, `/dev/tty` fallback, cleanup |
| `src/cli.ts` | CLI definition (citty), arg parsing, alternate screen buffer, raw-mode dispatch loop |

## Execution Plan

### Phase 1 — TUI rendering (complete)

Establish a flicker-free, framework-agnostic TUI rendering architecture.

**History:** Started with a raw `while(true)` loop prototype, migrated to
Ink/React components (1.1–1.6), then pivoted to raw ANSI rendering when Ink's
clear→rewrite rendering strategy caused unfixable full-screen flicker on every
keystroke. The final architecture is simpler and faster than either predecessor.

- [x] **1.1–1.6 Ink migration (superseded)**
  Built full Ink component tree (`App`, `Viewport`, `StatusBar`, `DecisionPicker`,
  `HelpBar`, `AnnotationFlow`). Worked correctly but flickered on every keystroke
  due to Ink's terminal I/O strategy (cursor-up + clear-line + rewrite per line).
  `React.memo`, `useMemo`, single-`<Text>` consolidation did not help — the
  flicker is in Ink's output layer, not React reconciliation.

- [x] **1.7 Raw ANSI pivot**
  Replaced Ink/React with raw ANSI rendering:
  - `src/render.ts` — pure `buildFrame(ctx) → string` function. Viewport, status
    bar, help bar, decision picker, annotation flow all rendered as ANSI strings.
  - `src/keypress.ts` — minimal raw stdin keypress parser (arrows, escape, enter,
    backspace, Ctrl+C, printable chars).
  - `src/cli.ts` — alternate screen buffer (`\x1b[?1049h`), cursor home
    (`\x1b[H`) + single `write()` per frame. No clearing, no flicker.
  - Deleted `src/components/` directory (6 `.tsx` files).
  - Removed `ink`, `react`, `@types/react` from dependencies.
  - Removed `jsx` config from `tsconfig.json`, `.tsx` from includes.
  - State reducer (`state.ts`) transferred 1:1 — it was already framework-agnostic.

- [x] **1.8 Manual parity verification**
  Verify raw ANSI path matches all expected behaviors on macOS and Linux:
  - `j`/`k`/arrows scroll viewport with scroll-off.
  - `g`/`G` jump to top/bottom.
  - `a` → annotation creation flow (intent → category → comment) → annotation appears.
  - `q` → decision picker → `a`/`d` → JSON stdout → exit 0.
  - `Ctrl+C` → exit 1, no output, terminal restored (alt screen off, cursor visible).
  - `--line`, `--focus-annotation`, `--annotations`, piped stdin all work.
  - Terminal resize repaints correctly.

**Exit criteria:** Raw ANSI path passes all parity checks on macOS. No React/Ink
dependencies. Zero flicker. `tsc --noEmit` clean.
✅ Phase 1 complete (1.1–1.8). Manual parity verified on macOS.

### Phase 2 — Navigation & features

All features are built on the raw ANSI renderer (`render.ts` + `state.ts`).

- [x] **2.1 Shiki syntax highlighting**
  Integrate Shiki: `file → ANSI string[]` with language detection from
  extension, configurable theme (`--theme`, default `one-dark-pro`). Feed
  highlighted lines into `Viewport`.
  *Done: `src/highlight.ts` — lazy singleton highlighter, hex→truecolor ANSI,
  60+ extension→language mappings, plain-text fallback for unknown langs.*

- [x] **2.2 Extended navigation**
  Half-page scroll (`PgUp`/`PgDn`, `Ctrl+U`/`Ctrl+D`), `gg`/`G`/`Home`/`End`
  jumps. New `set_cursor` action in reducer for absolute jumps. `gg` uses a
  300ms two-key timeout (first `g` starts timer, second `g` within window jumps
  to top; timeout expiry is a no-op). `keypress.ts` extended with `pageUp`,
  `pageDown`, `home`, `end` fields and multi-encoding support (VT, xterm, etc.).
  Help bar updated to show new bindings.

- [x] **2.3 Go-to-line**
  `:` or `Ctrl+G` → GOTO mode → number input → `Enter` jump / `Esc` cancel.
  New `goto` mode in state machine. `GotoFlowState` in `render.ts` with inline
  prompt showing digits + valid range. Reducer gains `set_cursor` action for
  absolute line jumps (shared with 2.2). Digits-only input; backspace supported.

- [x] **2.4 Line-range selection**
  `v` → SELECT mode at cursor. `Shift+↑`/`↓` from BROWSE starts selection and
  extends by one line. In SELECT: `j`/`k`/arrows/Shift+arrows extend,
  `PgUp`/`PgDn`/`Ctrl+U`/`Ctrl+D` extend by half-page, `Enter` confirms →
  ANNOTATE (annotation uses selection range), `Esc` cancels → BROWSE. Selection
  state tracked as `anchor`/`active` in `BrowseState`; `selectionRange()` helper
  returns ordered `startLine`/`endLine`. Visual highlight uses a muted blue
  truecolor background (`SELECT_BG`). Status bar shows `sel N–M (K lns)`.
  *Done: `state.ts` (4 new actions + `Selection` type + `selectionRange`),
  `keypress.ts` (Shift+Up/Down parsing), `render.ts` (selection bg, mode
  colors, help hints, status bar range), `cli.ts` (select mode dispatch,
  Shift+arrow entry from browse, multi-line annotation wiring). 19 new tests
  (state: 13, keypress: 2, render: 4). All 108 tests pass.*

- [x] **2.5 Inline annotation display + interaction**
  GitLab-style bordered annotation boxes rendered between source lines.
  `Tab` toggles expand/collapse (all annotations on cursor line). Collapsed
  annotations show `●` gutter marker; expanded show `▼` plus a bordered box
  with source/intent/category/comment, replies, and status. When cursor is on
  an expanded annotation line: `r` → REPLY mode (text input, adds reply),
  `e` → EDIT mode (text input, updates comment), `x` → delete annotation.
  Annotation boxes consume viewport rows — fewer source lines visible when
  expanded. Schema extended with `replies: Reply[]` and
  `status: 'approved' | 'dismissed'` (both optional). Reply source defaults
  to `'user'`. 269 tests (63 new).
  *New/changed files: `src/annotation-box.ts` + `src/annotation-box.test.ts`,
  `src/schema.ts` (Reply, status, replies fields), `src/state.ts`
  (expandedAnnotations, toggle/delete/update/add_reply actions, ReplyFlowState,
  EditFlowState), `src/dispatch.ts` (handleReplyKey, handleEditKey, browse Tab/r/e/x),
  `src/render.ts` (viewport interleaving, reply/edit prompts, ▼ marker),
  `src/keypress.ts` (Tab parsing), `src/cli.ts` (reply/edit mode wiring).*

- [x] **2.6 Pre-seeded annotation interaction** *(merged into 2.5)*
  Reply, edit, delete available directly when annotation is expanded on cursor
  line — no separate ANN_FOCUS mode needed. Status display (approved/dismissed)
  rendered in box. Approve/dismiss actions deferred to a future iteration
  (status can be set via input JSON round-trip).

- [x] **2.7 Search**
  `/` → SEARCH mode → pattern input (single-line textbox) → case-insensitive
  substring matching with live preview as user types. Enter commits search and
  returns to browse with matches highlighted (amber bg for matches, brighter
  amber for current match). `n`/`N` (and `Ctrl+N`/`Ctrl+P`) navigate between
  matches with wrap-around. `Esc` in search mode clears and returns to browse;
  `Esc` in browse mode clears active search highlights. Status bar shows
  `"pattern" M/N` match info. Help bar updates contextually to show search
  navigation hints.
  *Keybinding change: "new annotation" moved from `n` → `a` to free `n`/`N`
  for vim-standard search navigation.*
  *New/changed files: `src/state.ts` (SearchFlowState, SearchState, set_search/
  clear_search/navigate_match actions), `src/dispatch.ts` (handleSearchKey,
  browse `n`/`N`/`Ctrl+N`/`Ctrl+P`/`Esc` wiring, `a` for annotate),
  `src/keypress.ts` (Ctrl+N/Ctrl+P parsing), `src/render.ts` (search modal,
  viewport match highlighting, status bar search info, help bar updates),
  `src/ansi.ts` (SEARCH_BG/SEARCH_CURRENT_BG), `src/cli.ts` (search mode
  wiring + sourceLines for matching). 30 new tests (state: 10, dispatch: 18,
  keypress: 2). All 407 tests pass.*

- [x] **2.8 Terminal resize + mouse scroll**
  Resize was already wired (`stderr.on('resize', paint)` in `cli.ts`) — viewport
  height recomputes on resize and repaints. Added mouse scroll support: SGR and
  legacy X10 mouse wheel parsing in `keypress.ts`, mouse reporting
  enable/disable (`\x1b[?1000h/l`, `\x1b[?1006h/l`) in `cli.ts`, scroll
  dispatched as 3-line viewport scroll (not cursor move) in `dispatch.ts`
  via new `scroll_viewport` reducer action. Also added: line truncation
  (`truncateAnsi` in `ansi.ts`) so long lines are clipped at terminal width
  instead of wrapping into the gutter; mouse click-to-line support (SGR +
  X10 left-click parsing → `mouseRow`/`mouseCol` on `Key`, row→line mapping
  from `renderViewport`, click handler in `cli.ts` sets cursor in
  browse/select modes). `buildFrame` now returns `FrameResult` with both
  `frame` string and `rowToLine` mapping. 23 new tests (keypress: 7,
  dispatch: 4, state: 6, ansi: 6). All 439 tests pass.

**Exit criteria:** All navigation and annotation features from the spec work.
Manual smoke test on macOS covers every keybinding in the Navigation table.

### Phase 3 — Diff mode

- [ ] **3.1 Diff flag handling**
  `--diff-ref`, `--staged`, `--unstaged`, `--diff <path|->` CLI flags. Shell
  out to `git diff` for ref/staged/unstaged. Read file/stdin for `--diff`.

- [ ] **3.2 Diff parser + alignment**
  Parse unified diff (integrate `parse-diff` or hand-roll). Align old/new lines
  side-by-side: paired context, removed (left only), added (right only),
  modified (paired with background color).

- [ ] **3.3 Side-by-side rendering**
  Split terminal width, render old/new with Shiki highlighting + diff
  background colors (red/green). Truncate long lines with `…`.

- [ ] **3.4 Annotations anchor to new-file lines**
  Build `displayRow → newFileLine` mapping. Selection and annotation creation
  reference new-file line numbers. Status bar shows new-file line numbers.

**Exit criteria:** `quill src/auth.ts --diff-ref main` renders a usable
side-by-side diff with syntax highlighting and annotation support.

### Phase 4 — Polish & ship

- [ ] **4.1 Tests**
  Vitest coverage for: Zod schemas (round-trip, malformed input), reducer
  (all action types, edge cases), diff parser, alignment algorithm, line
  mapping.

- [ ] **4.2 Mouse scroll**
  Terminal mouse event handling → viewport scroll.

- [ ] **4.3 Edge cases**
  Empty files, huge files (1M+ lines), very long lines, binary file detection
  with clear error, files with no trailing newline.

- [ ] **4.4 Build swap**
  Replace `build` script with `tsc --project tsconfig.build.json`. Remove
  `tsup` from devDependencies. Verify `npm run build && node dist/cli.js --help`
  on macOS + Linux. See [Build Migration](#build-migration-tsup--tsc).

- [ ] **4.5 Cross-platform verification**
  Full manual test on macOS + Linux. `npm run dev` and `node dist/cli.js` both
  work.

- [ ] **4.6 README**
  Usage examples, input/output contract summary, installation instructions.

**Exit criteria:** All tests pass, builds on both platforms, README exists,
no known P0 bugs.

---

## Table of Contents

- [What exists today (raw loop prototype)](#what-exists-today-raw-loop-prototype)
- [Execution Plan](#execution-plan)
- [Architecture](#architecture)
- [CLI Interface](#cli-interface)
- [Input Contract](#input-contract)
- [Output Contract](#output-contract)
- [Data Model](#data-model)
- [Annotation Taxonomy](#annotation-taxonomy)
- [Rendering](#rendering)
- [Navigation](#navigation)
- [Annotation Workflow](#annotation-workflow)
- [Inline Annotation Display](#inline-annotation-display)
- [Modes & State Machine](#modes--state-machine)
- [Tech Stack](#tech-stack)
- [Build Migration: `tsup → tsc`](#build-migration-tsup--tsc)
- [Project Setup](#project-setup)
- [Component Architecture](#component-architecture)
- [Scope Cuts](#scope-cuts)
- [Incremental Delivery Plan](#incremental-delivery-plan-review-friendly)
- [Effort Estimate](#effort-estimate)
- [Migration & Integration Path](#migration--integration-path)
- [Relationship to Full Product](#relationship-to-full-product)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Standalone TUI (Node CLI first)                     │
│                                                      │
│  Input:                                              │
│  - File path (positional arg)                        │
│  - Annotations JSON (stdin, file, or inline flag)    │
│  - Mode flags (--diff-ref, --staged, --unstaged)     │
│                                                      │
│  Rendering:                                          │
│  - Raw mode: Shiki syntax highlighting               │
│  - Diff mode: Shiki + own side-by-side renderer      │
│  - Inline annotation blocks (collapsible threads)    │
│  - Gutter: line numbers, annotation markers, diff +/-│
│                                                      │
│  Interaction:                                        │
│  - Dual keybindings (arrow + vim)                    │
│  - Line-range selection                              │
│  - Annotation creation (intent + category + comment) │
│  - Thread interaction (reply, approve, dismiss)      │
│  - Search                                            │
│                                                      │
│  Output:                                             │
│  - JSON to stdout on finish decision                 │
│  - UI to stderr (piping-safe)                        │
│  - Exit 0 = approve/deny, exit 1 = abort             │
│                                                      │
│  No agent/pi/runtime dependency.                     │
│  No external native binary dependencies.             │
└──────────────────────────────────────────────────────┘
```

**Key principle:** the tool is a pure function over structured data. It receives
a file + optional annotations + optional diff, renders an interactive session,
and emits the resulting annotations plus a file-level decision (`approve` /
`deny`). The caller decides what to do with the output.

---

## CLI Interface

```bash
# ─── Raw file mode ───────────────────────────────────

# Open a file
quill src/auth.ts

# Open at a specific line
quill src/auth.ts --line 42

# Open focused on an existing annotation id (if present)
quill src/auth.ts --focus-annotation ann_7f3a

# ─── Diff mode ───────────────────────────────────────

# Diff against a git ref (tool runs `git diff` internally)
quill src/auth.ts --diff-ref main

# Diff staged changes
quill src/auth.ts --staged

# Diff unstaged changes (working tree vs index)
quill src/auth.ts --unstaged

# Diff provided externally (caller controls diff source)
quill src/auth.ts --diff path/to/file.patch
quill src/auth.ts --diff -              # read diff from stdin

# ─── Pre-seeded annotations ─────────────────────────

# From a file
quill src/auth.ts --annotations agent-notes.json

# From stdin (primary agent invocation path)
cat input.json | quill src/auth.ts

# Piped input with diff mode
cat input.json | quill src/auth.ts --diff-ref main

# ─── Combined ────────────────────────────────────────

# Agent provides annotations, user reviews diff against main
cat agent-review.json | quill src/auth.ts --diff-ref main --line 42
```

### Argument summary

| Argument               | Type                 | Description                                              |
| ---------------------- | -------------------- | -------------------------------------------------------- |
| `<file>`               | positional, required | Path to the file to review                               |
| `--line <n>`                  | optional             | Start with cursor at line N                                     |
| `--focus-annotation <id>`     | optional             | Start focused on annotation id (fallbacks to `--line`/top)      |
| `--diff-ref <ref>`            | optional             | Diff against git ref (runs `git diff <ref> -- <file>`)          |
| `--staged`             | optional             | Diff staged changes (runs `git diff --staged -- <file>`) |
| `--unstaged`           | optional             | Diff unstaged changes (runs `git diff -- <file>`)        |
| `--diff <path\|->`     | optional             | Read unified diff from file or stdin                     |
| `--annotations <path>` | optional             | Read annotations JSON from file                          |
| `--width <n>`          | optional             | Override terminal width (default: auto-detect)           |
| `--theme <name>`       | optional             | Shiki theme name (default: `one-dark-pro`)               |
| `--help`               | flag                 | Show usage with examples                                 |
| `--version`            | flag                 | Show version                                             |

### Stdin detection

If stdin is not a TTY (i.e., data is being piped), the tool reads it as JSON
annotations input. This is the primary agent invocation path — no
`--annotations` flag needed. After reading stdin to completion, the tool reopens
`/dev/tty` for interactive keyboard input (same pattern as `fzf`, `vim`,
`less`).

If both `--annotations <file>` and piped stdin are present, `--annotations`
takes precedence and stdin is ignored.

If `--diff -` is used, stdin is read as a unified diff instead of annotations.
`--diff -` and piped annotations cannot be combined (error with clear message).

### Startup focus behavior

1. If `--focus-annotation <id>` is provided and found, cursor jumps to that
   annotation's `startLine` and the annotation is expanded/focused.
2. Else if `--line <n>` is provided, cursor starts at line `n` (clamped).
3. Else cursor starts at line 1.

If the focused annotation id is missing (e.g., annotation deleted or invalid
input), the tool falls back to `--line` or line 1.

---

## Input Contract

### Annotations input (JSON)

Accepted via stdin (pipe) or `--annotations <file>`:

```json
{
  "annotations": [
    {
      "id": "ann_7f3a",
      "startLine": 42,
      "endLine": 48,
      "intent": "question",
      "category": "bug",
      "comment": "Is there a race condition here? getToken can resolve after session expires.",
      "source": "agent"
    },
    {
      "startLine": 10,
      "endLine": 10,
      "intent": "instruct",
      "comment": "This export should be internal.",
      "source": "agent",
      "replies": [
        {
          "comment": "It's used by the test suite — need to find another way.",
          "source": "user"
        }
      ],
      "status": "dismissed"
    }
  ]
}
```

All fields in the annotation schema are described in [Data Model](#data-model).
The input format is a subset of the output format — the tool can round-trip its
own output as input (enables agent re-invocation loops).

### Diff input

When `--diff <path>` or `--diff -` is used, the tool expects standard unified
diff format:

```diff
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -40,6 +40,8 @@ export const authenticate = async () => {
   const token = await getToken();
   if (!token) return null;
+  if (isExpired(token)) {
+    await refreshToken();
+  }
   const session = await validateSession(token);
   return session;
 };
```

When `--diff-ref`, `--staged`, or `--unstaged` is used, the tool shells out to
`git diff` and captures the output internally.

---

## Output Contract

### Success (exit code 0)

Emitted to **stdout** when user finishes the session (`q` / `Ctrl+Q` → decision picker):

```json
{
  "file": "src/auth.ts",
  "mode": "raw",
  "decision": "approve",
  "annotations": [
    {
      "id": "ann_7f3a",
      "startLine": 42,
      "endLine": 48,
      "intent": "question",
      "category": "bug",
      "comment": "Is there a race condition here?",
      "source": "agent",
      "status": "approved",
      "replies": [
        {
          "comment": "Confirmed — adding mutex guard.",
          "source": "user"
        }
      ]
    },
    {
      "id": "ann_9c22",
      "startLine": 12,
      "endLine": 12,
      "intent": "instruct",
      "comment": "Remove this export — only used internally.",
      "source": "user"
    },
    {
      "id": "ann_f0b1",
      "startLine": 87,
      "endLine": 87,
      "intent": "praise",
      "comment": "Nice error handling here.",
      "source": "user"
    }
  ]
}
```

### Abort (exit code 1)

`Ctrl+C` — no stdout output, process exits with code 1.

### Finish flow (exit code 0)

When user presses `q` / `Ctrl+Q` in `BROWSE`, Quill opens a decision picker:

- `a` → `decision: "approve"`
- `d` → `decision: "deny"`
- `Esc` → return to `BROWSE` (no output yet)

### Field rules

| Field                             | Presence       | Notes                                                                                      |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `file`                            | Always         | Relative path as provided to CLI                                                           |
| `mode`                            | Always         | `"raw"` or `"diff"`                                                                                 |
| `decision`                        | Always         | `"approve"` or `"deny"` (file-level outcome for caller loop control)                                |
| `diffRef`                         | When diff mode | The ref/mode used (e.g., `"main"`, `"staged"`, `"unstaged"`)                                        |
| `annotations`                     | Always         | Array, may be empty if user finishes with no annotations                                            |
| `annotations[].id`                | Always         | Stable annotation id for round-trip/focus (`--focus-annotation`). Generated as UUID if absent on input. |
| `annotations[].startLine`         | Always         | 1-indexed                                                                                           |
| `annotations[].endLine`           | Always         | 1-indexed, `>= startLine`                                                                  |
| `annotations[].intent`            | Always         | See [Intent](#intent-required)                                                             |
| `annotations[].category`          | Optional       | Omitted (not `null`) when not set. See [Category](#category-optional)                      |
| `annotations[].comment`           | Always         | Non-empty string                                                                           |
| `annotations[].source`            | Always         | `"user"`, `"agent"`, or arbitrary string for extensibility                                 |
| `annotations[].status`            | Optional       | `"approved"` \| `"dismissed"`. Only on pre-seeded annotations. Omitted if no action taken. |
| `annotations[].replies`           | Optional       | Array of reply objects. Omitted if empty.                                                  |
| `annotations[].replies[].comment` | Always         | Non-empty string                                                                           |
| `annotations[].replies[].source`  | Always         | `"user"`, `"agent"`, etc.                                                                  |

### Round-trip guarantee

The output is a strict superset of valid input. This means:

```bash
# Agent reviews, user annotates, agent gets result, re-invokes with accumulated context
cat agent-review.json | quill src/auth.ts > round1.json
# ... agent processes round1.json, adds more annotations ...
cat agent-round2.json | quill src/auth.ts > round2.json
```

Each round preserves all previous annotations (including stable `id`s),
statuses, replies, and adds new ones.

---

## Data Model

### Annotation

```typescript
type KnownIntent = 'instruct' | 'question' | 'comment' | 'praise';
type KnownCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'design'
  | 'style'
  | 'nitpick';
type Intent = string; // KnownIntent + forward-compatible custom values
type Category = string; // KnownCategory + forward-compatible custom values
type AnnotationStatus = 'approved' | 'dismissed';

type Reply = {
  comment: string;
  source: string;
};

type Annotation = {
  id?: string; // input may omit; output always includes generated stable UUID id
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed, >= startLine
  intent: Intent;
  category?: Category; // omitted when not set
  comment: string;
  source: string; // "user", "agent", or arbitrary
  status?: AnnotationStatus; // only on pre-seeded annotations, omitted if no action
  replies?: Reply[]; // omitted if empty
};
```

### Input envelope

```typescript
type ReviewDecision = 'approve' | 'deny';

type ReviewInput = {
  annotations?: Annotation[];
  // Optional fields are accepted for round-tripping previous outputs directly.
  file?: string;
  mode?: 'raw' | 'diff';
  decision?: ReviewDecision;
  diffRef?: string;
};
```

### Output envelope

```typescript
type ReviewOutput = {
  file: string;
  mode: 'raw' | 'diff';
  decision: ReviewDecision;
  diffRef?: string;
  annotations: Annotation[];
};
```

### Internal state (not serialized)

```typescript
type AnnotationState = Annotation & {
  id: string; // normalized stable ID for React keys + focus tracking
  collapsed: boolean; // UI state: is the inline block collapsed?
  isPreSeeded: boolean; // from input (true) vs created in session (false)
};
```

---

## Annotation Taxonomy

### Intent (required)

What should happen with this annotation — determines **routing**.

| Intent     | Shortcut | Meaning                       | Example                         |
| ---------- | -------- | ----------------------------- | ------------------------------- |
| `instruct` | `i`      | Agent should fix/change this  | "Remove this unused import"     |
| `question` | `q`      | Agent should explain this     | "Why is this exported?"         |
| `comment`  | `c`      | Pass-through to review system | "Consider renaming for clarity" |
| `praise`   | `p`      | Positive signal               | "Nice error handling"           |

### Category (optional)

What kind of issue — **metadata** for filtering and prioritization.

| Category      | Shortcut | Meaning                                   |
| ------------- | -------- | ----------------------------------------- |
| `bug`         | `b`      | Correctness problem                       |
| `security`    | `s`      | Security concern                          |
| `performance` | `f`      | Performance issue                         |
| `design`      | `d`      | Architecture / structural concern         |
| `style`       | `t`      | Naming, formatting, conventions           |
| `nitpick`     | `k`      | Minor preference, explicitly non-blocking |

`Enter` skips category selection.

The JSON schema accepts **arbitrary strings** for both intent and category, so
adapters and future versions can extend the taxonomy without breaking the
contract. The TUI renders known values with icons/colors and passes through
unknown values unchanged.

### Combining the axes

| Combination              | Signal                                                    |
| ------------------------ | --------------------------------------------------------- |
| `instruct` + `bug`       | Urgent — correctness issue, agent must fix                |
| `instruct` + `nitpick`   | Low-priority — agent should fix but it's minor            |
| `comment` + `security`   | Flag to review system — security concern for human review |
| `question` + `design`    | Agent: explain the architectural choice here              |
| `praise` + (no category) | Simple positive feedback                                  |

---

## Rendering

### Raw mode

```
┌─ src/auth.ts ──────────────────────────────────────────┐
│                                                        │
│  1 │   import { getToken } from './token';             │
│  2 │   import { validateSession } from './session';    │
│  3 │                                                   │
│  4 │   export const authenticate = async () => {       │
│  5 │     const token = await getToken();               │
│  6 │ ●   if (!token) return null;                      │  ← collapsed annotation marker
│  7 │     const session = await validateSession(token); │
│  8 │     return session;                               │
│  9 │   };                                              │
│    │                                                   │
│────│───────────────────────────────────────────────────│
│ BROWSE  ln 6/9  1 annotation  raw                      │  ← status bar
└────────────────────────────────────────────────────────┘
```

**Rendering pipeline (raw):**

1. Read file content
2. Run through Shiki with detected language + chosen theme → array of
   ANSI-colored strings (one per source line)
3. Prepend line numbers (right-aligned, consistent width) + gutter column
   (annotation markers)
4. Interleave annotation blocks between source lines where expanded
5. Slice visible window based on viewport offset + terminal height
6. Render to stderr

### Diff mode (side-by-side)

```
┌─ src/auth.ts (main → working tree) ─────────────────────────────────────────┐
│                                                                             │
│  40 │   const token = await getToken();     │  40 │   const token = await … │
│  41 │   if (!token) return null;            │  41 │   if (!token) return …  │
│     │                                       │  42 │+  if (isExpired(token)) │
│     │                                       │  43 │+    await refreshToken… │
│     │                                       │  44 │+  }                     │
│  42 │   const session = await validate…     │  45 │   const session = await │
│  43 │ ● return session;                     │  46 │   return session;       │
│     │                                                                       │
│─────│───────────────────────────────────────────────────────────────────────│
│ BROWSE  ln 43/46 (new)  1 annotation  diff main                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rendering pipeline (diff):**

1. Parse unified diff → extract hunks with old/new line numbers and change types
2. Reconstruct old and new file content (or read from git if available)
3. Syntax highlight both old and new content with Shiki → two arrays of ANSI
   strings
4. Align lines side-by-side:
   - Unchanged lines: paired left and right
   - Removed lines: left side with red background, right side blank (padding)
   - Added lines: left side blank (padding), right side with green background
   - Modified lines: left (red) paired with right (green)
5. Split terminal width in half (minus separator), truncate long lines with `…`
6. Prepend line numbers + gutter per side
7. Interleave annotation blocks (anchored to **new-file** line numbers)
8. Slice visible window, render to stderr

**Diff alignment algorithm:**

- Walk hunks sequentially
- Between hunks: emit context lines paired 1:1
- Within a hunk: group consecutive `-` lines and `+` lines; pair them
  positionally (first `-` with first `+`, etc.); overflow on either side gets
  blank padding on the opposite side
- This is the standard side-by-side diff algorithm (same as
  `diff --side-by-side` or what delta/difftastic use)

**Line number mapping for annotations:**

- Annotations always reference **new-file** line numbers (the right side in
  side-by-side)
- The diff parser builds a `displayRow → newFileLine` mapping during alignment
- Selection operates on new-file lines; the display row mapping translates
  cursor position to source line

### Syntax highlighting details

- **Shiki** handles language detection from file extension and tokenization
- Theme is configurable (`--theme`), default `one-dark-pro`
- Shiki outputs ANSI escape sequences — we get colored strings we can slice and
  compose
- Diff background colors (red/green) are layered on top of syntax colors using
  ANSI background codes
- Pre-seeded annotation markers and selection highlights are also ANSI layers

### Gutter

The gutter sits between line numbers and code content:

| Symbol | Meaning                              |
| ------ | ------------------------------------ |
| `●`    | Collapsed annotation(s) on this line |
| `▼`    | Expanded annotation on this line     |
| `+`    | Added line (diff mode, right side)   |
| `-`    | Removed line (diff mode, left side)  |
| `█`    | Current selection range              |
| ` `    | No marker                            |

When multiple markers apply (e.g., annotation on an added line), annotation
marker takes precedence in the annotation gutter column; diff markers live in a
separate column.

### Status bar

Fixed at the bottom of the viewport. Shows:

```
MODE  ln CURSOR/TOTAL  N annotations  MODE_INFO  [search: "pattern" (M/N)]
```

- `MODE`: `BROWSE`, `DECIDE`, `SELECT`, `ANNOTATE`, `REPLY`, `SEARCH`, `GOTO`
- `ln CURSOR/TOTAL`: current cursor line / total lines
- `N annotations`: count of all annotations in session
- `MODE_INFO`: `raw` or `diff <ref>`
- Search info: shown when search is active, with match index

---

## Navigation

### Dual keybindings

Both intuitive (arrow-based) and vim-style keybindings are supported. They bind
to the same actions — no branching logic, just a wider keymap.

| Action                   | Intuitive                            | Vim-style                    | Notes                                 |
| ------------------------ | ------------------------------------ | ---------------------------- | ------------------------------------- |
| Line up/down             | `↑` / `↓`                            | `k` / `j`                    | Moves cursor one line                 |
| Half-page up/down        | `Page Up` / `Page Down`              | `Ctrl+U` / `Ctrl+D`          |                                       |
| Top of file              | `Home`                               | `gg`                         | See [gg handling](#gg-handling)       |
| Bottom of file           | `End`                                | `G`                          |                                       |
| Go to line               | `Ctrl+G` → type number → `Enter`     | `:` → type number → `Enter`  |                                       |
| Search                   | `/` → type pattern → `Enter`         | `/` → type pattern → `Enter` | Case-insensitive by default           |
| Next search match        | `Enter` (in search) / `Ctrl+N`       | `n`                          |                                       |
| Prev search match        | `Shift+Enter` (in search) / `Ctrl+P` | `N`                          |                                       |
| Clear search             | `Esc`                                | `Esc`                        |                                       |
| Start selection          | `Shift+↑` or `Shift+↓`               | `v`                          | Enters SELECT mode                    |
| Extend selection         | `Shift+↑` / `Shift+↓`                | `j` / `k` (in SELECT)        |                                       |
| Confirm selection        | `Enter`                              | `Enter`                      | Enters ANNOTATE mode                  |
| Cancel selection         | `Esc`                                | `Esc`                        | Returns to BROWSE                     |
| Toggle annotation expand | `Enter` (on annotated line)          | `Enter`                      | When not in selection                 |
| Enter annotation focus   | `Tab` (on expanded annotation)       | `Tab`                        | Focus moves into the annotation block |
| Exit annotation focus    | `Esc` / `Tab`                        | `Esc` / `Tab`                | Focus returns to source line          |
| Finish session           | `Ctrl+Q`                             | `q` (BROWSE mode only)       | Opens decision picker (`a` approve / `d` deny / `Esc` cancel) |
| Abort (no output)        | `Ctrl+C`                             | `Ctrl+C`                     | Exit 1, no output                     |
| Mouse scroll             | Scroll wheel                         | Scroll wheel                 | Moves viewport                        |

### `gg` handling

`g` starts a 300ms timeout. Second `g` within the window → jump to top. If
timeout expires without second `g`, nothing happens. No other `g`-prefixed
commands exist in v0 so this is unambiguous.

### Viewport scrolling behavior

- Cursor is always visible — viewport scrolls to keep cursor in view
- Cursor movement beyond viewport edge scrolls the viewport (scroll-off of 3
  lines — cursor stays 3 lines from the edge)
- Half-page jumps move both cursor and viewport
- Expanded annotation blocks count as display rows for viewport purposes but are
  skipped by line-up/line-down cursor movement (cursor jumps over them to the
  next source line)

### Diff mode navigation

- Cursor lives on the **new-file side** (right side) by default — this is where
  you annotate
- Line numbers in the status bar show new-file line numbers
- Search searches new-file content by default
- All navigation references new-file lines

---

## Annotation Workflow

### Creating a new annotation

1. **Select range**: `Shift+↑`/`↓` or `v` to enter SELECT mode. Arrow keys
   extend the range. Status bar shows `SELECT ln 42-48`.
2. **Confirm range**: `Enter`. Mode transitions to ANNOTATE.
3. **Pick intent**: Inline picker appears below the selected range. Single
   keypress: `i` (instruct), `q` (question), `c` (comment), `p` (praise).
   Required — no default.
4. **Pick category**: Second inline picker. Single keypress: `b` (bug), `s`
   (security), `f` (performance), `d` (design), `t` (style), `k` (nitpick).
   `Enter` to skip. Optional.
5. **Write comment**: Text input field appears. Type freely. `Enter` to submit.
   `Esc` to cancel the entire annotation (returns to BROWSE, no annotation
   created).
6. **Done**: Annotation is created, gutter marker appears on the annotated lines
   (collapsed by default), mode returns to BROWSE.

### Interacting with existing annotations

**Expand/collapse:**

- Move cursor to a line with a gutter marker (`●`)
- Press `Enter` → annotation block expands inline (marker becomes `▼`)
- Press `Enter` again → collapses

**Focus an annotation block:**

- With annotation expanded, press `Tab` → focus moves into the annotation block
- Inside the block, available actions:

| Action       | Key           | Effect                                                                                                            |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Reply        | `r`           | Opens text input for reply. `Enter` to submit, `Esc` to cancel.                                                   |
| Approve      | `a`           | Sets `status: "approved"` on the annotation. Visual indicator changes. Only for pre-seeded annotations.           |
| Dismiss      | `d`           | Sets `status: "dismissed"` on the annotation. Visual indicator changes (dimmed). Only for pre-seeded annotations. |
| Clear status | `u`           | Removes `status` (undo approve/dismiss). Only for pre-seeded annotations with a status.                           |
| Exit focus   | `Esc` / `Tab` | Returns focus to source line browsing.                                                                            |

**User-created annotations:**

- Cannot be approved/dismissed (those actions are for responding to pre-seeded
  annotations)
- Can receive replies (for round-trip scenarios where the tool is re-invoked
  with previous output)
- In v0, cannot be edited or deleted after creation (scope cut — add in v0.1)

### Annotation on annotated line

If the user selects a range that overlaps with an existing annotation, a new
separate annotation is created. Multiple annotations can exist on the same
line(s). The gutter marker indicates "has annotation(s)" — expanding shows all
annotations on that line stacked vertically.

---

## Inline Annotation Display

### Collapsed (default)

```
 42 │ ●  if (!token) return null;
```

Single `●` in the gutter. If multiple annotations exist on line 42, still one
`●` (expand to see all).

### Expanded (single annotation)

```
 42 │ ▼  if (!token) return null;
    │    ┌─ agent · question · bug ──────────────────────────┐
    │    │ Is there a race condition here? getToken can       │
    │    │ resolve after session expires.                     │
    │    │                                                    │
    │    │  ↳ you: Confirmed — adding mutex guard.            │
    │    │                                                    │
    │    │ ✓ approved   [r]eply  [u]ndo                       │
    │    └────────────────────────────────────────────────────┘
 43 │    const session = await validateSession(token);
```

### Expanded (multiple annotations on same line)

```
 42 │ ▼  if (!token) return null;
    │    ┌─ agent · question · bug ──────────────────────────┐
    │    │ Is there a race condition here?                    │
    │    │ ✓ approved   [r]eply  [u]ndo                       │
    │    └────────────────────────────────────────────────────┘
    │    ┌─ you · instruct ──────────────────────────────────┐
    │    │ Also add a timeout to the getToken call.           │
    │    └────────────────────────────────────────────────────┘
 43 │    const session = await validateSession(token);
```

### Visual distinction by source

| Source  | Style                                             |
| ------- | ------------------------------------------------- |
| `agent` | Dimmed border, `agent` label, italic comment text |
| `user`  | Normal border, `you` label, normal comment text   |
| Other   | Dimmed border, source value as label              |

### Visual distinction by status

| Status              | Indicator                                               |
| ------------------- | ------------------------------------------------------- |
| No status (pending) | No indicator                                            |
| `approved`          | `✓ approved` in green                                   |
| `dismissed`         | `✗ dismissed` in dim/strikethrough, entire block dimmed |

### Annotation block sizing

- Block width: terminal width minus gutter, capped at 80 chars for readability
- Comment text wraps within the block
- Block height: dynamic based on content (comment length + replies + action bar)
- Maximum visible height before internal scroll: 10 lines (prevents one giant
  annotation from consuming the viewport). If content exceeds this, the block
  gets its own scroll indicator.

---

## Modes & State Machine

The TUI has a small set of modes. Only valid transitions are allowed.

```
                    ┌──────────┐
                    │  BROWSE  │◄──────────────────────────────┐
                    └────┬─────┘                               │
                         │                                     │
              ┌──────────┼──────────┬─────────────┐            │
              ▼          ▼          ▼             ▼            │
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
        │  SELECT  │ │  SEARCH  │ │   GOTO   │ │ ANN_FOCUS │  │
        └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘  │
             │            │            │              │         │
             ▼            │            │         ┌────┴────┐    │
        ┌──────────┐      │            │         │  REPLY  │    │
        │ ANNOTATE │      │            │         └────┬────┘    │
        └────┬─────┘      │            │              │         │
             │            │            │              │         │
             └────────────┴────────────┴──────────────┴─────────┘
                              all → BROWSE via Esc/completion
```

`DECIDE` is a lightweight modal branch from `BROWSE` (`q`/`Ctrl+Q`) used only
for selecting `approve` vs `deny` before emitting output.

### Mode definitions

| Mode        | Entry                                        | Behavior                                                                                             | Exit                                                                                                                                             |
| ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BROWSE`    | Default / after any completion               | Navigate source lines, expand/collapse annotations, start finish flow, abort                         | `Shift+Arrow`/`v` → SELECT, `/` → SEARCH, `Ctrl+G`/`:` → GOTO, `Tab` on expanded annotation → ANN_FOCUS, `q`/`Ctrl+Q` → DECIDE, `Ctrl+C` → abort |
| `DECIDE`    | From BROWSE via `q`/`Ctrl+Q`                 | File-level outcome picker (`a` approve / `d` deny)                                                   | `a`/`d` → emit JSON + exit 0, `Esc` → BROWSE                                                                                                     |
| `SELECT`    | From BROWSE via `Shift+Arrow` or `v`         | Extend line range with arrow keys, visual highlight on selected range                                | `Enter` → ANNOTATE, `Esc` → BROWSE (cancel)                                                                                                      |
| `ANNOTATE`  | From SELECT via `Enter`                      | Sequential sub-steps: intent picker → category picker → text input                                   | `Enter` on text → create annotation → BROWSE, `Esc` at any sub-step → BROWSE (cancel)                                                            |
| `SEARCH`    | From BROWSE via `/`                          | Text input for search pattern, results highlighted in real-time, `Enter`/`n`/`N` to navigate matches | `Esc` → BROWSE (clears search), `Enter` on match → BROWSE (keeps highlights)                                                                     |
| `GOTO`      | From BROWSE via `Ctrl+G` or `:`              | Number input, jump on `Enter`                                                                        | `Enter` → BROWSE (at target line), `Esc` → BROWSE (cancel)                                                                                       |
| `ANN_FOCUS` | From BROWSE via `Tab` on expanded annotation | Annotation block is focused, `r`/`a`/`d`/`u` actions available                                       | `Esc`/`Tab` → BROWSE, `r` → REPLY                                                                                                                |
| `REPLY`     | From ANN_FOCUS via `r`                       | Text input for reply content                                                                         | `Enter` → add reply → ANN_FOCUS, `Esc` → ANN_FOCUS (cancel)                                                                                      |

### Global keys (work in all modes)

| Key          | Action                               |
| ------------ | ------------------------------------ |
| `Ctrl+C`     | Abort — exit 1, no output            |
| Mouse scroll | Move viewport (does not change mode) |

---

## Tech Stack

| Concern             | Choice                 | Why                                                                         |
| ------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Language            | TypeScript             | Matches target user's stack, fast iteration                                 |
| Runtime             | Node.js 20+            | LTS, stable                                                                 |
| TUI rendering        | Raw ANSI (alternate screen buffer) | Flicker-free full-screen rendering. Replaced Ink 5 which caused unfixable clear→rewrite flicker. |
| Syntax highlighting | Shiki                  | Best-in-class ANSI output, huge language/theme coverage, active maintenance |
| Diff parsing        | `parse-diff`           | Lightweight, well-tested unified diff parser                                |
| CLI args            | `citty`                | Clean API, auto-generated help, TypeScript-first                            |
| Schema validation   | Zod                    | Validate input JSON, infer types from schemas                               |
| Build (dev)         | `ts-node` (ESM loader) | Pure-JS TS execution, no native binaries — works on macOS and Linux without reinstall (`tsx`/`tsup` both vendor esbuild native binaries that break across platforms) |
| Build (dist)        | `tsc` (planned)        | Plain `tsc --outDir dist` — pure-JS, no native binaries. Replaces `tsup` which vendors esbuild native binaries that break across platforms. See [Build Migration: `tsup → tsc`](#build-migration-tsup--tsc) for the full transition plan. **Status: no JSX/TSX in project (Ink removed), `tsc` build verified.** Swap `build` script to `build:tsc` when ready (Phase 4.4). |
| Packaging (later)   | Bun compile (optional) | Follow-up optimization once behavior is stable                               |
| Testing             | Vitest                 | Fast, TypeScript-native, familiar API                                       |

### Key npm dependencies (expected)

```json
{
  "citty": "^0.2.0",
  "remeda": "^2.33.0",
  "zod": "^3.21.0",
  "shiki": "4.0.1",
  "parse-diff": "^0.11.0"
}
```

> `ink` and `react` were removed after the raw ANSI pivot (Phase 1.7).
> TUI rendering uses no framework — just ANSI escape sequences and `process.stderr.write()`.

---

## Build Migration: `tsup → tsc`

### Problem

`tsup` wraps esbuild, which ships platform-specific native binaries. Running
`npm run build` on a different OS/arch than the `npm install` platform fails
with a binary mismatch. This is the same issue that forced us off `tsx` for dev
(solved with `ts-node`). The build step must also be pure-JS to work reliably
across macOS and Linux without reinstalling dependencies.

### Target state

| Concern | Current (broken) | Target |
|---------|------------------|--------|
| Dev runner | `ts-node` (ESM loader) ✓ | No change |
| Build | `tsup src/cli.ts --format esm --target node20 --out-dir dist` ✗ | `tsc --project tsconfig.build.json` |
| Output | Single bundled `dist/cli.js` | `dist/` tree mirroring `src/` (one `.js` per `.ts`) |
| Start | `node dist/cli.js` | `node dist/cli.js` (unchanged) |
| Native binaries | `esbuild` (via `tsup`) | None |

### What the swap touches

1. **`tsconfig.build.json`** (new) — extends `tsconfig.json`, adds:
   - `"declaration": true` (optional, useful if publishing types)
   - `"sourceMap": true`
   - `"outDir": "dist"`
   - Excludes test files (`"exclude": ["src/**/*.test.ts", "test/**"]`)
   - No JSX config needed (Ink/React removed in Phase 1.7)

2. **`package.json` scripts** — swap `build` to use `tsc`:
   ```jsonc
   // Before
   "build": "tsup src/cli.ts --format esm --target node20 --out-dir dist",
   // After
   "build": "tsc --project tsconfig.build.json",
   ```

3. **`package.json` devDependencies** — remove `tsup` (and transitively `esbuild`):
   ```bash
   npm uninstall tsup
   ```

4. **`dist/` output shape changes** — `tsc` emits a file tree, not a single bundle:
   - `dist/cli.js` (entry point, unchanged path)
   - `dist/schema.js`, `dist/state.js`, `dist/render.js`, `dist/terminal.js`, etc.
   - Imports in source already use `.js` extensions (`'./schema.js'`) which is
     correct for NodeNext resolution — no rewriting needed.

5. **`bin` field in `package.json`** — stays `"dist/cli.js"`, no change.

6. **Shebang line** — `src/cli.ts` already has `#!/usr/bin/env node`, `tsc`
   preserves it in the output. Verify after first build.

7. **No JSX consideration** — Ink/React were removed in Phase 1.7 (raw ANSI
   pivot). No `.tsx` files remain in the project. `tsconfig.json` no longer
   includes `jsx` config.

### Sequencing

| Gate | Status |
|------|--------|
| Phase 1.8 manual parity verification passes | Pending |
| No `.tsx` files in project (Ink removed) | ✅ Done |
| `tsconfig.build.json` created and `tsc` build verified | ✅ Done (`npm run build:tsc` works) |
| `tsup` removed from `devDependencies` | Not started (still used by `build` script) |
| `npm run build && node dist/cli.js --help` passes on macOS + Linux | Not started |

### Risks

- **No tree-shaking**: `tsc` doesn't tree-shake or bundle. The `dist/` output
  will be slightly larger (multiple files, unused re-exports preserved). This is
  acceptable for a CLI tool — startup time is dominated by Node.js boot, not
  file count. If it becomes a problem, evaluate `rollup` (pure-JS bundler) as a
  post-`tsc` step.
- **Source maps in production**: `tsc` emits `.js.map` files. Harmless but adds
  noise. Can be excluded from the npm package via `.npmignore` or `"files"` in
  `package.json`.
- **Import path correctness**: All imports must use `.js` extensions for
  NodeNext. Currently true — verify with `grep -r "from './" src/ | grep -v ".js'"`.

---

## Project Setup

### Directory structure

```
quill/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── cli.ts                   # citty CLI definition, arg parsing, stdin handling
│   ├── app.tsx                  # root Ink <App> component
│   ├── types.ts                 # data model types + Zod schemas
│   ├── rendering/
│   │   ├── shiki.ts             # Shiki highlighter setup + file → ANSI lines
│   │   ├── diff-parser.ts       # unified diff → structured hunks
│   │   ├── diff-aligner.ts      # hunks → aligned side-by-side display rows
│   │   └── line-map.ts          # display row ↔ source line mapping
│   ├── components/
│   │   ├── Viewport.tsx         # scrollable line container, cursor management
│   │   ├── SourceLine.tsx       # single source line: gutter + line number + code
│   │   ├── AnnotationBlock.tsx  # collapsible inline annotation with thread
│   │   ├── IntentPicker.tsx     # single-keypress intent selector
│   │   ├── CategoryPicker.tsx   # single-keypress category selector (skippable)
│   │   ├── DecisionPicker.tsx   # approve/deny finish prompt
│   │   ├── TextInput.tsx        # inline text input for comments/replies
│   │   ├── StatusBar.tsx        # bottom status bar
│   │   └── SearchBar.tsx        # search input + match navigation
│   ├── hooks/
│   │   ├── use-keymap.ts        # dual keybinding handler (arrow + vim)
│   │   ├── use-viewport.ts      # viewport state: offset, cursor, scroll logic
│   │   ├── use-annotations.ts   # annotation CRUD, status changes, replies
│   │   ├── use-selection.ts     # line-range selection state
│   │   ├── use-search.ts        # search state, match positions, navigation
│   │   └── use-mode.ts          # state machine: mode transitions + guards
│   └── lib/
│       ├── git.ts               # shell out to git diff
│       ├── stdin.ts             # stdin detection + reading + /dev/tty reopen
│       └── output.ts            # assemble + emit JSON output
├── test/
│   ├── types.test.ts            # schema validation tests
│   ├── diff-parser.test.ts
│   ├── diff-aligner.test.ts
│   ├── line-map.test.ts
│   └── annotations.test.ts
└── docs/
    ├── cli-usage.md             # human-readable usage guide with examples
    └── cli-contract.json        # machine-readable command/flag/example spec
```

### Scripts

```json
{
  "scripts": {
    "dev": "node --loader ts-node/esm --no-warnings src/cli.ts",
    "build": "tsup src/cli.ts --format esm --target node20 --out-dir dist",
```

> ⚠️ **`build` is not cross-platform yet.** `tsup` wraps esbuild native binaries — running `npm run build` on a different OS/arch than the install platform will fail. Replace `tsup` with a pure-JS alternative (e.g. plain `tsc`) before shipping the dist build.

```json
    "build:tsc": "tsc --project tsconfig.build.json",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "tsc": "tsc --noEmit",
    "format": "prettier --write ."
  }
}
```

> ⚠️ **`build` currently uses `tsup` — do not use.** The `build:tsc` script is
> the planned replacement (see [Build Migration](#build-migration-tsup--tsc)).
> Once the migration is complete, `build:tsc` becomes `build` and `tsup` is
> removed from `devDependencies`.

### tsconfig highlights

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

> No `jsx` config — Ink/React were removed in Phase 1.7.

---

## Module Architecture

> **Note:** The original plan described an Ink/React component tree with hooks.
> After the raw ANSI pivot (Phase 1.7), the architecture is simpler: pure
> functions, a state reducer, and a direct event loop. No React, no hooks.

### Module structure

```
src/
├── cli.ts          # CLI definition (citty), arg parsing, alt screen buffer,
│                   # raw-mode stdin dispatch loop, paint cycle
├── state.ts        # BrowseState, BrowseAction, reduce() — pure reducer
├── render.ts       # buildFrame(ctx) → string — pure ANSI frame builder
├── keypress.ts     # parseKeypress(data) → Key — raw stdin parser
├── schema.ts       # Zod schemas, types, normalize/parse/output helpers
└── terminal.ts     # TTY I/O: piped stdin, /dev/tty fallback, cleanup
```

### Data flow

```
CLI args + stdin
       │
       ▼
  cli.ts (event loop owner)
  ├── file content (string[])
  ├── state: BrowseState (let + reduce())
  ├── annotationFlow: AnnotationFlowState | undefined
  │
  ├── stdin 'data' event → parseKeypress() → dispatch action → reduce()
  ├── after each reduce: buildFrame(ctx) → stderr.write(CURSOR_HOME + frame)
  │
  └── on finish: restore terminal, write JSON to stdout, exit
```

### Key contracts

**`reduce(state, action) → state`** (state.ts)
- Pure function, no side effects
- Handles: `move_cursor`, `set_mode`, `add_annotation`, `update_viewport`
- Framework-agnostic — transferred 1:1 from React `useReducer`

**`buildFrame(ctx) → string`** (render.ts)
- Pure function: context in, ANSI string out
- Composes: viewport lines, status bar, help bar, decision picker, annotation flow
- Each row starts with `CLEAR_LINE` to prevent stale content
- Pads to full terminal height

**`parseKeypress(data) → Key`** (keypress.ts)
- Parses raw stdin buffer into structured key event
- Handles: arrows, escape, enter, backspace, Ctrl+C, printable chars

---

## Scope Cuts

Explicitly **not** in v0. Tracked here for future versions.

| Feature                           | Why cut                                                   | Target      |
| --------------------------------- | --------------------------------------------------------- | ----------- |
| Edit/delete user annotations      | Additive-only simplifies state management                 | v0.1        |
| Collapsed diff regions            | Nice-to-have, not essential for validation                | v0.1        |
| File tree / multi-file            | Single-file is the validation unit                        | v0.2+       |
| Session persistence / resume      | Stateless is simpler; round-trip via JSON covers the need | v0.2+       |
| Pi extension wrapper              | Out of scope — standalone first                           | v0.1        |
| Claude Code integration           | Same — wrapper is ~50 lines when needed                   | v0.1        |
| LSP / go-to-definition            | Phase 2 feature from full product vision                  | v1+         |
| Code suggestions ("replace with") | Needs careful design                                      | v1+         |
| Blame gutter                      | Nice-to-have                                              | v0.2+       |
| Side-by-side split for raw mode   | Raw mode is single-column by design                       | Not planned |
| Edit annotations after creation   | Small but adds undo complexity                            | v0.1        |
| Custom keybinding config          | Fixed dual keymap is sufficient for now                   | v1+         |
| Annotation filtering/sorting      | Useful at scale, not needed for single-file               | v0.2+       |

---

## Incremental Delivery Plan (review-friendly)

Implementation proceeds in four phases. Each phase is a self-contained,
reviewable milestone with clear exit criteria.

1. **Phase 1 — Ink migration** ← current
   - Replace raw loop with proper Ink/React components. Delete prototype code.
   - Parity gate: Ink path reproduces all raw loop behaviors before proceeding.
2. **Phase 2 — Navigation & features**
   - Shiki highlighting, extended nav, selection, annotation display/interaction,
     search. All built in Ink — no porting.
3. **Phase 3 — Diff mode**
   - Diff ingestion, parser, side-by-side rendering, annotation anchoring.
4. **Phase 4 — Polish & ship**
   - Tests, edge cases, build swap (`tsup → tsc`), cross-platform, README.

---

## Effort Estimate

With agent assistance, working in TypeScript + Ink:

| Piece                                                                   | Effort    | Notes                                                   |
| ----------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| Project scaffolding (package.json, tsconfig, citty CLI, stdin handling) | 2-3 hours | Mostly boilerplate                                      |
| Data model + Zod schemas + input/output validation                      | 1-2 hours | Types + round-trip tests                                |
| Shiki integration (file → ANSI lines)                                   | 2-3 hours | Shiki setup, language detection, theme                  |
| Diff parser + aligner (unified diff → side-by-side display rows)        | Half day  | Core algorithm, needs solid tests                       |
| Line mapping (display row ↔ source line)                                | 2-3 hours | Critical for annotation placement in diff mode          |
| Ink app shell + Viewport component                                      | Half day  | Scrollable container, cursor, display line interleaving |
| SourceLine component (gutter + line number + code)                      | 2-3 hours | Raw + diff variants                                     |
| Dual-keybinding navigation (useKeymap + useViewport)                    | Half day  | Scroll, jump, go-to-line                                |
| Line-range selection (useSelection, both input styles)                  | 3-4 hours | Shift+arrow + v-mode                                    |
| Intent/category pickers                                                 | 2-3 hours | Simple single-keypress inline components                |
| Text input component                                                    | 2-3 hours | Inline text entry, basic editing (backspace, cursor)    |
| Annotation creation flow (mode transitions)                             | 2-3 hours | SELECT → ANNOTATE → BROWSE state machine                |
| AnnotationBlock component (collapsible, threads, actions)               | Half day  | Expand/collapse, reply display, approve/dismiss         |
| Annotation focus + reply + status actions                               | 3-4 hours | ANN_FOCUS and REPLY modes, keyboard handling            |
| Search (useSearch + SearchBar + highlighting)                           | 3-4 hours | Pattern matching, viewport scrolling to matches         |
| Pre-seeded annotation loading + distinct styling                        | 2-3 hours | Input parsing, visual differentiation                   |
| Status bar                                                              | 1-2 hours | Mode display, cursor position, annotation count         |
| JSON output assembly                                                    | 1 hour    | Trivial — serialize state                               |
| Mouse scroll support                                                    | 1-2 hours | Terminal event handling                                 |
| Git integration (--diff-ref, --staged, --unstaged)                      | 1-2 hours | Spawn git, capture output                               |
| Tests (schemas, diff parser, aligner, line map, annotations)            | Half day  | Core logic coverage                                     |
| Polish, edge cases, large file handling                                 | Half day  | Viewport perf, long lines, empty files                  |

**Total: ~5-6 days focused**

(Up from 3-4 in the previous estimate due to: diff mode back in scope, inline
annotation threads, reply/approve/dismiss, side-by-side rendering.)

---

## Migration & Integration Path

### Standalone usage

```bash
# Install globally
npm i -g quill

# Or run via npx
npx quill src/auth.ts

# Local dist run
node dist/cli.js src/auth.ts
```

### Agent integration (any agent)

The tool is a subprocess with JSON I/O. Any agent that can spawn a process and
read stdout can use it:

```bash
# Agent produces annotations, spawns viewer, reads result
echo "$ANNOTATIONS_JSON" | quill src/auth.ts --diff-ref main > result.json
```

### Pi wrapper (~50 lines)

```typescript
// Thin adapter: tui.stop() → spawn quill → tui.start() → parse JSON
const proc = spawnSync('quill', [file, ...flags], {
  input: JSON.stringify({ annotations }),
  stdio: ['pipe', 'pipe', 'inherit'],
});
```

### Claude Code / other agents

Same subprocess pattern. The tool doesn't know or care about the caller.

### Round-trip workflow

```
Agent reviews code → produces annotations JSON
  → spawns quill with annotations on stdin
  → user reviews, replies, approves/dismisses, adds own annotations
  → user finishes with decision (`approve` or `deny`) → JSON output
  → agent receives output and branches:
      - `deny`: apply changes and reopen the same file at latest content,
        passing previous annotations and optionally `--focus-annotation <id>`
      - `approve`: persist/forward accumulated output and continue to next file
  → ... loop until done
```

The round-trip guarantee (output is valid input) makes this loop seamless.

---

## Relationship to Full Product

This is a validation step for the full feedback viewer described in
`quill-design-notes.md`. If the workflow proves valuable:

- The annotation JSON schema evolves into the "feedback format" / "feedback
  protocol"
- Diff mode gains collapsed regions, inline expand, blame gutter
- File tree, quick-open, session persistence get added incrementally
- Review semantics (approve/deny at file level, review progress) layer on top
- Adapters (GitLab comment sync, GitHub PR integration, agent feedback
  optimization) connect
- Possible separate repo (likely — this is already scoped as standalone)
- Possible rewrite to Go/Rust if performance or distribution demands it

If the workflow doesn't prove valuable, you've spent a week, not months.
