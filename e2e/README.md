# Quill E2E Test Suite

Manual, interactive end-to-end tests for exercising the full Quill UI.

## Quick start

```bash
npm run build            # required — runs against dist/cli.js
./e2e/run.sh             # interactive picker
./e2e/run.sh list        # show all scenarios with commands + checklists
./e2e/run.sh 6           # run scenario 6 directly
./e2e/run.sh build       # build first, then pick
```

## Scenarios (29)

### Raw mode basics (1–5)
Basic file viewing, cursor nav, horizontal scroll, tiny/empty files.

### Annotations from file (6–10)
Loading annotations via `--annotations` file or stdin pipe, edge cases
(first line, multi-annotation, string coercion), focus annotation startup.

### Annotation CRUD (11–15)
Create (select → annotate), reply, edit, delete with confirm, approve/deny output.
Per-annotation [s] cycles status: none → approved → dismissed → none.

### Search (16)
Live search, match highlighting, n/N cycling.

### Diff mode (17–21)
Side-by-side against git refs, horizontal scroll in diff, annotations in diff,
toggle raw↔diff, no-changes fallback.

### File-level & annotation status (22–23)
File-level comments (startLine: 0) with 📄 marker, per-annotation approve/dismiss toggling.

### Resize / edge cases (24–27)
Terminal resize, narrow terminal, go-to-line, scroll-into-view for last-line annotations.

### Diff noise suppression (28–29)
Whitespace-only and offset-only changes rendered as context (no diff coloring).

## Fixtures

| File | Purpose |
|---|---|
| `fixtures/sample.ts` | Main test file — 100 lines, types, functions, long line, config object |
| `fixtures/tiny.ts` | 1-line file — boundary testing |
| `fixtures/empty.ts` | Empty file — edge case |
| `fixtures/annotations-basic.json` | 4 annotations with replies — standard test set |
| `fixtures/annotations-edge.json` | Edge cases: first line, multi on same line, string coercion |
| `fixtures/annotations-empty.json` | Empty annotations array |
| `fixtures/annotations-file-level.json` | File-level (startLine: 0) + line-anchored annotations |
| `fixtures/annotations-approve-dismiss.json` | Annotations with/without pre-set status for y/n toggle testing |
| `fixtures/long-tail.ts` | 60-line file — tests annotation scroll-into-view at EOF |
| `fixtures/annotations-long-tail.json` | Large annotation on last lines with replies — box height exceeds viewport |
| `fixtures/diff-whitespace-base.ts` | Base file for whitespace/offset suppression testing |
| `fixtures/diff-whitespace-modified.ts` | Modified file: re-indented block, added import (offset), real change mixed in |

## Notes

- Diff scenarios (17–21, 28–29) use a temporary git repo created by `setup-diff-repo.sh`.
- Each scenario shows a checklist of things to verify. After exiting Quill,
  you're prompted for pass/fail/skip.
- `Ctrl+C` aborts the running Quill session (exit code 1, no output).
- Approve (`Shift+A → a`) or deny (`Shift+A → d`) to get JSON output on stdout.
- File-level comments use `startLine: 0, endLine: 0` in JSON — displayed on line 1 with 📄 marker.
- Per-annotation `[s]` cycles status: none → 👍 approved → 👎 dismissed → none.
