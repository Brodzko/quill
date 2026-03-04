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

## Scenarios (24)

### Raw mode basics (1–5)
Basic file viewing, cursor nav, horizontal scroll, tiny/empty files.

### Annotations from file (6–10)
Loading annotations via `--annotations` file or stdin pipe, edge cases
(first line, multi-annotation, string coercion), focus annotation startup.

### Annotation CRUD (11–15)
Create (select → annotate), reply, edit, delete with confirm, approve/deny output.

### Search (16)
Live search, match highlighting, n/N cycling.

### Diff mode (17–21)
Side-by-side against git refs, horizontal scroll in diff, annotations in diff,
toggle raw↔diff, no-changes fallback.

### Resize / edge cases (22–24)
Terminal resize, narrow terminal, go-to-line.

## Fixtures

| File | Purpose |
|---|---|
| `fixtures/sample.ts` | Main test file — 100 lines, types, functions, long line, config object |
| `fixtures/tiny.ts` | 1-line file — boundary testing |
| `fixtures/empty.ts` | Empty file — edge case |
| `fixtures/annotations-basic.json` | 4 annotations with replies — standard test set |
| `fixtures/annotations-edge.json` | Edge cases: first line, multi on same line, string coercion |
| `fixtures/annotations-empty.json` | Empty annotations array |

## Notes

- Diff scenarios (17–21) require the file to have git history. They use `src/*.ts`
  from the actual repo instead of fixtures.
- Each scenario shows a checklist of things to verify. After exiting Quill,
  you're prompted for pass/fail/skip.
- `Ctrl+C` aborts the running Quill session (exit code 1, no output).
- Approve (`Shift+A → a`) or deny (`Shift+A → d`) to get JSON output on stdout.
