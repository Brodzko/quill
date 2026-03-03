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
  type GotoFlowState,
  INITIAL_ANNOTATION_FLOW,
  INITIAL_GOTO_FLOW,
  halfPage,
  reduce,
  selectionRange,
} from './state.js';

// --- Result type ---

export type DispatchResult = {
  readonly state: BrowseState;
  readonly annotationFlow?: AnnotationFlowState;
  readonly gotoFlow?: GotoFlowState;
  /** When set, the CLI should call `finish()` with this result. */
  readonly exit?: SessionResult;
  /** When set, controls the gg two-key sequence timer state. */
  readonly gg?: GgState;
};

export type GgState = {
  readonly pending: boolean;
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

  if (flow.step === 'intent') {
    const INTENT_MAP: Record<string, KnownIntent> = {
      i: 'instruct',
      q: 'question',
      c: 'comment',
      p: 'praise',
    };
    const matched = INTENT_MAP[key.char];
    return {
      state,
      annotationFlow: matched
        ? { ...flow, step: 'category', intent: matched }
        : flow,
    };
  }

  if (flow.step === 'category') {
    if (key.return) {
      return { state, annotationFlow: { ...flow, step: 'comment' } };
    }
    const CATEGORY_MAP: Record<string, KnownCategory> = {
      b: 'bug',
      s: 'security',
      f: 'performance',
      d: 'design',
      t: 'style',
      k: 'nitpick',
    };
    const matched = CATEGORY_MAP[key.char];
    return {
      state,
      annotationFlow: matched
        ? { ...flow, step: 'comment', category: matched }
        : flow,
    };
  }

  // comment step
  if (key.return) {
    const trimmed = flow.comment.trim();
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

  if (key.backspace) {
    return {
      state,
      annotationFlow: { ...flow, comment: flow.comment.slice(0, -1) },
    };
  }

  if (key.char && !key.ctrl) {
    return {
      state,
      annotationFlow: { ...flow, comment: flow.comment + key.char },
    };
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

  // Annotate (single-line)
  if (key.char === 'n') {
    return {
      state: reduce(state, { type: 'set_mode', mode: 'annotate' }),
      annotationFlow: { ...INITIAL_ANNOTATION_FLOW },
    };
  }

  // Finish / decision picker
  if (key.char === 'q') {
    return { state: reduce(state, { type: 'set_mode', mode: 'decide' }) };
  }

  return { state };
};

// --- Decide mode ---

export const handleDecideKey = (
  key: Key,
  state: BrowseState
): DispatchResult => {
  if (key.char === 'a') {
    return {
      state,
      exit: {
        type: 'finish',
        decision: 'approve',
        annotations: state.annotations,
      },
    };
  }
  if (key.char === 'd') {
    return {
      state,
      exit: {
        type: 'finish',
        decision: 'deny',
        annotations: state.annotations,
      },
    };
  }
  if (key.escape) {
    return { state: reduce(state, { type: 'set_mode', mode: 'browse' }) };
  }
  return { state };
};
