# Quill

Terminal file reviewer with structured annotations — JSON in, JSON out.

Quill opens a file in a syntax-highlighted, read-only viewer and lets you create, edit, and manage line-level annotations. It accepts annotations as JSON input (stdin or file) and emits a JSON envelope on stdout when you finish — making it composable with AI agents, code review pipelines, and CLI tooling.

## Install

```bash
npm install -g quill     # global
npx quill <file>         # one-shot
```

## Quick Start

```bash
# View a file
quill src/app.ts

# View with pre-loaded annotations (pipe JSON to stdin)
echo '{"annotations":[{"startLine":10,"endLine":12,"intent":"comment","comment":"Extract this"}]}' \
  | quill src/app.ts

# Load annotations from a file
quill src/app.ts --annotations review.json

# Diff against a git ref
quill src/app.ts --diff-ref main

# Diff staged changes
quill src/app.ts --staged
```

## Full Reference

Run `quill --help` for the complete contract documentation including:

- All CLI options and diff modes
- Input JSON schema (what to pipe in)
- Output JSON schema (what to parse on stdout)
- Exit codes
- Edge-case behavior
- Environment variables

The `--help` output is the authoritative reference for both humans and agents.

## Keybindings

### Browse Mode

| Key | Action |
|---|---|
| `j`/`k` or `↑`/`↓` | Move cursor up/down |
| `h`/`l` or `←`/`→` | Scroll left/right |
| `PgUp`/`PgDn` or `Ctrl+U`/`Ctrl+D` | Half-page up/down |
| `Home`/`gg` | Jump to top |
| `End`/`G` | Jump to bottom |
| `0` | Reset horizontal scroll |
| `/` | Search (regex) |
| `n`/`N` | Next/previous search match |
| `Esc` | Clear search |
| `:` or `Ctrl+G` | Go to line number |
| `v` or `Shift+↑`/`↓` | Start/extend line selection |
| `a` | Create annotation (on cursor line or selection) |
| `Tab`/`Shift+Tab` | Next/previous annotation |
| `c` | Toggle annotation expanded/collapsed |
| `C` | Toggle all annotations |
| `r` | Reply to focused annotation |
| `w` | Edit focused annotation |
| `x` | Delete focused annotation (with confirmation) |
| `d` | Toggle between raw and diff view |
| `q` | Finish — opens approve/deny picker |
| `Ctrl+C` | Abort (exit code 1, no output) |

### Annotation Flow

1. **Intent** — `i` instruct · `q` question · `c` comment · `p` praise
2. **Category** (optional) — `b` bug · `s` security · `f` performance · `d` design · `t` style · `k` nitpick · `Space` skip
3. **Comment** — free-text, `Enter` to submit, `Esc` to cancel

## Requirements

- Node.js ≥ 18
- Git (for diff features)
- True-color terminal recommended (Shiki outputs 24-bit ANSI)
