import { describe, expect, it } from 'vitest';
import type { Annotation } from './schema.js';
import {
  type BrowseState,
  clampLine,
  computeViewportOffset,
  halfPage,
  reduce,
  selectionRange,
} from './state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeState = (overrides: Partial<BrowseState> = {}): BrowseState => ({
  lineCount: 100,
  viewportHeight: 20,
  cursorLine: 1,
  viewportOffset: 0,
  mode: 'browse',
  annotations: [],
  ...overrides,
});

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'ann-1',
  startLine: 10,
  endLine: 12,
  intent: 'comment',
  comment: 'test',
  source: 'user',
  ...overrides,
});

// ---------------------------------------------------------------------------
// clampLine
// ---------------------------------------------------------------------------

describe('clampLine', () => {
  it('clamps below 1 to 1', () => {
    expect(clampLine(0, 50)).toBe(1);
    expect(clampLine(-5, 50)).toBe(1);
  });

  it('clamps above lineCount to lineCount', () => {
    expect(clampLine(51, 50)).toBe(50);
    expect(clampLine(999, 50)).toBe(50);
  });

  it('passes through values in range', () => {
    expect(clampLine(25, 50)).toBe(25);
    expect(clampLine(1, 50)).toBe(1);
    expect(clampLine(50, 50)).toBe(50);
  });

  it('handles lineCount of 0 gracefully (min 1)', () => {
    expect(clampLine(1, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeViewportOffset
// ---------------------------------------------------------------------------

describe('computeViewportOffset', () => {
  const SCROLL_OFF = 3;

  it('keeps offset when cursor is within the safe zone', () => {
    const offset = computeViewportOffset({
      cursorLine: 10,
      currentOffset: 5,
      viewportHeight: 20,
      lineCount: 100,
    });
    // cursorIndex=9, within [5+3, 5+20-3) = [8, 22) → no change
    expect(offset).toBe(5);
  });

  it('scrolls up when cursor moves above the scroll-off zone', () => {
    const offset = computeViewportOffset({
      cursorLine: 4,
      currentOffset: 5,
      viewportHeight: 20,
      lineCount: 100,
    });
    // cursorIndex=3, < 5+3=8 → scrolls up
    expect(offset).toBe(3 - SCROLL_OFF); // 0
  });

  it('scrolls down when cursor moves below the scroll-off zone', () => {
    const offset = computeViewportOffset({
      cursorLine: 26,
      currentOffset: 5,
      viewportHeight: 20,
      lineCount: 100,
    });
    // cursorIndex=25, >= 5+20-3=22 → scrolls down
    expect(offset).toBe(25 - 20 + SCROLL_OFF + 1); // 9
  });

  it('does not scroll past the end of the file', () => {
    const offset = computeViewportOffset({
      cursorLine: 100,
      currentOffset: 70,
      viewportHeight: 20,
      lineCount: 100,
    });
    // maxOffset = 100 - 20 = 80
    expect(offset).toBeLessThanOrEqual(80);
  });

  it('does not produce negative offset', () => {
    const offset = computeViewportOffset({
      cursorLine: 1,
      currentOffset: 0,
      viewportHeight: 20,
      lineCount: 100,
    });
    expect(offset).toBe(0);
  });

  it('handles file shorter than viewport', () => {
    const offset = computeViewportOffset({
      cursorLine: 5,
      currentOffset: 0,
      viewportHeight: 20,
      lineCount: 10,
    });
    expect(offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reduce — move_cursor
// ---------------------------------------------------------------------------

describe('reduce — move_cursor', () => {
  it('moves cursor down by delta', () => {
    const state = makeState({ cursorLine: 1 });
    const next = reduce(state, { type: 'move_cursor', delta: 5 });
    expect(next.cursorLine).toBe(6);
  });

  it('moves cursor up by negative delta', () => {
    const state = makeState({ cursorLine: 10 });
    const next = reduce(state, { type: 'move_cursor', delta: -3 });
    expect(next.cursorLine).toBe(7);
  });

  it('clamps to line 1 when moving above top', () => {
    const state = makeState({ cursorLine: 3 });
    const next = reduce(state, { type: 'move_cursor', delta: -10 });
    expect(next.cursorLine).toBe(1);
  });

  it('clamps to lineCount when moving below bottom', () => {
    const state = makeState({ cursorLine: 98, lineCount: 100 });
    const next = reduce(state, { type: 'move_cursor', delta: 10 });
    expect(next.cursorLine).toBe(100);
  });

  it('recomputes viewport offset after move', () => {
    const state = makeState({ cursorLine: 1, viewportOffset: 0 });
    const next = reduce(state, { type: 'move_cursor', delta: 50 });
    expect(next.viewportOffset).toBeGreaterThan(0);
  });

  it('does not mutate the original state', () => {
    const state = makeState({ cursorLine: 5 });
    const next = reduce(state, { type: 'move_cursor', delta: 1 });
    expect(state.cursorLine).toBe(5);
    expect(next.cursorLine).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// reduce — set_cursor
// ---------------------------------------------------------------------------

describe('reduce — set_cursor', () => {
  it('jumps to an absolute line', () => {
    const state = makeState({ cursorLine: 1 });
    const next = reduce(state, { type: 'set_cursor', line: 50 });
    expect(next.cursorLine).toBe(50);
  });

  it('clamps to line 1 when target is below 1', () => {
    const state = makeState({ cursorLine: 50 });
    const next = reduce(state, { type: 'set_cursor', line: -5 });
    expect(next.cursorLine).toBe(1);
  });

  it('clamps to lineCount when target exceeds it', () => {
    const state = makeState({ cursorLine: 1, lineCount: 100 });
    const next = reduce(state, { type: 'set_cursor', line: 999 });
    expect(next.cursorLine).toBe(100);
  });

  it('recomputes viewport offset', () => {
    const state = makeState({ cursorLine: 1, viewportOffset: 0 });
    const next = reduce(state, { type: 'set_cursor', line: 80 });
    expect(next.viewportOffset).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// reduce — set_mode
// ---------------------------------------------------------------------------

describe('reduce — set_mode', () => {
  it('transitions to decide mode', () => {
    const state = makeState({ mode: 'browse' });
    const next = reduce(state, { type: 'set_mode', mode: 'decide' });
    expect(next.mode).toBe('decide');
  });

  it('transitions to annotate mode', () => {
    const state = makeState({ mode: 'browse' });
    const next = reduce(state, { type: 'set_mode', mode: 'annotate' });
    expect(next.mode).toBe('annotate');
  });

  it('transitions to goto mode', () => {
    const state = makeState({ mode: 'browse' });
    const next = reduce(state, { type: 'set_mode', mode: 'goto' });
    expect(next.mode).toBe('goto');
  });

  it('transitions back to browse', () => {
    const state = makeState({ mode: 'decide' });
    const next = reduce(state, { type: 'set_mode', mode: 'browse' });
    expect(next.mode).toBe('browse');
  });
});

// ---------------------------------------------------------------------------
// reduce — add_annotation
// ---------------------------------------------------------------------------

describe('reduce — add_annotation', () => {
  it('appends an annotation', () => {
    const state = makeState();
    const annotation = makeAnnotation();
    const next = reduce(state, { type: 'add_annotation', annotation });
    expect(next.annotations).toHaveLength(1);
    expect(next.annotations[0]).toEqual(annotation);
  });

  it('preserves existing annotations', () => {
    const existing = makeAnnotation({ id: 'existing' });
    const state = makeState({ annotations: [existing] });
    const newAnn = makeAnnotation({ id: 'new' });
    const next = reduce(state, { type: 'add_annotation', annotation: newAnn });
    expect(next.annotations).toHaveLength(2);
    expect(next.annotations[0]!.id).toBe('existing');
    expect(next.annotations[1]!.id).toBe('new');
  });

  it('does not mutate original annotations array', () => {
    const state = makeState({ annotations: [] });
    reduce(state, { type: 'add_annotation', annotation: makeAnnotation() });
    expect(state.annotations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reduce — update_viewport
// ---------------------------------------------------------------------------

describe('reduce — update_viewport', () => {
  it('updates viewportHeight', () => {
    const state = makeState({ viewportHeight: 20 });
    const next = reduce(state, { type: 'update_viewport', viewportHeight: 30 });
    expect(next.viewportHeight).toBe(30);
  });

  it('recomputes viewport offset for new height', () => {
    // Cursor near the bottom with a tall viewport → offset should adjust
    const state = makeState({
      cursorLine: 95,
      viewportHeight: 20,
      viewportOffset: 78,
      lineCount: 100,
    });
    const next = reduce(state, { type: 'update_viewport', viewportHeight: 10 });
    expect(next.viewportOffset).not.toBe(state.viewportOffset);
  });
});

// ---------------------------------------------------------------------------
// selectionRange
// ---------------------------------------------------------------------------

describe('selectionRange', () => {
  it('returns ordered range when anchor < active', () => {
    expect(selectionRange({ anchor: 5, active: 10 })).toEqual({
      startLine: 5,
      endLine: 10,
    });
  });

  it('returns ordered range when anchor > active', () => {
    expect(selectionRange({ anchor: 10, active: 5 })).toEqual({
      startLine: 5,
      endLine: 10,
    });
  });

  it('returns single-line range when anchor === active', () => {
    expect(selectionRange({ anchor: 7, active: 7 })).toEqual({
      startLine: 7,
      endLine: 7,
    });
  });
});

// ---------------------------------------------------------------------------
// reduce — start_select
// ---------------------------------------------------------------------------

describe('reduce — start_select', () => {
  it('enters select mode with anchor and active at cursor', () => {
    const state = makeState({ cursorLine: 15 });
    const next = reduce(state, { type: 'start_select' });
    expect(next.mode).toBe('select');
    expect(next.selection).toEqual({ anchor: 15, active: 15 });
  });

  it('does not change cursorLine', () => {
    const state = makeState({ cursorLine: 15 });
    const next = reduce(state, { type: 'start_select' });
    expect(next.cursorLine).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// reduce — extend_select
// ---------------------------------------------------------------------------

describe('reduce — extend_select', () => {
  it('moves active by delta', () => {
    const state = makeState({
      cursorLine: 10,
      mode: 'select',
      selection: { anchor: 10, active: 10 },
    });
    const next = reduce(state, { type: 'extend_select', delta: 3 });
    expect(next.selection?.active).toBe(13);
    expect(next.selection?.anchor).toBe(10);
    expect(next.cursorLine).toBe(13);
  });

  it('extends upward with negative delta', () => {
    const state = makeState({
      cursorLine: 10,
      mode: 'select',
      selection: { anchor: 10, active: 10 },
    });
    const next = reduce(state, { type: 'extend_select', delta: -5 });
    expect(next.selection?.active).toBe(5);
    expect(next.selection?.anchor).toBe(10);
    expect(next.cursorLine).toBe(5);
  });

  it('clamps active to line 1', () => {
    const state = makeState({
      cursorLine: 3,
      mode: 'select',
      selection: { anchor: 5, active: 3 },
    });
    const next = reduce(state, { type: 'extend_select', delta: -10 });
    expect(next.selection?.active).toBe(1);
    expect(next.cursorLine).toBe(1);
  });

  it('clamps active to lineCount', () => {
    const state = makeState({
      cursorLine: 98,
      lineCount: 100,
      mode: 'select',
      selection: { anchor: 95, active: 98 },
    });
    const next = reduce(state, { type: 'extend_select', delta: 10 });
    expect(next.selection?.active).toBe(100);
    expect(next.cursorLine).toBe(100);
  });

  it('is a no-op when selection is undefined', () => {
    const state = makeState({ cursorLine: 10 });
    const next = reduce(state, { type: 'extend_select', delta: 5 });
    expect(next).toBe(state);
  });

  it('recomputes viewport offset', () => {
    const state = makeState({
      cursorLine: 1,
      viewportOffset: 0,
      mode: 'select',
      selection: { anchor: 1, active: 1 },
    });
    const next = reduce(state, { type: 'extend_select', delta: 50 });
    expect(next.viewportOffset).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// reduce — confirm_select
// ---------------------------------------------------------------------------

describe('reduce — confirm_select', () => {
  it('transitions to annotate mode, keeps selection', () => {
    const state = makeState({
      mode: 'select',
      selection: { anchor: 5, active: 10 },
    });
    const next = reduce(state, { type: 'confirm_select' });
    expect(next.mode).toBe('annotate');
    expect(next.selection).toEqual({ anchor: 5, active: 10 });
  });
});

// ---------------------------------------------------------------------------
// reduce — cancel_select
// ---------------------------------------------------------------------------

describe('reduce — cancel_select', () => {
  it('returns to browse mode and clears selection', () => {
    const state = makeState({
      mode: 'select',
      selection: { anchor: 5, active: 10 },
    });
    const next = reduce(state, { type: 'cancel_select' });
    expect(next.mode).toBe('browse');
    expect(next.selection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// halfPage
// ---------------------------------------------------------------------------

describe('halfPage', () => {
  it('returns half the viewport height', () => {
    expect(halfPage(20)).toBe(10);
  });

  it('floors odd viewport heights', () => {
    expect(halfPage(21)).toBe(10);
  });

  it('returns minimum of 1 for very small viewports', () => {
    expect(halfPage(1)).toBe(1);
    expect(halfPage(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — single-line and zero-line files
// ---------------------------------------------------------------------------

describe('edge cases — single-line file', () => {
  it('cursor stays at 1 when moving down', () => {
    const state = makeState({ lineCount: 1, cursorLine: 1 });
    const next = reduce(state, { type: 'move_cursor', delta: 1 });
    expect(next.cursorLine).toBe(1);
  });

  it('cursor stays at 1 when moving up', () => {
    const state = makeState({ lineCount: 1, cursorLine: 1 });
    const next = reduce(state, { type: 'move_cursor', delta: -1 });
    expect(next.cursorLine).toBe(1);
  });

  it('set_cursor clamps to 1', () => {
    const state = makeState({ lineCount: 1, cursorLine: 1 });
    const next = reduce(state, { type: 'set_cursor', line: 99 });
    expect(next.cursorLine).toBe(1);
  });
});

describe('edge cases — zero-line file', () => {
  it('cursor is 1 (minimum)', () => {
    const state = makeState({ lineCount: 0, cursorLine: 1 });
    const next = reduce(state, { type: 'move_cursor', delta: 5 });
    expect(next.cursorLine).toBe(1);
  });

  it('viewport offset is 0', () => {
    const state = makeState({ lineCount: 0, cursorLine: 1 });
    const next = reduce(state, { type: 'move_cursor', delta: 5 });
    expect(next.viewportOffset).toBe(0);
  });
});
