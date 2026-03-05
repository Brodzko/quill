# Plan: `quill-gitlab` Converter (Separate Project)

## Goal

Bidirectional, deterministic conversion between GitLab MR thread data and quill
annotation envelopes. Standalone CLI tool, usable from pi tools, CI, or scripts.

## Why separate project

- Quill is JSON-in/JSON-out — doesn't know about GitLab.
- Converter consumes quill's schema as a stable external contract.
- May be used from CI or other tools, not just pi.
- Different release cadence — GitLab API changes shouldn't require quill releases.

## CLI interface

```bash
# GitLab threads → quill input envelope
quill-gitlab to-quill \
  --input threads.json \
  --file src/app.ts \
  --diff-ref main

# Quill output envelope → GitLab comment payloads
quill-gitlab to-gitlab \
  --input envelope.json \
  --mr 123

# Pipe-friendly
gl mr threads --mr 123 --file src/app.ts | quill-gitlab to-quill --file src/app.ts
cat envelope.json | quill-gitlab to-gitlab --mr 123
```

## Conversion mapping

### GitLab → Quill (`to-quill`)

| GitLab field | Quill field | Notes |
|---|---|---|
| Discussion ID | `annotation.id` | Stable round-trip key |
| First note body | `annotation.comment` | |
| First note author username | `annotation.source` | |
| `position.new_line` | `annotation.startLine` | For new-file-side comments |
| `position.old_line` | Needs diff context | For old-file-side comments in diff mode |
| Line range (if multi-line) | `annotation.startLine` / `endLine` | |
| Subsequent notes | `annotation.replies[]` | |
| Note ID | `reply.id` | |
| Note author username | `reply.source` | |
| Note `created_at` | `reply.metadata.createdAt` | |
| Thread resolved state | `annotation.metadata.resolved` | |
| Thread web URL | `annotation.metadata.permalink` | |
| Author display name | `annotation.metadata.author` / `reply.metadata.author` | |

### Quill → GitLab (`to-gitlab`)

| Quill field | GitLab action | Notes |
|---|---|---|
| New annotation (no matching thread ID) | Create new discussion | |
| New reply on existing annotation | Create note on discussion | Match by `annotation.id` → discussion ID |
| `annotation.status = 'approved'` | Resolve thread | |
| `annotation.status = 'dismissed'` | Resolve thread | |
| Changed annotation comment | Do not edit original note | GitLab comments are immutable in practice |
| Deleted annotation | No action | Don't delete GitLab threads |
| `decision = 'approve'` | MR approval | Separate action via gl tool |

### Output format (`to-gitlab`)

Emits an array of action payloads, not raw API calls. The pi tool or skill
decides whether to execute them.

```json
{
  "actions": [
    {
      "type": "create_discussion",
      "file": "src/app.ts",
      "line": 42,
      "body": "This needs error handling",
      "diffRef": "abc123"
    },
    {
      "type": "create_note",
      "discussionId": "abc-def-123",
      "body": "Agreed, will fix"
    },
    {
      "type": "resolve_thread",
      "discussionId": "abc-def-456"
    }
  ]
}
```

With `--post` flag, execute actions directly via GitLab API. Without it, just
emit the payload for the caller to handle.

## Diff position math

This is the hardest part. GitLab stores comment positions as line numbers
relative to the diff, with `old_line` (left side) and `new_line` (right side).

**For quill diff mode** (`--diff-ref`): Map directly — quill's diff view shows
the same old/new lines. The converter emits `startLine`/`endLine` corresponding
to the new-file side, with `metadata.oldLine` for old-side positioning if needed.

**For quill raw mode** (no diff): Only `new_line` is meaningful — it maps to the
current file's line numbers. Comments on deleted lines (only `old_line`) can't
be shown in raw mode. The converter should either:
- Skip them with a warning, or
- Attach them to the nearest surviving line with a note in metadata

**Recommendation**: When quill opens in diff mode (which it should for MR review),
the mapping is straightforward. Enforce diff mode in the `quill-mr` skill.

## Dependencies & schema management

The converter needs quill's annotation types. Options:

1. **Pinned copy** of Zod schemas in the converter project. Simple, no
   cross-project dependency. Risk of drift.
2. **Shared npm package** (`@quill/schema`). Proper but premature.
3. **JSON Schema export** from quill that the converter validates against.

**Recommendation**: Start with option 1 (pinned copy). The schema is small and
stable. If both projects mature and the schema changes frequently, extract to a
shared package.

## Build plan

### Phase 1: Core conversion

1. Define TypeScript types for GitLab thread/note shapes (from API docs)
2. Define quill annotation types (pinned from quill's schema)
3. Implement `toQuill(threads, options) → InputEnvelope`
4. Implement `toGitlab(envelope, options) → ActionPayload[]`
5. Unit tests against fixture data (real MR thread JSON snapshots)

### Phase 2: CLI wrapper

1. CLI with `to-quill` and `to-gitlab` subcommands
2. Stdin/file input, stdout output
3. Validation and error reporting

### Phase 3: Diff position handling

1. Implement line mapping for diff-mode (straightforward)
2. Implement line mapping for raw-mode (with skip/nearest-line strategy)
3. Tests against real diff fixtures

### Phase 4: Direct posting (optional)

1. `--post` flag that executes actions via GitLab API
2. Requires GitLab token configuration
3. May not be needed if the pi `gl` tool handles posting

## Project structure

```
quill-gitlab/
  src/
    types/
      gitlab.ts          # GitLab API thread/note types
      quill.ts           # Pinned quill annotation types
    to-quill.ts          # GitLab → quill conversion
    to-gitlab.ts         # Quill → GitLab conversion
    diff-position.ts     # Line mapping utilities
    cli.ts               # CLI entry point
  fixtures/              # Real MR thread JSON for testing
  tests/
```

## Open questions

- Should the converter handle pagination of GitLab threads, or expect the
  caller (pi `gl` tool) to provide all threads pre-fetched?
  **Leaning toward**: Caller provides, converter is pure transformation.

- Should `to-gitlab` output include the MR approval action, or is that
  always handled separately by the skill?
  **Leaning toward**: Separate — approval is a high-stakes action that
  should go through the skill's confirmation flow.

- How to handle inline code suggestions (GitLab's ` ```suggestion` blocks)?
  Could map to a `suggestion` intent in quill with the proposed code in
  metadata. Defer to when quill supports rendering suggestions.
