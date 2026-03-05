# Plan: Schema Expansion — Metadata Bag & Reply IDs

## Goal

Extend quill's annotation and reply schemas to support round-trip integrations
(GitLab, future systems) without polluting the core schema with
integration-specific fields.

## Design

### Metadata bag on annotations and replies

A pass-through `metadata` field that quill preserves but does not interpret.
Consumers (converters, skills) own the contents.

```typescript
type Annotation = {
  id: string;
  startLine: number;
  endLine: number;
  intent: string;
  category?: string;
  comment: string;
  source: string;
  status?: 'approved' | 'dismissed';
  replies?: Reply[];
  metadata?: Record<string, unknown>;  // NEW — pass-through
};

type Reply = {
  id?: string;                          // NEW — stable identity for round-trips
  comment: string;
  source: string;
  metadata?: Record<string, unknown>;   // NEW — pass-through
};
```

### Why `metadata` instead of standalone fields

- Quill doesn't need to know about `threadId`, `permalink`, `resolved`,
  `createdAt`, `author` display names — those are consumer concerns.
- Standalone fields pollute the core schema with integration-specific concepts.
- The bag is explicitly "not my problem, I'll preserve it."
- Converters and skills know what they put in and what to read out.

### Why `id` on Reply is first-class

Unlike metadata fields, reply `id` is useful to quill itself:
- Editing/deleting specific replies
- Round-trip stability (don't duplicate replies on re-open)
- Future: threading within annotations

### What goes where

| Field | Location | Rationale |
|---|---|---|
| `reply.id` | First-class | Quill may use it for editing/deletion |
| `annotation.id` | First-class (exists) | Doubles as thread ID for GitLab round-trips |
| `resolved` | `metadata.resolved` | Quill doesn't render resolved state yet |
| `permalink` | `metadata.permalink` | Display concern for external tools |
| `createdAt` | `metadata.createdAt` | Ordering/display concern for converters |
| `author` (display name) | `metadata.author` | `source` carries the identity, `author` is display-only |
| `gitlabNoteId` | `reply.metadata.gitlabNoteId` | GitLab-specific sync key |

### Promotion path

If quill gains UI for resolved state (strikethrough, dimming), promote
`resolved` from metadata to first-class. Same for any field that quill's
renderer needs to understand.

## Implementation

### Step 1: Schema changes

In `schema.ts`:
- Add `metadata: z.record(z.unknown()).optional()` to both `annotationInputSchema`
  and `annotationSchema`.
- Add `id: z.string().trim().min(1).optional()` to `replyInputSchema`.
- Add `id: z.string().min(1).optional()` to `replySchema`.
- Add `metadata: z.record(z.unknown()).optional()` to both reply schemas.
- Use `.passthrough()` on annotation schemas (already present on input) to
  future-proof.

### Step 2: Normalization preserves metadata

In `normalizeCandidate`, carry `metadata` through if present. Same for replies.
Do NOT strip unknown fields — the whole point is pass-through.

### Step 3: Output preserves metadata

The output envelope emits metadata as-is. No transformation, no validation of
contents.

### Step 4: Reply ID generation

When a user creates a reply in quill, generate a UUID for `id` (same pattern as
annotation IDs). Incoming replies without `id` keep `undefined` (don't force-generate
— the source system may assign IDs on its own timeline).

## Files touched

| File | Change |
|---|---|
| `schema.ts` | Schema additions, normalization updates |
| `schema.test.ts` | Round-trip tests for metadata preservation |
| `state.ts` | Ensure reply creation generates IDs |
| `dispatch.ts` | Reply actions carry ID |

## Envelope-level comment

Separate small addition: optional `comment` field on the output envelope for
document-level annotations (alternative to GitLab MR global comments).

```typescript
type OutputEnvelope = {
  file: string;
  mode: 'raw' | 'diff';
  decision: 'approve' | 'deny';
  comment?: string;            // NEW — document-level annotation
  diffRef?: string;
  annotations: Annotation[];
};
```

This requires a UI affordance — probably prompted at quit time alongside the
approve/deny picker. Could be optional (press `c` to add comment before
confirming decision, or just confirm without one). Defer the UI piece to its
own plan; the schema addition is trivial.
