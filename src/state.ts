import * as R from 'remeda';
import type { Annotation } from './schema.js';

// --- Flow sub-states ---
// These describe modal UI flows that overlay the main browse state.
// They live here (not in render.ts) because they are state concerns
// consumed by both the reducer/dispatch layer and the renderer.

export type AnnotationFlowState = {
  readonly step: 'intent' | 'category' | 'comment';
  readonly intent?: string;
  readonly category?: string;
  readonly comment: string;
};

export const INITIAL_ANNOTATION_FLOW: AnnotationFlowState = {
  step: 'intent',
  comment: '',
};

export type GotoFlowState = {
  /** Digits entered so far. */
  readonly input: string;
};

export const INITIAL_GOTO_FLOW: GotoFlowState = { input: '' };

export type Mode = 'browse' | 'decide' | 'annotate' | 'goto' | 'select';

export type Selection = {
  /** The line where selection started (1-indexed). */
  readonly anchor: number;
  /** The moving end of the selection (1-indexed). Tracks the cursor. */
  readonly active: number;
};

export type BrowseState = {
  readonly lineCount: number;
  readonly viewportHeight: number;
  readonly cursorLine: number;
  readonly viewportOffset: number;
  readonly mode: Mode;
  readonly annotations: readonly Annotation[];
  /** Present only in 'select' mode. */
  readonly selection?: Selection;
};

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
  | { type: 'cancel_select' };

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

const recomputeOffset = (state: BrowseState, viewportHeight: number): number =>
  computeViewportOffset({
    cursorLine: state.cursorLine,
    currentOffset: state.viewportOffset,
    viewportHeight,
    lineCount: state.lineCount,
  });

export const reduce = (state: BrowseState, action: BrowseAction): BrowseState => {
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
  }
};
