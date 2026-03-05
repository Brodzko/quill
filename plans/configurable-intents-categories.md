# Plan: Configurable Intents & Categories via CLI

## Goal

Allow callers to specify which intents and categories are available in a quill
session via CLI flags. All known intents/categories remain hardcoded in quill
with fixed keyboard shortcuts — the flags just filter which ones are offered.

## Design

### CLI surface

```bash
quill src/app.ts --intents=instruct,question,comment
quill src/app.ts --categories=bug,design,nitpick
quill src/app.ts --intents=instruct,question --categories=""
```

- Comma-separated list of known intent/category names.
- If `--intents` is omitted, all known intents are available (backwards compatible).
- If `--categories` is omitted, all known categories are available.
- `--categories=""` disables the category step entirely (skip picker).
- Unknown values in the list are a validation error (exit 1 with message).

### Keyboard shortcuts stay hardcoded

All known intents and their shortcuts are defined once in quill:

```typescript
const ALL_INTENTS = {
  i: 'instruct',
  q: 'question',
  c: 'comment',
  p: 'praise',
  s: 'suggestion',
  u: 'uncertainty',
} as const;

const ALL_CATEGORIES = {
  b: 'bug',
  s: 'security',
  f: 'performance',
  d: 'design',
  t: 'style',
  k: 'nitpick',
} as const;
```

When `--intents=instruct,question` is passed, the picker only shows `[i] instruct`
and `[q] question`. The other shortcuts are inactive. No collision logic, no
custom mappings — the tradeoff is that adding a new intent requires a quill
release, which is fine given how rarely intents change.

### Incoming annotations are not filtered

Annotations loaded from input JSON with intents/categories NOT in the active set
are accepted and displayed normally. The flags control what the **human can
create**, not what's valid to display. An agent annotation with
`intent: "uncertainty"` renders fine even if "uncertainty" isn't in the current
`--intents` list.

## Implementation

### Step 1: Add new known intents/categories to schema.ts

Add `suggestion` and `uncertainty` to `KnownIntent`. Keep the full maps as
defaults. Export both the full maps and a function to filter them.

```typescript
export type KnownIntent = 'instruct' | 'question' | 'comment' | 'praise' | 'suggestion' | 'uncertainty';

export const ALL_INTENT_BY_KEY = { ... } as const;
export const ALL_CATEGORY_BY_KEY = { ... } as const;

export const filterMap = <T extends Record<string, string>>(
  full: T,
  allowed: readonly string[]
): Partial<T> => { ... };
```

### Step 2: Parse CLI params in cli.ts

Add `--intents` and `--categories` as optional string options. Parse and
validate against known values. Pass the resulting filtered maps into session/state.

### Step 3: Thread filtered maps through state

`AppState` gains `intentByKey` and `categoryByKey` fields, populated from CLI
params or defaults. These replace direct imports of `INTENT_BY_KEY` /
`CATEGORY_BY_KEY` throughout the codebase.

### Step 4: Picker renders from state

The intent/category picker reads from state maps instead of hardcoded constants.
Only shows shortcuts for intents/categories in the active map.

### Step 5: Category step skip

If `categoryByKey` is empty (from `--categories=""`), skip the category picker
entirely after intent selection — go straight to comment textbox.

## Files touched

| File | Change |
|---|---|
| `schema.ts` | New known intents, full maps, filter utility |
| `cli.ts` | New options, parsing, validation |
| `state.ts` | Carry runtime maps in state |
| `keymap.ts` | Read maps from state instead of constants |
| `picker.ts` | Dynamic rendering from state maps |
| `render.ts` | Intent/category styling uses runtime map |
| Tests | New cases for filtering, CLI parsing, picker rendering |

## Open questions

- Do we need `suggestion` and `uncertainty` in v1, or just prepare the
  mechanism and add them when the skills need them? Leaning toward adding the
  mechanism now, new intents when needed.
- Should `--intents` / `--categories` also appear in the input JSON envelope
  as an alternative to CLI flags? (Useful when the tool constructs the full
  invocation as JSON.) Leaning toward CLI-only for now, envelope later if needed.
