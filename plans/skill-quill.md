---
name: quill
description: Terminal file reviewer with structured annotations. Use when you need the user to review a file, give feedback on code, or when interpreting annotation output from a quill session. Prerequisite for quill-review and quill-mr skills.
---

# Quill

Quill is a terminal file reviewer — JSON in, JSON out. It opens a file in a
read-only syntax-highlighted viewer where the user creates, edits, and responds
to line-level annotations. Use it whenever you need structured human feedback on
code.

**You do not call quill directly.** Use the `quill_review` tool, which handles
invocation, stdin piping, and output parsing.

## When to use quill

- You wrote or modified code and want the user to review it
- You want to present a file with your observations (uncertainty, questions, suggestions)
- A workflow skill (quill-review, quill-mr) instructs you to open a file for review
- The user asks to review, annotate, or discuss a file

## Tool: `quill_review`

```
quill_review(
  file,                    # path to the file to review (required)
  annotations?,            # array of annotation objects to pre-load
  diffRef?,                # diff against a git ref (branch, tag, SHA)
  staged?,                 # diff staged changes
  unstaged?,               # diff unstaged changes
  line?,                   # start cursor at this line (1-indexed)
  focusAnnotation?,        # start focused on annotation by id
)
→ OutputEnvelope | null    # null on abort (user pressed Ctrl+C)
```

The tool blocks until the user finishes (approve/deny) or aborts.

## Input: annotations you provide

When opening quill, you can pre-load annotations. Each annotation targets a
line range and carries an intent, optional category, and comment.

```json
{
  "annotations": [
    {
      "id": "optional-stable-id",
      "startLine": 10,
      "endLine": 12,
      "intent": "question",
      "comment": "Is this error handling intentional? The catch swallows the original error.",
      "source": "agent"
    },
    {
      "startLine": 25,
      "endLine": 25,
      "intent": "suggestion",
      "comment": "Consider using R.map instead of the manual loop here.",
      "source": "agent",
      "category": "style"
    }
  ]
}
```

### Annotation fields

| Field | Required | Description |
|---|---|---|
| `id` | No | Stable identifier. Auto-generated UUID if omitted. Provide it when you need round-trip tracking (e.g., to match replies back to your original annotations). |
| `startLine` | Yes | First line of the annotated range (1-indexed). |
| `endLine` | Yes | Last line of the annotated range (>= startLine). |
| `intent` | Yes | What kind of annotation this is (see below). |
| `category` | No | Classification of the concern (see below). |
| `comment` | Yes | The annotation text. Be specific and reference the code. |
| `source` | No | Who created it. Defaults to `"agent"`. Use your identity. |
| `status` | No | `"approved"` or `"dismissed"`. Set on annotations the user has already resolved. |
| `replies` | No | Array of `{ comment, source }` objects. Use for ongoing conversations. |
| `metadata` | No | Pass-through object. Quill preserves but does not interpret it. Use for integration-specific data (GitLab thread IDs, permalinks, timestamps). |

### Intents

| Intent | Use when... |
|---|---|
| `instruct` | You are telling the user to do something (rare — usually the user instructs you) |
| `question` | You are asking the user a question about the code |
| `comment` | You are making an observation or noting something |
| `praise` | You are highlighting something well done |
| `suggestion` | You are proposing a concrete change |
| `uncertainty` | You are flagging code you're unsure about and want human review |

### Categories

Categories optionally classify the concern: `bug`, `security`, `performance`,
`design`, `style`, `nitpick`. Use when the distinction is meaningful for the
user's prioritization. Omit when it's obvious or not useful.

## Output: what comes back

When the user finishes, you receive an output envelope:

```json
{
  "file": "src/app.ts",
  "mode": "raw",
  "decision": "approve",
  "annotations": [
    {
      "id": "your-original-id",
      "startLine": 10,
      "endLine": 12,
      "intent": "question",
      "comment": "Is this error handling intentional?",
      "source": "agent",
      "replies": [
        { "comment": "Yes, we suppress errors here intentionally because ...", "source": "user" }
      ]
    },
    {
      "id": "user-created-uuid",
      "startLine": 35,
      "endLine": 38,
      "intent": "instruct",
      "category": "bug",
      "comment": "This will crash if the array is empty. Add a guard.",
      "source": "user"
    }
  ]
}
```

### Interpreting the output

**`decision`**: `"approve"` means the user is satisfied (possibly with caveats
in annotations). `"deny"` means the user wants changes before proceeding.

**Annotations from the user** (`source: "user"`): These are the user's feedback.
Process them based on intent:

| User intent | Your action |
|---|---|
| `instruct` | Execute as a code change. This is a direct request. |
| `question` | Answer it. Include the relevant code context (the annotated line range) in your response so the user doesn't have to look it up. |
| `comment` | Acknowledge and incorporate as context. No action required unless it implies a change. |
| `praise` | Acknowledge briefly. |

**Replies on your annotations**: The user responded to something you asked or
flagged. Read the reply in context of your original annotation.

**Annotations with `status`**: `"approved"` means the user accepted your
observation. `"dismissed"` means they explicitly set it aside.

### Null output (abort)

If the tool returns null, the user aborted (Ctrl+C). Do not assume any feedback
was given. Ask the user what they'd like to do.

## Round-trip conversations

When you need to continue the conversation after processing an envelope:

1. Prepare updated annotations — your replies to the user's questions, new
   annotations based on changes you made, resolved items with `status`.
2. Re-open the same file with the updated annotation set.
3. Provide stable `id` values so the user sees continuity, not duplicates.

**Rules for re-opening**:
- Batch all your responses into one re-open. Never re-open per-annotation.
- Only re-open if there are unresolved questions or the user denied.
- If the user approved with no `instruct` annotations, the review is done. Move on.
- After making code changes from `instruct` annotations, consider re-opening
  with the updated file so the user can verify (especially after a deny).

## Diff mode

When reviewing changes against a baseline, use `diffRef`:

```
quill_review(file: "src/app.ts", diffRef: "main")
quill_review(file: "src/app.ts", staged: true)
```

Quill shows a side-by-side diff view. Annotations attach to the new-file-side
line numbers. Use diff mode when reviewing:
- Code you just wrote (diff against the branch point)
- Staged changes before commit
- MR changes (diff against target branch)

## Writing good annotations

- **Be specific.** Reference the actual code, not just the line numbers.
- **One concern per annotation.** Don't bundle unrelated observations.
- **Use the right intent.** `question` when you genuinely need input,
  `uncertainty` when you want eyes on something, `suggestion` when you have
  a concrete alternative.
- **Keep comments concise.** The user sees them inline next to code — walls
  of text are hard to read in that context.
- **Annotate ranges, not just single lines.** If the concern spans a block,
  use `startLine`/`endLine` to highlight the full range.
