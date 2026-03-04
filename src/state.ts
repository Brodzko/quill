import * as R from 'remeda';
import type { Annotation } from './schema.js';
import type { TextBuffer } from './text-buffer.js';
import { createBuffer } from './text-buffer.js';
import type { PickerState } from './picker.js';
import {
  createPicker,
  CONFIRM_OPTIONS,
  DECISION_OPTIONS,
  INTENT_OPTIONS,
} from './picker.js';

// --- Flow sub-states ---
// These describe modal UI flows that overlay the main browse state.
// They live here (not in render.ts) because they are state concerns
// consumed by both the reducer/dispatch layer and the renderer.

export type AnnotationFlowState = {
  readonly step: 'intent' | 'category' | 'comment';
  readonly intent?: string;
  readonly category?: string;
  readonly comment: TextBuffer;
  readonly picker: PickerState;
};

export const INITIAL_ANNOTATION_FLOW: AnnotationFlowState = {
  step: 'intent',
  comment: createBuffer(),
  picker: createPicker(INTENT_OPTIONS),
};

export type GotoFlowState = {
  /** Digits entered so far. */
  readonly input: string;
};

export const INITIAL_GOTO_FLOW: GotoFlowState = { input: '' };

export type ReplyFlowState = {
  /** The annotation id being replied to. */
  readonly annotationId: string;
  readonly comment: TextBuffer;
};

export const INITIAL_REPLY_FLOW = (annotationId: string): ReplyFlowState => ({
  annotationId,
  comment: createBuffer(),
});

export type EditFlowState = {
  /** The annotation id being edited. */
  readonly annotationId: string;
  readonly comment: TextBuffer;
};

export const INITIAL_EDIT_FLOW = (ann: { id: string; comment: string }): EditFlowState => ({
  annotationId: ann.id,
  comment: createBuffer(ann.comment),
});

export type DecideFlowState = {
  readonly picker: PickerState;
};

export const INITIAL_DECIDE_FLOW: DecideFlowState = {
  picker: createPicker(DECISION_OPTIONS),
};

export type ConfirmFlowState = {
  /** Describes the action to confirm. */
  readonly action: 'delete_annotation';
  /** The annotation id to act on. */
  readonly annotationId: string;
  readonly picker: PickerState;
};

export type SearchFlowState = {
  /** The search input being typed (while in search mode). */
  readonly input: TextBuffer;
};

export const INITIAL_SEARCH_FLOW: SearchFlowState = {
  input: createBuffer(),
};

/**
 * Persistent search state — lives on SessionState so highlights/navigation
 * survive exiting search mode back to browse.
 */
export type SearchState = {
  /** The committed search pattern (after Enter). Empty string = no search. */
  readonly pattern: string;
  /** 1-indexed line numbers that contain a match. */
  readonly matchLines: readonly number[];
  /** Index into matchLines for the current/focused match (-1 = none). */
  readonly currentMatchIndex: number;
};

export const INITIAL_CONFIRM_FLOW = (annotationId: string): ConfirmFlowState => ({
  action: 'delete_annotation',
  annotationId,
  picker: createPicker(CONFIRM_OPTIONS),
});

export type Mode = 'browse' | 'decide' | 'annotate' | 'goto' | 'select' | 'reply' | 'edit' | 'confirm' | 'search';

// Re-export TextBuffer for consumers
export type { TextBuffer } from './text-buffer.js';

export type Selection = {
  /** The line where selection started (1-indexed). */
  readonly anchor: number;
  /** The moving end of the selection (1-indexed). Tracks the cursor. */
  readonly active: number;
};

export type SessionState = {
  readonly lineCount: number;
  /** Maximum visible character width among all source lines. */
  readonly maxLineWidth: number;
  readonly viewportHeight: number;
  readonly cursorLine: number;
  readonly viewportOffset: number;
  /** Horizontal scroll offset — number of visible characters to skip from the left edge. */
  readonly horizontalOffset: number;
  readonly mode: Mode;
  readonly annotations: readonly Annotation[];
  /** Present only in 'select' mode. */
  readonly selection?: Selection;
  /** Set of annotation ids that are currently expanded inline. */
  readonly expandedAnnotations: ReadonlySet<string>;
  /** Persistent search state — survives mode transitions. */
  readonly search?: SearchState;

  // --- Modal flow sub-states ---
  // Present when the corresponding mode is active; undefined otherwise.
  readonly annotationFlow?: AnnotationFlowState;
  readonly gotoFlow?: GotoFlowState;
  readonly replyFlow?: ReplyFlowState;
  readonly editFlow?: EditFlowState;
  readonly decideFlow?: DecideFlowState;
  readonly confirmFlow?: ConfirmFlowState;
  readonly searchFlow?: SearchFlowState;
};

/** @deprecated Use SessionState — alias kept for migration. */
export type BrowseState = SessionState;

// Standard useReducer-compatible signature: (state, action) => state.
export type BrowseAction =
  | { type: 'move_cursor'; delta: number }
  | { type: 'set_cursor'; line: number }
  | { type: 'set_mode'; mode: Mode }
  | { type: 'add_annotation'; annotation: Annotation }
  | { type: 'update_viewport'; viewportHeight: number }
  | { type: 'start_select' }
  | { type: 'extend_select'; delta: number }
  | { type: 'confirm_select' }
  | { type: 'cancel_select' }
  | { type: 'toggle_annotation'; annotationId: string }
  | { type: 'delete_annotation'; annotationId: string }
  | { type: 'update_annotation'; annotationId: string; changes: Partial<Pick<Annotation, 'comment' | 'status'>> }
  | { type: 'add_reply'; annotationId: string; reply: { comment: string; source: string } }
  | { type: 'set_search'; pattern: string; matchLines: readonly number[] }
  | { type: 'clear_search' }
  | { type: 'navigate_match'; delta: 1 | -1 }
  | { type: 'scroll_viewport'; delta: number }
  | { type: 'scroll_horizontal'; delta: number }
  | { type: 'reset_horizontal' }
  | { type: 'collapse_all' }
  | { type: 'expand_all' };

export const clampLine = (value: number, lineCount: number): number =>
  R.clamp(value, { min: 1, max: Math.max(1, lineCount) });

/** Get the ordered [startLine, endLine] from a selection. */
export const selectionRange = (
  sel: Selection
): { startLine: number; endLine: number } => ({
  startLine: Math.min(sel.anchor, sel.active),
  endLine: Math.max(sel.anchor, sel.active),
});

/** Half the viewport height, minimum 1. Used for PgUp/PgDn/Ctrl+U/D. */
export const halfPage = (viewportHeight: number): number =>
  Math.max(1, Math.floor(viewportHeight / 2));

const SCROLL_OFF = 3;

export const computeViewportOffset = (params: {
  cursorLine: number;
  currentOffset: number;
  viewportHeight: number;
  lineCount: number;
}): number => {
  const { cursorLine, currentOffset, viewportHeight, lineCount } = params;
  const cursorIndex = cursorLine - 1; // 0-indexed
  const maxOffset = Math.max(0, lineCount - viewportHeight);

  if (cursorIndex < currentOffset + SCROLL_OFF) {
    return R.clamp(cursorIndex - SCROLL_OFF, { min: 0, max: maxOffset });
  }

  if (cursorIndex >= currentOffset + viewportHeight - SCROLL_OFF) {
    return R.clamp(cursorIndex - viewportHeight + SCROLL_OFF + 1, {
      min: 0,
      max: maxOffset,
    });
  }

  return currentOffset;
};

const recomputeOffset = (state: SessionState, viewportHeight: number): number =>
  computeViewportOffset({
    cursorLine: state.cursorLine,
    currentOffset: state.viewportOffset,
    viewportHeight,
    lineCount: state.lineCount,
  });

export const reduce = (state: SessionState, action: BrowseAction): SessionState => {
  switch (action.type) {
    case 'move_cursor': {
      const cursorLine = clampLine(
        state.cursorLine + action.delta,
        state.lineCount
      );
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: state.viewportHeight,
        lineCount: state.lineCount,
      });
      return { ...state, cursorLine, viewportOffset };
    }
    case 'set_cursor': {
      const cursorLine = clampLine(action.line, state.lineCount);
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: state.viewportHeight,
        lineCount: state.lineCount,
      });
      return { ...state, cursorLine, viewportOffset };
    }
    case 'set_mode': {
      return { ...state, mode: action.mode };
    }
    case 'add_annotation':
      return {
        ...state,
        annotations: [...state.annotations, action.annotation],
      };
    case 'update_viewport': {
      const viewportOffset = recomputeOffset(state, action.viewportHeight);
      return { ...state, viewportHeight: action.viewportHeight, viewportOffset };
    }
    case 'start_select': {
      return {
        ...state,
        mode: 'select',
        selection: { anchor: state.cursorLine, active: state.cursorLine },
      };
    }
    case 'extend_select': {
      if (!state.selection) return state;
      const active = clampLine(
        state.selection.active + action.delta,
        state.lineCount
      );
      const cursorLine = active;
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: state.viewportHeight,
        lineCount: state.lineCount,
      });
      return {
        ...state,
        cursorLine,
        viewportOffset,
        selection: { ...state.selection, active },
      };
    }
    case 'confirm_select': {
      // Transition to annotate, keep selection for annotation range
      return { ...state, mode: 'annotate' };
    }
    case 'cancel_select': {
      return { ...state, mode: 'browse', selection: undefined };
    }
    case 'toggle_annotation': {
      const next = new Set(state.expandedAnnotations);
      if (next.has(action.annotationId)) {
        next.delete(action.annotationId);
      } else {
        next.add(action.annotationId);
      }
      return { ...state, expandedAnnotations: next };
    }
    case 'delete_annotation': {
      const next = new Set(state.expandedAnnotations);
      next.delete(action.annotationId);
      return {
        ...state,
        annotations: state.annotations.filter((a) => a.id !== action.annotationId),
        expandedAnnotations: next,
      };
    }
    case 'update_annotation': {
      return {
        ...state,
        annotations: state.annotations.map((a) =>
          a.id === action.annotationId ? { ...a, ...action.changes } : a
        ),
      };
    }
    case 'add_reply': {
      return {
        ...state,
        annotations: state.annotations.map((a) =>
          a.id === action.annotationId
            ? { ...a, replies: [...(a.replies ?? []), action.reply] }
            : a
        ),
      };
    }
    case 'set_search': {
      if (action.matchLines.length === 0) {
        return {
          ...state,
          search: { pattern: action.pattern, matchLines: [], currentMatchIndex: -1 },
        };
      }
      // Find the first match at or after the current cursor line
      const idx = action.matchLines.findIndex((l) => l >= state.cursorLine);
      const matchIdx = idx >= 0 ? idx : 0;
      const cursorLine = action.matchLines[matchIdx]!;
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: state.viewportHeight,
        lineCount: state.lineCount,
      });
      return {
        ...state,
        cursorLine,
        viewportOffset,
        search: { pattern: action.pattern, matchLines: action.matchLines, currentMatchIndex: matchIdx },
      };
    }
    case 'clear_search': {
      return { ...state, search: undefined };
    }
    case 'navigate_match': {
      if (!state.search || state.search.matchLines.length === 0) return state;
      const len = state.search.matchLines.length;
      const nextIdx = ((state.search.currentMatchIndex + action.delta) % len + len) % len;
      const cursorLine = state.search.matchLines[nextIdx]!;
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: state.viewportHeight,
        lineCount: state.lineCount,
      });
      return {
        ...state,
        cursorLine,
        viewportOffset,
        search: { ...state.search, currentMatchIndex: nextIdx },
      };
    }
    case 'scroll_viewport': {
      const maxOffset = Math.max(0, state.lineCount - state.viewportHeight);
      const viewportOffset = R.clamp(state.viewportOffset + action.delta, {
        min: 0,
        max: maxOffset,
      });
      // Clamp cursor to stay within the visible viewport
      const visTop = viewportOffset + 1;
      const visBottom = Math.min(
        viewportOffset + state.viewportHeight,
        state.lineCount
      );
      const cursorLine = R.clamp(state.cursorLine, {
        min: visTop,
        max: visBottom,
      });
      return { ...state, viewportOffset, cursorLine };
    }
    case 'scroll_horizontal': {
      const maxHorizontal = Math.max(0, state.maxLineWidth + 20);
      const horizontalOffset = R.clamp(state.horizontalOffset + action.delta, {
        min: 0,
        max: maxHorizontal,
      });
      return { ...state, horizontalOffset };
    }
    case 'reset_horizontal': {
      return { ...state, horizontalOffset: 0 };
    }
    case 'collapse_all': {
      return { ...state, expandedAnnotations: new Set<string>() };
    }
    case 'expand_all': {
      return {
        ...state,
        expandedAnnotations: new Set(state.annotations.map((a) => a.id)),
      };
    }
  }
};

/**
 * Apply a sequence of actions to state, left-to-right.
 * Replaces nested `reduce(reduce(s, a1), a2)` and imperative `let s = ...; s = reduce(s, ...)`
 * patterns with a declarative pipeline.
 */
export const applyActions = (
  state: SessionState,
  actions: readonly BrowseAction[]
): SessionState => actions.reduce(reduce, state);
