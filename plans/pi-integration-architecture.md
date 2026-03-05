# Plan: Pi Integration Architecture

## Overview

Quill integrates into pi coding agent via three layers:

1. **Reference skill** (`quill`) — teaches the agent quill's contract
2. **Workflow skills** (`quill-review`, `quill-mr`) — define protocols for
   specific use-cases
3. **Pi tool** (`quill_review`) — mechanical invocation, blocks on human

Skills reference the quill skill by reading its file (pi doesn't have formal
skill-to-skill references, but a skill can instruct the agent to read another
skill's file as a prerequisite).

## Skill: `quill` (reference)

**Location**: `~/.pi/agent/skills/quill/SKILL.md`

**Trigger**: Agent needs to understand quill's input/output contract. Referenced
by other skills as prerequisite.

**Contents**:
- What quill is (terminal file reviewer, JSON in/out)
- Tool invocation: `quill_review(file, annotations?, intents?, categories?, diffRef?)`
- Input envelope schema
- Output envelope schema
- How to interpret decisions, statuses, metadata
- Known intents and their semantics from the agent's perspective
- How to construct reply annotations for re-opening

**Does NOT contain**: Workflow logic, when to open quill, what to do with output.

## Skill: `quill-review` (human reviews agent's code)

**Location**: `~/.pi/agent/skills/quill-review/SKILL.md`

**Trigger**: Human asks to review code the agent wrote, human wants to give
feedback on a file, human wants to explore/annotate code.

**Protocol**:

```
1. Agent identifies file(s) to review
2. Agent optionally prepares annotations:
   - Uncertainty markers on low-confidence code
   - Suggestions it wants feedback on
   - Questions for the human
3. Agent invokes quill_review with annotations + relevant intents
   (typically: instruct, question, comment, praise for human → agent)
4. Human reviews, annotates, closes with approve/deny
5. Agent processes output envelope:
   - instruct → execute as code edits
   - question → answer in chat with quoted code context
   - comment → acknowledge, store as context
   - praise → acknowledge
   - If agent has follow-up questions → re-open with reply annotations
   - If all clear → proceed with edits
6. After edits, optionally re-open for verification (if human denied)
```

**Key rules**:
- Never re-open one-by-one per annotation. Batch all responses.
- When answering questions in chat, include the highlighted code range as
  context so the human doesn't have to look it up.
- If the human approved with no instruct annotations, the code is accepted.

## Skill: `quill-mr` (GitLab MR review)

**Location**: `~/.pi/agent/skills/quill-mr/SKILL.md`

**Trigger**: "Review MR", "look at MR !123", "let's review someone's MR"

**Prerequisites**: Reads `quill` skill + `gitlab` skill.

**Protocol**:

```
1. Fetch MR data via gl tool (files changed, threads, metadata)
2. Convert MR threads → quill annotations via quill-gitlab converter
3. Determine file review order (agent decides — most commented first,
   or by change size, or human preference)
4. For each file:
   a. Invoke quill_review with converted annotations + diff-ref
   b. Save output envelope to session temp dir
5. After all files (or human says "done"):
   a. Aggregate all envelopes
   b. Convert annotations back → GitLab comment payloads via converter
   c. Present summary to human for confirmation
   d. Post to GitLab via gl tool
```

**Session persistence**: Uses temp directory managed by the tool layer.

**Intent configuration**: For MR review, relevant intents are
`instruct, question, comment, praise` with full category set.

## Pi Tool: `quill_review`

**Type**: Custom pi tool (likely a bash tool or custom extension)

**Interface**:

```
quill_review(
  file: string,
  annotations?: Annotation[],      // pre-loaded annotations
  intents?: string[],               // filter available intents
  categories?: string[],            // filter available categories
  diffRef?: string,                 // diff mode
  staged?: boolean,                 // diff staged
  line?: number,                    // start cursor position
  focusAnnotation?: string,         // start focused on annotation
  session?: string,                 // session ID for persistence
)
→ OutputEnvelope | null             // null on abort (exit code 1)
```

**Behavior**:
1. Constructs quill CLI invocation from params
2. Pipes annotations as input JSON
3. Spawns quill, blocks until exit
4. Parses stdout as OutputEnvelope
5. If `session` is provided, saves envelope to session temp dir
6. Returns envelope to agent

**Session management**:

```
$TMPDIR/quill-sessions/
  <session-id>/
    manifest.json       # { id, type, createdAt, files: [...], status }
    src--app.ts.json    # envelope per file (slashes → dashes)
```

- Session ID format: `mr-{id}-{timestamp}` or `review-{timestamp}`
- Tool creates session dir on first invocation with a session ID
- Tool cleans up sessions older than 7 days on startup
- Skills read accumulated envelopes via the session ID

## Human-initiated flow: `/quill` command

For the human → agent direction (human wants to open quill without agent
initiating), pi needs a command or keybinding:

```
/quill src/app.ts
/quill src/app.ts --diff-ref main
```

**Behavior**:
1. Opens quill with no pre-loaded annotations (or with session state if resuming)
2. Human annotates, closes
3. Output envelope is injected into the conversation as a message
4. The active skill (or default behavior) processes it

This requires a pi extension or command registration. The agent sees the
envelope in its context and responds according to whichever skill is active.

## Skill interaction pattern

```
┌─────────────────────────────────────────────────────┐
│  quill-mr skill                                     │
│  (workflow: fetch MR → review files → post comments)│
│                                                     │
│  reads: quill skill (contract)                      │
│  reads: gitlab skill (gl tool usage)                │
│  uses:  quill_review tool (invokes quill)           │
│  uses:  quill-gitlab converter (transforms data)    │
│  uses:  gl tool (fetches/posts MR data)             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  quill-review skill                                 │
│  (workflow: agent ↔ human code review loop)         │
│                                                     │
│  reads: quill skill (contract)                      │
│  uses:  quill_review tool (invokes quill)           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  quill skill (reference only)                       │
│  (what quill is, schemas, interpretation rules)     │
│                                                     │
│  no tool usage — pure documentation                 │
└─────────────────────────────────────────────────────┘
```
