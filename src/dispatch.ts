/**
 * Per-mode keypress dispatch handlers.
 *
 * Each handler receives immutable state + key and returns a `DispatchResult`
 * describing the next state, updated flow state, and optional exit signal.
 * The CLI input loop applies these results — handlers have no side effects.
 */

import { randomUUID } from 'crypto';
import * as R from 'remeda';
import type { Key } from './keypress.js';
import type { KnownCategory, KnownIntent, SessionResult } from './schema.js';
import {
  type AnnotationFlowState,
  type BrowseState,
  type ConfirmFlowState,
  type DecideFlowState,
  type EditFlowState,
  type GotoFlowState,
  type ReplyFlowState,
  type SearchFlowState,
  INITIAL_ANNOTATION_FLOW,
  INITIAL_CONFIRM_FLOW,
  INITIAL_DECIDE_FLOW,
  INITIAL_EDIT_FLOW,
  INITIAL_GOTO_FLOW,
  INITIAL_REPLY_FLOW,
  INITIAL_SEARCH_FLOW,
  applyActions,
  halfPage,
  reduce,
  selectionRange,
} from './state.js';
import { annotationsOnLine } from './annotation-box.js';
import {
  createPicker,
  findByShortcut,
  getHighlighted,
  moveHighlight,
  CATEGORY_OPTIONS,
} from './picker.js';
import {
  deleteBack,
  deleteToLineStart,
  deleteWordBack,
  getText,
  insertChar,
  insertNewline,
  moveDown,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveUp,
  moveWordLeft,
  moveWordRight,
} from './text-buffer.js';

// --- Result type ---

export type DispatchResult = {
  readonly state: BrowseState;
  readonly annotationFlow?: AnnotationFlowState;
  readonly gotoFlow?: GotoFlowState;
  readonly replyFlow?: ReplyFlowState;
  readonly editFlow?: EditFlowState;
  readonly decideFlow?: DecideFlowState;
  readonly confirmFlow?: ConfirmFlowState;
  readonly searchFlow?: SearchFlowState;
  /** When set, the CLI should call `finish()` with this result. */
  readonly exit?: SessionResult;
  /** When set, controls the gg two-key sequence timer state. */
  readonly gg?: GgState;
};

export type GgState = {
  readonly pending: boolean;
};

// --- Shared textbox key handler ---

/**
 * Apply macOS-style text editing keys to a TextBuffer.
 * Returns the updated buffer, or undefined if the key wasn't a text editing key.
 */
import type { TextBuffer } from './text-buffer.js';

const applyTextKey = (key: Key, buf: TextBuffer): TextBuffer | undefined => {
  // Newline: Shift+Enter or Alt+Enter
  if (key.return && (key.shift || key.alt)) {
    return insertNewline(buf);
  }

  // Word delete: Alt+Backspace
  if (key.backspace && key.alt) {
    return deleteWordBack(buf);
  }

  // Delete to line start: Ctrl+U
  if (key.ctrl && key.char === 'u') {
    return deleteToLineStart(buf);
  }

  // Backspace
  if (key.backspace) {
    return deleteBack(buf);
  }

  // Word navigation: Alt+Arrow or Ctrl+Arrow
  if ((key.alt || key.ctrl) && key.leftArrow) return moveWordLeft(buf);
  if ((key.alt || key.ctrl) && key.rightArrow) return moveWordRight(buf);

  // Line start/end: Ctrl+A / Ctrl+E or Home / End
  if (key.ctrl && key.char === 'a') return moveLineStart(buf);
  if (key.ctrl && key.char === 'e') return moveLineEnd(buf);
  if (key.home) return moveLineStart(buf);
  if (key.end) return moveLineEnd(buf);

  // Arrow navigation
  if (key.leftArrow) return moveLeft(buf);
  if (key.rightArrow) return moveRight(buf);
  if (key.upArrow) return moveUp(buf);
  if (key.downArrow) return moveDown(buf);

  // Printable character
  if (key.char && !key.ctrl && !key.alt) {
    return insertChar(buf, key.char);
  }

  return undefined;
};

// --- Annotate mode ---

export const handleAnnotateKey = (
  key: Key,
  state: BrowseState,
  flow: AnnotationFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: { ...state, mode: 'browse', selection: undefined },
      annotationFlow: undefined,
    };
  }

  // --- Intent picker step ---
  if (flow.step === 'intent') {
    // Arrow navigation
    if (key.upArrow || key.char === 'k') {
      return {
        state,
        annotationFlow: { ...flow, picker: moveHighlight(flow.picker, -1) },
      };
    }
    if (key.downArrow || key.char === 'j') {
      return {
        state,
        annotationFlow: { ...flow, picker: moveHighlight(flow.picker, 1) },
      };
    }

    // Enter confirms highlighted
    if (key.return) {
      const selected = getHighlighted(flow.picker);
      if (selected) {
        return {
          state,
          annotationFlow: {
            ...flow,
            step: 'category',
            intent: selected.id,
            picker: createPicker(CATEGORY_OPTIONS),
          },
        };
      }
      return { state, annotationFlow: flow };
    }

    // Direct shortcut
    const matched = findByShortcut(flow.picker, key.char);
    if (matched) {
      return {
        state,
        annotationFlow: {
          ...flow,
          step: 'category',
          intent: matched.id,
          picker: createPicker(CATEGORY_OPTIONS),
        },
      };
    }

    return { state, annotationFlow: flow };
  }

  // --- Category picker step ---
  if (flow.step === 'category') {
    // Arrow navigation
    if (key.upArrow || key.char === 'k') {
      return {
        state,
        annotationFlow: { ...flow, picker: moveHighlight(flow.picker, -1) },
      };
    }
    if (key.downArrow || key.char === 'j') {
      return {
        state,
        annotationFlow: { ...flow, picker: moveHighlight(flow.picker, 1) },
      };
    }

    // Enter confirms highlighted or skips
    if (key.return) {
      const selected = getHighlighted(flow.picker);
      return {
        state,
        annotationFlow: {
          ...flow,
          step: 'comment',
          category: selected?.id || undefined,
        },
      };
    }

    // Direct shortcut
    const matched = findByShortcut(flow.picker, key.char);
    if (matched) {
      return {
        state,
        annotationFlow: {
          ...flow,
          step: 'comment',
          category: matched.id || undefined,
        },
      };
    }

    return { state, annotationFlow: flow };
  }

  // --- Comment textbox step ---
  // Enter submits
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0 && flow.intent) {
      const range = state.selection
        ? selectionRange(state.selection)
        : { startLine: state.cursorLine, endLine: state.cursorLine };
      const nextState = reduce(state, {
        type: 'add_annotation',
        annotation: {
          id: randomUUID(),
          ...range,
          intent: flow.intent as KnownIntent,
          category: flow.category as KnownCategory | undefined,
          comment: trimmed,
          source: 'user',
        },
      });
      return {
        state: { ...nextState, mode: 'browse', selection: undefined },
        annotationFlow: undefined,
      };
    }
    return { state, annotationFlow: flow };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state, annotationFlow: { ...flow, comment: updatedBuf } };
  }

  return { state, annotationFlow: flow };
};

// --- Goto mode ---

export const handleGotoKey = (
  key: Key,
  state: BrowseState,
  flow: GotoFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      gotoFlow: undefined,
    };
  }

  if (key.return) {
    const target = parseInt(flow.input, 10);
    const actions = [
      { type: 'set_mode' as const, mode: 'browse' as const },
      ...(!Number.isNaN(target) && target > 0
        ? [{ type: 'set_cursor' as const, line: target }]
        : []),
    ];
    return { state: applyActions(state, actions), gotoFlow: undefined };
  }

  if (key.backspace) {
    return { state, gotoFlow: { input: flow.input.slice(0, -1) } };
  }

  if (key.char >= '0' && key.char <= '9') {
    return { state, gotoFlow: { input: flow.input + key.char } };
  }

  return { state, gotoFlow: flow };
};

// --- Select mode ---

export const handleSelectKey = (
  key: Key,
  state: BrowseState
): DispatchResult => {
  if (key.escape) {
    return { state: reduce(state, { type: 'cancel_select' }) };
  }

  if (key.return) {
    return {
      state: reduce(state, { type: 'confirm_select' }),
      annotationFlow: { ...INITIAL_ANNOTATION_FLOW },
    };
  }

  if (key.char === 'k' || key.upArrow) {
    return { state: reduce(state, { type: 'extend_select', delta: -1 }) };
  }
  if (key.char === 'j' || key.downArrow) {
    return { state: reduce(state, { type: 'extend_select', delta: 1 }) };
  }

  if (key.pageUp || (key.ctrl && key.char === 'u')) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'extend_select', delta: -hp }) };
  }
  if (key.pageDown || (key.ctrl && key.char === 'd')) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'extend_select', delta: hp }) };
  }

  return { state };
};

// --- Annotation jump helper ---

/**
 * Jump to the next (direction=1) or previous (direction=-1) annotation line,
 * cycling through all annotated lines. Auto-expands annotations on the target
 * line and auto-collapses annotations on the departure line.
 */
const jumpToNextAnnotation = (
  state: BrowseState,
  direction: 1 | -1
): DispatchResult => {
  if (state.annotations.length === 0) return { state };

  // Collect unique annotation end-lines (where boxes render), sorted
  const annotatedLines = R.pipe(
    state.annotations,
    R.map((a) => a.endLine),
    R.unique(),
    R.sort((a, b) => a - b),
  );

  if (annotatedLines.length === 0) return { state };

  // Find next line in direction, wrapping
  const currentLine = state.cursorLine;
  let targetLine: number;

  if (direction === 1) {
    const next = annotatedLines.find((l) => l > currentLine);
    targetLine = next ?? annotatedLines[0]!;
  } else {
    const prev = R.pipe(
      annotatedLines,
      R.filter((l) => l < currentLine),
      R.last(),
    );
    targetLine = prev ?? annotatedLines[annotatedLines.length - 1]!;
  }

  // Collapse expanded annotations on departure line, move cursor, expand on target line
  const collapseActions = annotationsOnLine(state.annotations, currentLine)
    .filter((a) => state.expandedAnnotations.has(a.id))
    .map((a) => ({ type: 'toggle_annotation' as const, annotationId: a.id }));

  const afterCollapse = applyActions(state, [
    ...collapseActions,
    { type: 'set_cursor', line: targetLine },
  ]);

  const expandActions = annotationsOnLine(afterCollapse.annotations, targetLine)
    .filter((a) => !afterCollapse.expandedAnnotations.has(a.id))
    .map((a) => ({ type: 'toggle_annotation' as const, annotationId: a.id }));

  return { state: applyActions(afterCollapse, expandActions) };
};

// --- Browse mode ---

export const handleBrowseKey = (
  key: Key,
  state: BrowseState,
  ggPending: boolean
): DispatchResult => {
  // Escape clears active search highlights
  if (key.escape && state.search) {
    return { state: reduce(state, { type: 'clear_search' }) };
  }

  // Shift+arrows → start selection and extend
  if (key.shift && key.upArrow) {
    return { state: applyActions(state, [
      { type: 'start_select' },
      { type: 'extend_select', delta: -1 },
    ]) };
  }
  if (key.shift && key.downArrow) {
    return { state: applyActions(state, [
      { type: 'start_select' },
      { type: 'extend_select', delta: 1 },
    ]) };
  }

  // Single-line movement
  if (key.char === 'k' || key.upArrow) {
    return { state: reduce(state, { type: 'move_cursor', delta: -1 }) };
  }
  if (key.char === 'j' || key.downArrow) {
    return { state: reduce(state, { type: 'move_cursor', delta: 1 }) };
  }

  // Half-page scroll
  if (key.pageUp || (key.ctrl && key.char === 'u')) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'move_cursor', delta: -hp }) };
  }
  if (key.pageDown || (key.ctrl && key.char === 'd')) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'move_cursor', delta: hp }) };
  }

  // Horizontal scroll (h/l or left/right arrows)
  if (key.char === 'h' || key.leftArrow) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: -4 }) };
  }
  if (key.char === 'l' || key.rightArrow) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: 4 }) };
  }
  // Reset horizontal scroll
  if (key.char === '0') {
    return { state: reduce(state, { type: 'reset_horizontal' }) };
  }

  // Mouse wheel scroll — moves viewport, cursor stays unless off-screen
  if (key.scrollUp) {
    return { state: reduce(state, { type: 'scroll_viewport', delta: -3 }) };
  }
  if (key.scrollDown) {
    return { state: reduce(state, { type: 'scroll_viewport', delta: 3 }) };
  }

  // Mouse horizontal scroll (Shift+wheel / trackpad sideways)
  if (key.scrollLeft) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: -4 }) };
  }
  if (key.scrollRight) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: 4 }) };
  }

  // Jump to top/bottom
  if (key.home) {
    return { state: reduce(state, { type: 'set_cursor', line: 1 }) };
  }
  if (key.end) {
    return {
      state: reduce(state, { type: 'set_cursor', line: state.lineCount }),
    };
  }

  // Search navigation: Ctrl+N / Ctrl+P
  if (key.ctrl && key.char === 'n') {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: 1 }) };
    }
    return { state };
  }
  if (key.ctrl && key.char === 'p') {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: -1 }) };
    }
    return { state };
  }

  // Goto line (must precede gg check — Ctrl+G has char='g' + ctrl=true)
  if (key.char === ':' || (key.ctrl && key.char === 'g')) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'goto' }),
      gotoFlow: { ...INITIAL_GOTO_FLOW },
    };
  }

  // gg — two-key sequence
  if (key.char === 'g') {
    if (ggPending) {
      return {
        state: reduce(state, { type: 'set_cursor', line: 1 }),
        gg: { pending: false },
      };
    }
    return { state, gg: { pending: true } };
  }

  // G — jump to bottom
  if (key.char === 'G') {
    return {
      state: reduce(state, { type: 'set_cursor', line: state.lineCount }),
    };
  }

  // Visual select
  if (key.char === 'v') {
    return { state: reduce(state, { type: 'start_select' }) };
  }

  // Tab / Shift+Tab — cycle through annotation lines
  if (key.tab) {
    return jumpToNextAnnotation(state, key.shift ? -1 : 1);
  }

  // c — toggle annotations on cursor line (expand if collapsed, collapse if expanded)
  if (key.char === 'c') {
    const toggleActions = annotationsOnLine(state.annotations, state.cursorLine)
      .map((a) => ({ type: 'toggle_annotation' as const, annotationId: a.id }));
    return { state: toggleActions.length > 0 ? applyActions(state, toggleActions) : state };
  }

  // C — toggle all: collapse all if any expanded, expand all if none expanded
  if (key.char === 'C') {
    if (state.annotations.length === 0) return { state };
    const action = state.expandedAnnotations.size > 0
      ? { type: 'collapse_all' as const }
      : { type: 'expand_all' as const };
    return { state: reduce(state, action) };
  }

  // r — reply to expanded annotation on cursor line
  if (key.char === 'r') {
    const target = annotationsOnLine(state.annotations, state.cursorLine)
      .find((a) => state.expandedAnnotations.has(a.id));
    if (target) {
      return {
        state: reduce(state, { type: 'set_mode', mode: 'reply' }),
        replyFlow: INITIAL_REPLY_FLOW(target.id),
      };
    }
  }

  // w — edit (rewrite) expanded annotation on cursor line
  if (key.char === 'w') {
    const target = annotationsOnLine(state.annotations, state.cursorLine)
      .find((a) => state.expandedAnnotations.has(a.id));
    if (target) {
      return {
        state: reduce(state, { type: 'set_mode', mode: 'edit' }),
        editFlow: INITIAL_EDIT_FLOW(target),
      };
    }
  }

  // x — confirm delete of expanded annotation on cursor line
  if (key.char === 'x') {
    const target = annotationsOnLine(state.annotations, state.cursorLine)
      .find((a) => state.expandedAnnotations.has(a.id));
    if (target) {
      return {
        state: reduce(state, { type: 'set_mode', mode: 'confirm' }),
        confirmFlow: INITIAL_CONFIRM_FLOW(target.id),
      };
    }
  }

  // Annotate (single-line)
  if (key.char === 'a') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'annotate' }),
      annotationFlow: { ...INITIAL_ANNOTATION_FLOW },
    };
  }

  // Search
  if (key.char === '/') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'search' }),
      searchFlow: { ...INITIAL_SEARCH_FLOW },
    };
  }

  // Next search match
  if (key.char === 'n') {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: 1 }) };
    }
    return { state };
  }

  // Previous search match
  if (key.char === 'N') {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: -1 }) };
    }
    return { state };
  }

  // Finish / decision picker
  if (key.char === 'q') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'decide' }),
      decideFlow: { ...INITIAL_DECIDE_FLOW },
    };
  }

  return { state };
};

// --- Reply mode ---

export const handleReplyKey = (
  key: Key,
  state: BrowseState,
  flow: ReplyFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      replyFlow: undefined,
    };
  }

  // Enter submits (not Shift+Enter / Alt+Enter)
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0) {
      return {
        state: applyActions(state, [
          { type: 'add_reply', annotationId: flow.annotationId, reply: { comment: trimmed, source: 'user' } },
          { type: 'set_mode', mode: 'browse' },
        ]),
        replyFlow: undefined,
      };
    }
    return { state, replyFlow: flow };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state, replyFlow: { ...flow, comment: updatedBuf } };
  }

  return { state, replyFlow: flow };
};

// --- Edit mode ---

export const handleEditKey = (
  key: Key,
  state: BrowseState,
  flow: EditFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      editFlow: undefined,
    };
  }

  // Enter saves (not Shift+Enter / Alt+Enter)
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0) {
      return {
        state: applyActions(state, [
          { type: 'update_annotation', annotationId: flow.annotationId, changes: { comment: trimmed } },
          { type: 'set_mode', mode: 'browse' },
        ]),
        editFlow: undefined,
      };
    }
    return { state, editFlow: flow };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state, editFlow: { ...flow, comment: updatedBuf } };
  }

  return { state, editFlow: flow };
};

// --- Confirm mode ---

export const handleConfirmKey = (
  key: Key,
  state: BrowseState,
  flow: ConfirmFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      confirmFlow: undefined,
    };
  }

  // Arrow navigation
  if (key.upArrow || key.char === 'k') {
    return {
      state,
      confirmFlow: { ...flow, picker: moveHighlight(flow.picker, -1) },
    };
  }
  if (key.downArrow || key.char === 'j') {
    return {
      state,
      confirmFlow: { ...flow, picker: moveHighlight(flow.picker, 1) },
    };
  }

  // Enter confirms highlighted
  if (key.return) {
    const selected = getHighlighted(flow.picker);
    if (selected?.id === 'yes') {
      return {
        state: applyActions(state, [
          { type: 'delete_annotation', annotationId: flow.annotationId },
          { type: 'set_mode', mode: 'browse' },
        ]),
        confirmFlow: undefined,
      };
    }
    // "no" or default — cancel
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      confirmFlow: undefined,
    };
  }

  // Direct shortcut
  const matched = findByShortcut(flow.picker, key.char);
  if (matched?.id === 'yes') {
    return {
      state: applyActions(state, [
        { type: 'delete_annotation', annotationId: flow.annotationId },
        { type: 'set_mode', mode: 'browse' },
      ]),
      confirmFlow: undefined,
    };
  }
  if (matched?.id === 'no') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      confirmFlow: undefined,
    };
  }

  return { state, confirmFlow: flow };
};

// --- Search mode ---

/**
 * Find all 1-indexed line numbers whose raw content matches the pattern
 * (case-insensitive substring match).
 */
const findMatchLines = (
  sourceLines: readonly string[],
  pattern: string
): number[] => {
  if (pattern.length === 0) return [];
  const lower = pattern.toLowerCase();
  const result: number[] = [];
  for (let i = 0; i < sourceLines.length; i++) {
    if (sourceLines[i]!.toLowerCase().includes(lower)) {
      result.push(i + 1);
    }
  }
  return result;
};

export const handleSearchKey = (
  key: Key,
  state: BrowseState,
  flow: SearchFlowState,
  sourceLines: readonly string[]
): DispatchResult => {
  // Escape clears search and returns to browse
  if (key.escape) {
    return {
      state: applyActions(state, [
        { type: 'clear_search' },
        { type: 'set_mode', mode: 'browse' },
      ]),
      searchFlow: undefined,
    };
  }

  // Enter commits the search and returns to browse (keeps highlights)
  if (key.return && !key.shift && !key.alt) {
    const pattern = getText(flow.input).trim();
    if (pattern.length > 0) {
      const matchLines = findMatchLines(sourceLines, pattern);
      return {
        state: applyActions(state, [
          { type: 'set_search', pattern, matchLines },
          { type: 'set_mode', mode: 'browse' },
        ]),
        searchFlow: undefined,
      };
    }
    // Empty pattern — clear search and return
    return {
      state: applyActions(state, [
        { type: 'clear_search' },
        { type: 'set_mode', mode: 'browse' },
      ]),
      searchFlow: undefined,
    };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.input);
  if (updatedBuf) {
    // Live preview: compute matches as user types
    const pattern = getText(updatedBuf).trim();
    const matchLines = findMatchLines(sourceLines, pattern);
    const nextState = pattern.length > 0
      ? reduce(state, { type: 'set_search', pattern, matchLines })
      : reduce(state, { type: 'clear_search' });
    return { state: nextState, searchFlow: { ...flow, input: updatedBuf } };
  }

  return { state, searchFlow: flow };
};

// --- Decide mode ---

export const handleDecideKey = (
  key: Key,
  state: BrowseState,
  flow: DecideFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'browse' }),
      decideFlow: undefined,
    };
  }

  // Arrow navigation
  if (key.upArrow || key.char === 'k') {
    return {
      state,
      decideFlow: { picker: moveHighlight(flow.picker, -1) },
    };
  }
  if (key.downArrow || key.char === 'j') {
    return {
      state,
      decideFlow: { picker: moveHighlight(flow.picker, 1) },
    };
  }

  // Enter confirms highlighted
  if (key.return) {
    const selected = getHighlighted(flow.picker);
    if (selected) {
      const decision = selected.id as 'approve' | 'deny';
      return {
        state,
        exit: {
          type: 'finish',
          decision,
          annotations: state.annotations,
        },
      };
    }
    return { state, decideFlow: flow };
  }

  // Direct shortcut
  const matched = findByShortcut(flow.picker, key.char);
  if (matched) {
    const decision = matched.id as 'approve' | 'deny';
    return {
      state,
      exit: {
        type: 'finish',
        decision,
        annotations: state.annotations,
      },
    };
  }

  return { state, decideFlow: flow };
};
