# Diff Rendering Improvements

Status: **Draft**

Two independent improvements to bring diff rendering closer to GitLab's
renderer. Both reduce visual noise by suppressing false-positive "changes"
that aren't meaningful code modifications.

## 1. Ignore whitespace-only changes

**Problem**: Lines where only whitespace changed (indentation adjustments,
trailing space removal) show up as modified with full add/remove highlighting.
This obscures real code changes in indentation-heavy refactors.

**Desired behavior**: Whitespace-only changes should be rendered as context
lines (no add/remove coloring), matching GitLab's "Hide whitespace changes"
default.

**Approach options**:
- Pre-filter at the diff level: compare lines with whitespace stripped, demote
  to context if equal.
- Post-filter in `diff-align.ts`: reclassify `modified`/`added`/`removed` rows
  where trimmed content matches.
- CLI flag `--ignore-whitespace` (like `git diff -w`) to generate the diff
  without whitespace changes in the first place.

**Open questions**:
- Always on, or togglable at runtime (like GitLab's checkbox)?
- Should this also apply to the unified diff input, or only the visual
  rendering?

## 2. Ignore line-number-only changes (moved code)

**Problem**: When a block of code is moved (e.g., function reordered) or when
lines above are added/removed, unchanged code appears as removed + re-added at
a different line number. The diff shows it as a full change even though the
actual code content is identical.

**Desired behavior**: Detect when a "removed" line's content appears verbatim
in a nearby "added" line (or vice versa) and render those as moved/context
rather than changed. GitLab shows these with a muted "moved" indicator.

**Approach options**:
- Content-hash matching: hash removed lines, check if any added line has the
  same hash. Pair them up and render as "moved" rows.
- Patience diff or histogram diff (`git diff --diff-algorithm=histogram`) may
  already handle this better at the git level.
- Post-process in `diff-align.ts`: detect sequences of removed+added rows with
  identical content and reclassify.

**Open questions**:
- How large a context window to search for matches? Adjacent hunks only, or
  entire file?
- Should moved blocks get their own visual treatment (e.g., dimmed background +
  "↕ moved" label)?
- Interaction with annotation anchoring — if a line is "moved", do annotations
  follow it?

## 3. Expand collapsed diff chunks / show full file in diff mode

**Problem**: Diff mode only shows hunked lines — the context lines that git (or
GitLab) included around each change. Code between hunks is completely hidden
behind hunk-header separator rows (`@@ ... @@`). When quill is invoked with a
diff from GitLab (rather than from local git), the context window may be very
small, making it impossible to see surrounding code without toggling to raw mode
and losing the side-by-side view.

**Desired behavior**: Allow expanding collapsed regions between hunks
inline, so the user can see the full file without leaving diff mode.

**Approach options**:
- **Expand on demand**: Make hunk-header rows interactive — pressing Enter (or a
  dedicated key like `e`) on a hunk header expands N lines of context above/below
  (or the full gap). Would need to splice context rows into `DiffData.rows` and
  rebuild the index maps.
- **Always show full file**: A toggle (e.g., `f` for "full") that fills in all
  gaps between hunks with context rows sourced from the new-file content. Simpler
  UX but noisier.
- **Configurable context**: CLI flag `--context <N>` passed through to
  `git diff -U<N>` to request more context at diff generation time. Doesn't help
  when the diff comes from GitLab/stdin.
- **Hybrid**: Start collapsed, allow per-gap expansion, plus a "show all" toggle.

**Open questions**:
- Should expanded context lines get a distinct background (e.g., very faint) to
  distinguish them from the original diff context?
- How does this interact with `DiffData` immutability? Expanding chunks means
  mutating or rebuilding `rows`/`rowToNewLine`/`newLineToRowIndex`/`visibleNewLines`.
  Might need `DiffData` to become mutable or replaced wholesale.
- Do annotations on expanded (non-diff) lines make sense? Probably yes — they're
  real file lines.

## Implementation notes

- Both features are independent and can be shipped separately.
- Whitespace ignore is simpler and higher-value — ship first.
- Both primarily affect `diff-align.ts` (row classification) and `render.ts`
  (background colors). The state/dispatch layer shouldn't need changes.
- Consider adding a `diffOptions` field to `SessionState` or CLI flags to
  control these at runtime.
