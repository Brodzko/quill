import * as R from 'remeda';
import type { Annotation } from './schema.js';

export type Mode = 'browse' | 'decide';

export type BrowseState = {
  cursorLine: number;
  viewportOffset: number;
  mode: Mode;
  annotations: Annotation[];
};

// Discriminated union of every valid state transition.
// Shape is intentionally useReducer-compatible for the Ink migration.
export type BrowseAction =
  | { type: 'move_cursor'; delta: number }
  | { type: 'set_mode'; mode: Mode }
  | { type: 'add_annotation'; annotation: Annotation };

export const clampLine = (value: number, lineCount: number): number =>
  R.clamp(value, { min: 1, max: Math.max(1, lineCount) });

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

// lineCount and viewportHeight are passed explicitly rather than closed over so
// the reducer stays a pure function with no I/O side effects.
export const reduce = (
  state: BrowseState,
  action: BrowseAction,
  lineCount: number,
  viewportHeight: number
): BrowseState => {
  switch (action.type) {
    case 'move_cursor': {
      const cursorLine = clampLine(
        state.cursorLine + action.delta,
        lineCount
      );
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight,
        lineCount,
      });
      return { ...state, cursorLine, viewportOffset };
    }
    case 'set_mode': {
      // Recompute viewportOffset because header height changes between modes
      // (decide mode adds the decision hint line).
      const viewportOffset = computeViewportOffset({
        cursorLine: state.cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight,
        lineCount,
      });
      return { ...state, mode: action.mode, viewportOffset };
    }
    case 'add_annotation':
      return {
        ...state,
        annotations: [...state.annotations, action.annotation],
      };
  }
};
