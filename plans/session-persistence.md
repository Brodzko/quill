# Plan: Session Persistence (Temp Directory)

## Goal

Enable multi-file review flows (especially MR reviews) by persisting quill
output envelopes across multiple invocations within a logical session.

## Design principle

**Not baked into quill.** Quill stays stateless — JSON in, JSON out. Session
management belongs in the pi tool layer.

## Session structure

```
$TMPDIR/quill-sessions/
  <session-id>/
    manifest.json
    src--app.ts.json
    src--utils--helpers.ts.json
```

### Session ID format

- MR reviews: `mr-{mr-id}-{timestamp}` (e.g., `mr-123-1709654400`)
- Code reviews: `review-{timestamp}` (e.g., `review-1709654400`)
- Arbitrary: `session-{uuid}`

### Manifest

```json
{
  "id": "mr-123-1709654400",
  "type": "mr-review",
  "createdAt": "2025-03-05T12:00:00Z",
  "files": [
    {
      "path": "src/app.ts",
      "envelopeFile": "src--app.ts.json",
      "reviewedAt": "2025-03-05T12:05:00Z"
    }
  ],
  "status": "in-progress",
  "metadata": {
    "mrId": 123,
    "diffRef": "abc123"
  }
}
```

### File naming

File paths are flattened: `/` → `--`, preserving enough structure to be
readable. The manifest maps original paths to envelope filenames.

## Lifecycle

### Creation

The pi tool creates a session directory when:
- A workflow skill starts a multi-file review
- The tool receives a `--session` flag with a new session ID

### Accumulation

Each `quill_review` invocation with a `--session` flag:
1. Saves the output envelope to `<session-dir>/<flattened-path>.json`
2. Updates `manifest.json` with the file entry and timestamp

### Reading

The skill reads accumulated envelopes by:
1. Listing files in the session directory
2. Parsing each envelope
3. Aggregating for synthesis (final MR comments, summary, etc.)

### Cleanup

- The tool cleans up sessions older than 7 days on startup (lazy GC)
- A skill explicitly closes a session when the workflow completes
  (sets `status: "completed"` in manifest)
- Manual cleanup: `rm -rf $TMPDIR/quill-sessions/<session-id>`

## Integration with pi tool

The `quill_review` tool accepts an optional `session` parameter:

```
quill_review(file: "src/app.ts", session: "mr-123-1709654400", ...)
```

When `session` is provided:
- Create session dir if it doesn't exist
- After quill exits, save envelope to session dir
- Return envelope to agent (same as without session)

When `session` is omitted:
- No persistence, envelope returned only in-memory

## What this does NOT cover

- Cross-pi-session persistence (if you close pi and reopen, the temp files
  survive but the agent has no memory of the session ID). This would require
  the skill to store the session ID in conversation context or a known location.
- Concurrent sessions (two pi instances reviewing different MRs). Should work
  naturally since session IDs are unique, but not explicitly designed for.
- Session resume after interruption. The manifest has enough info to resume,
  but no skill logic is defined for this yet.

## Future considerations

- If temp dir proves too ephemeral, consider `~/.quill/sessions/` for
  longer-lived persistence. But start simple.
- Session export: dump all envelopes as a single JSON for archival or
  sharing. Useful for "here's my full review" workflows.
