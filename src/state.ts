import * as R from 'remeda';
import type { Annotation } from './schema.js';

export type Mode = 'browse' | 'decide' | 'annotate';

export type BrowseState = {
  readonly lineCount: number;
  readonly viewportHeight: number;
  cursorLine: number;
  viewportOffset: number;
  mode: Mode;
  annotations: Annotation[];
};

// Standard useReducer-compatible signature: (state, action) => state.
export type BrowseAction =
  | { type: 'move_cursor'; delta: number }
  | { type: 'set_mode'; mode: Mode }
  | { type: 'add_annotation'; annotation: Annotation }
  | { type: 'update_viewport'; viewportHeight: number };

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
  }
};
