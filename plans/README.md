# Quill Plans

Future work plans. Not implementation-ready specs — these are brainstorm
artifacts to be refined before execution.

## Pi Integration (umbrella)

Quill integrates into pi via reference skill + workflow skills + custom tool.

| Plan | Status | Summary |
|---|---|---|
| [Configurable intents/categories](./configurable-intents-categories.md) | Draft | CLI flags to filter available intents/categories per session |
| [Schema expansion](./schema-expansion.md) | Draft | Metadata bag, reply IDs, envelope-level comments |
| [Pi integration architecture](./pi-integration-architecture.md) | Draft | Skills, tool, and `/quill` command design |
| [quill-gitlab converter](./quill-gitlab-converter.md) | Draft | Separate project for MR thread ↔ annotation conversion |
| [Session persistence](./session-persistence.md) | Draft | Temp directory for multi-file review flows |

## Diff rendering

| Plan | Status | Summary |
|---|---|---|
| [Diff rendering improvements](./diff-rendering-improvements.md) | Draft | Ignore whitespace-only changes + ignore line-number-only (moved code) changes |

## Build order

1. **Schema expansion** — metadata bag + reply IDs (unblocks converter design)
2. **Configurable intents/categories** — CLI flags (unblocks skill-specific intent sets)
3. **Pi tool + quill reference skill** (unblocks all workflows)
4. **quill-review skill** (simplest workflow, proves the loop)
5. **quill-gitlab converter** (separate project)
6. **quill-mr skill** (full MR review flow)
7. **Session persistence** (needed by quill-mr, can be built alongside)
