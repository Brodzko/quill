/**
 * Per-mode keypress dispatch handlers.
 *
 * Each handler receives immutable state + key and returns a `DispatchResult`
 * describing the next state, updated flow state, and optional exit signal.
 * The CLI input loop applies these results — handlers have no side effects.
 */

import { randomUUID } from 'crypto';
import type { Key } from './keypress.js';
import type { KnownCategory, KnownIntent, SessionResult } from './schema.js';
import {
  type AnnotationFlowState,
  type BrowseState,
  type DecideFlowState,
  type EditFlowState,
  type GotoFlowState,
  type ReplyFlowState,
  INITIAL_ANNOTATION_FLOW,
  INITIAL_DECIDE_FLOW,
  INITIAL_EDIT_FLOW,
  INITIAL_GOTO_FLOW,
  INITIAL_REPLY_FLOW,
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
          category: selected?.id,
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
          category: matched.id,
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
    let nextState = reduce(state, { type: 'set_mode', mode: 'browse' });
    if (!Number.isNaN(target) && target > 0) {
      nextState = reduce(nextState, { type: 'set_cursor', line: target });
    }
    return { state: nextState, gotoFlow: undefined };
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

// --- Browse mode ---

export const handleBrowseKey = (
  key: Key,
  state: BrowseState,
  ggPending: boolean
): DispatchResult => {
  // Shift+arrows → start selection and extend
  if (key.shift && key.upArrow) {
    let s = reduce(state, { type: 'start_select' });
    s = reduce(s, { type: 'extend_select', delta: -1 });
    return { state: s };
  }
  if (key.shift && key.downArrow) {
    let s = reduce(state, { type: 'start_select' });
    s = reduce(s, { type: 'extend_select', delta: 1 });
    return { state: s };
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

  // Jump to top/bottom
  if (key.home) {
    return { state: reduce(state, { type: 'set_cursor', line: 1 }) };
  }
  if (key.end) {
    return {
      state: reduce(state, { type: 'set_cursor', line: state.lineCount }),
    };
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

  // Tab — toggle annotation expand/collapse on cursor line
  if (key.tab) {
    const annsOnLine = annotationsOnLine(state.annotations, state.cursorLine);
    if (annsOnLine.length > 0) {
      let s = state;
      for (const ann of annsOnLine) {
        s = reduce(s, { type: 'toggle_annotation', annotationId: ann.id });
      }
      return { state: s };
    }
    return { state };
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

  // e — edit expanded annotation on cursor line
  if (key.char === 'e') {
    const target = annotationsOnLine(state.annotations, state.cursorLine)
      .find((a) => state.expandedAnnotations.has(a.id));
    if (target) {
      return {
        state: reduce(state, { type: 'set_mode', mode: 'edit' }),
        editFlow: INITIAL_EDIT_FLOW(target),
      };
    }
  }

  // x — delete expanded annotation on cursor line
  if (key.char === 'x') {
    const target = annotationsOnLine(state.annotations, state.cursorLine)
      .find((a) => state.expandedAnnotations.has(a.id));
    if (target) {
      return {
        state: reduce(state, { type: 'delete_annotation', annotationId: target.id }),
      };
    }
  }

  // Annotate (single-line)
  if (key.char === 'n') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'annotate' }),
      annotationFlow: { ...INITIAL_ANNOTATION_FLOW },
    };
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
      const nextState = reduce(state, {
        type: 'add_reply',
        annotationId: flow.annotationId,
        reply: { comment: trimmed, source: 'user' },
      });
      return {
        state: reduce(nextState, { type: 'set_mode', mode: 'browse' }),
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
      const nextState = reduce(state, {
        type: 'update_annotation',
        annotationId: flow.annotationId,
        changes: { comment: trimmed },
      });
      return {
        state: reduce(nextState, { type: 'set_mode', mode: 'browse' }),
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
