import { describe, expect, it } from 'vitest';
import type { Annotation } from './schema.js';
import {
  type DiffMeta,
  type SessionState,
  clampCursor,
  clampLine,
  computeFocus,
  computeViewportOffset,
  findNearestVisibleIndex,
  halfPage,
  reduce,
  selectionRange,
} from './state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
  lineCount: 100,
  maxLineWidth: 120,
  viewportHeight: 20,
  cursorLine: 1,
  viewportOffset: 0,
  horizontalOffset: 0,
  mode: 'browse',
  annotations: [],
  expandedAnnotations: new Set(),
  focusedAnnotationId: null,
  viewMode: 'raw',
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

// ---------------------------------------------------------------------------
// toggle_annotation
// ---------------------------------------------------------------------------

describe('toggle_annotation', () => {
  it('expands a collapsed annotation', () => {
    const state = makeState({ expandedAnnotations: new Set() });
    const next = reduce(state, { type: 'toggle_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(true);
  });

  it('collapses an expanded annotation', () => {
    const state = makeState({ expandedAnnotations: new Set(['a1']) });
    const next = reduce(state, { type: 'toggle_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(false);
  });

  it('does not affect other expanded annotations', () => {
    const state = makeState({ expandedAnnotations: new Set(['a1', 'a2']) });
    const next = reduce(state, { type: 'toggle_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(false);
    expect(next.expandedAnnotations.has('a2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// delete_annotation
// ---------------------------------------------------------------------------

describe('delete_annotation', () => {
  it('removes annotation from list', () => {
    const ann = makeAnnotation({ id: 'a1' });
    const state = makeState({ annotations: [ann] });
    const next = reduce(state, { type: 'delete_annotation', annotationId: 'a1' });
    expect(next.annotations).toEqual([]);
  });

  it('removes from expanded set', () => {
    const ann = makeAnnotation({ id: 'a1' });
    const state = makeState({
      annotations: [ann],
      expandedAnnotations: new Set(['a1']),
    });
    const next = reduce(state, { type: 'delete_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(false);
  });

  it('does not affect other annotations', () => {
    const ann1 = makeAnnotation({ id: 'a1' });
    const ann2 = makeAnnotation({ id: 'a2', startLine: 20, endLine: 22 });
    const state = makeState({ annotations: [ann1, ann2] });
    const next = reduce(state, { type: 'delete_annotation', annotationId: 'a1' });
    expect(next.annotations).toEqual([ann2]);
  });
});

// ---------------------------------------------------------------------------
// update_annotation
// ---------------------------------------------------------------------------

describe('update_annotation', () => {
  it('updates comment', () => {
    const ann = makeAnnotation({ id: 'a1', comment: 'old' });
    const state = makeState({ annotations: [ann] });
    const next = reduce(state, {
      type: 'update_annotation',
      annotationId: 'a1',
      changes: { comment: 'new' },
    });
    expect(next.annotations[0]!.comment).toBe('new');
  });

  it('updates status', () => {
    const ann = makeAnnotation({ id: 'a1' });
    const state = makeState({ annotations: [ann] });
    const next = reduce(state, {
      type: 'update_annotation',
      annotationId: 'a1',
      changes: { status: 'approved' },
    });
    expect(next.annotations[0]!.status).toBe('approved');
  });

  it('does not affect other annotations', () => {
    const ann1 = makeAnnotation({ id: 'a1', comment: 'one' });
    const ann2 = makeAnnotation({ id: 'a2', comment: 'two', startLine: 20, endLine: 22 });
    const state = makeState({ annotations: [ann1, ann2] });
    const next = reduce(state, {
      type: 'update_annotation',
      annotationId: 'a1',
      changes: { comment: 'updated' },
    });
    expect(next.annotations[1]!.comment).toBe('two');
  });
});

// ---------------------------------------------------------------------------
// add_reply
// ---------------------------------------------------------------------------

describe('add_reply', () => {
  it('adds reply to annotation', () => {
    const ann = makeAnnotation({ id: 'a1' });
    const state = makeState({ annotations: [ann] });
    const next = reduce(state, {
      type: 'add_reply',
      annotationId: 'a1',
      reply: { comment: 'my reply', source: 'user' },
    });
    expect(next.annotations[0]!.replies).toEqual([
      { comment: 'my reply', source: 'user' },
    ]);
  });

  it('appends to existing replies', () => {
    const ann = makeAnnotation({
      id: 'a1',
      replies: [{ comment: 'first', source: 'agent' }],
    });
    const state = makeState({ annotations: [ann] });
    const next = reduce(state, {
      type: 'add_reply',
      annotationId: 'a1',
      reply: { comment: 'second', source: 'user' },
    });
    expect(next.annotations[0]!.replies).toHaveLength(2);
    expect(next.annotations[0]!.replies?.[1]?.comment).toBe('second');
  });

  it('does not affect other annotations', () => {
    const ann1 = makeAnnotation({ id: 'a1' });
    const ann2 = makeAnnotation({ id: 'a2', startLine: 20, endLine: 22 });
    const state = makeState({ annotations: [ann1, ann2] });
    const next = reduce(state, {
      type: 'add_reply',
      annotationId: 'a1',
      reply: { comment: 'reply', source: 'user' },
    });
    expect(next.annotations[1]!.replies).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Search actions
// ---------------------------------------------------------------------------

describe('reduce — set_search', () => {
  it('sets search state and jumps to first match at or after cursor', () => {
    const state = makeState({ cursorLine: 10 });
    const next = reduce(state, {
      type: 'set_search',
      pattern: 'foo',
      matchLines: [5, 15, 25],
    });
    expect(next.search).toEqual({
      pattern: 'foo',
      matchLines: [5, 15, 25],
      currentMatchIndex: 1,
    });
    expect(next.cursorLine).toBe(15);
  });

  it('wraps to first match if cursor is past all matches', () => {
    const state = makeState({ cursorLine: 30 });
    const next = reduce(state, {
      type: 'set_search',
      pattern: 'foo',
      matchLines: [5, 15, 25],
    });
    expect(next.search?.currentMatchIndex).toBe(0);
    expect(next.cursorLine).toBe(5);
  });

  it('handles zero matches', () => {
    const state = makeState({ cursorLine: 10 });
    const next = reduce(state, {
      type: 'set_search',
      pattern: 'notfound',
      matchLines: [],
    });
    expect(next.search).toEqual({
      pattern: 'notfound',
      matchLines: [],
      currentMatchIndex: -1,
    });
    expect(next.cursorLine).toBe(10); // cursor unchanged
  });
});

describe('reduce — clear_search', () => {
  it('removes search state', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5], currentMatchIndex: 0 },
    });
    const next = reduce(state, { type: 'clear_search' });
    expect(next.search).toBeUndefined();
  });
});

describe('reduce — navigate_match', () => {
  it('advances to next match', () => {
    const state = makeState({
      search: { pattern: 'x', matchLines: [5, 15, 25], currentMatchIndex: 0 },
    });
    const next = reduce(state, { type: 'navigate_match', delta: 1 });
    expect(next.search?.currentMatchIndex).toBe(1);
    expect(next.cursorLine).toBe(15);
  });

  it('wraps forward', () => {
    const state = makeState({
      search: { pattern: 'x', matchLines: [5, 15, 25], currentMatchIndex: 2 },
    });
    const next = reduce(state, { type: 'navigate_match', delta: 1 });
    expect(next.search?.currentMatchIndex).toBe(0);
    expect(next.cursorLine).toBe(5);
  });

  it('wraps backward', () => {
    const state = makeState({
      search: { pattern: 'x', matchLines: [5, 15, 25], currentMatchIndex: 0 },
    });
    const next = reduce(state, { type: 'navigate_match', delta: -1 });
    expect(next.search?.currentMatchIndex).toBe(2);
    expect(next.cursorLine).toBe(25);
  });

  it('no-ops with empty matches', () => {
    const state = makeState({
      search: { pattern: 'x', matchLines: [], currentMatchIndex: -1 },
    });
    const next = reduce(state, { type: 'navigate_match', delta: 1 });
    expect(next).toEqual(state);
  });

  it('no-ops without search state', () => {
    const state = makeState();
    const next = reduce(state, { type: 'navigate_match', delta: 1 });
    expect(next).toEqual(state);
  });
});

describe('reduce — scroll_viewport', () => {
  it('scrolls viewport down without moving cursor', () => {
    const state = makeState({ cursorLine: 15, viewportOffset: 5 });
    const next = reduce(state, { type: 'scroll_viewport', delta: 3 });
    expect(next.viewportOffset).toBe(8);
    expect(next.cursorLine).toBe(15);
  });

  it('scrolls viewport up without moving cursor', () => {
    const state = makeState({ cursorLine: 15, viewportOffset: 10 });
    const next = reduce(state, { type: 'scroll_viewport', delta: -3 });
    expect(next.viewportOffset).toBe(7);
    expect(next.cursorLine).toBe(15);
  });

  it('clamps viewport offset at 0', () => {
    const state = makeState({ cursorLine: 5, viewportOffset: 1 });
    const next = reduce(state, { type: 'scroll_viewport', delta: -5 });
    expect(next.viewportOffset).toBe(0);
  });

  it('clamps viewport offset at max', () => {
    // lineCount=100, viewportHeight=20 → maxOffset=80
    const state = makeState({ cursorLine: 90, viewportOffset: 79 });
    const next = reduce(state, { type: 'scroll_viewport', delta: 5 });
    expect(next.viewportOffset).toBe(80);
  });

  it('clamps cursor into viewport when scrolling past it', () => {
    // viewport at 5, viewportHeight=20, visible: lines 6..25
    // cursor at 6, scroll down 3 → viewport=8, visible: 9..28, cursor clamped to 9
    const state = makeState({ cursorLine: 6, viewportOffset: 5 });
    const next = reduce(state, { type: 'scroll_viewport', delta: 3 });
    expect(next.viewportOffset).toBe(8);
    expect(next.cursorLine).toBe(9);
  });

  it('clamps cursor when scrolling up past it', () => {
    // viewport at 20, viewportHeight=20, visible: 21..40
    // cursor at 40, scroll up 5 → viewport=15, visible: 16..35, cursor clamped to 35
    const state = makeState({ cursorLine: 40, viewportOffset: 20 });
    const next = reduce(state, { type: 'scroll_viewport', delta: -5 });
    expect(next.viewportOffset).toBe(15);
    expect(next.cursorLine).toBe(35);
  });
});

describe('reduce — scroll_horizontal', () => {
  it('increases horizontal offset', () => {
    const state = makeState({ horizontalOffset: 0 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: 4 });
    expect(next.horizontalOffset).toBe(4);
  });

  it('decreases horizontal offset', () => {
    const state = makeState({ horizontalOffset: 8 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: -4 });
    expect(next.horizontalOffset).toBe(4);
  });

  it('clamps at 0 when scrolling left past start', () => {
    const state = makeState({ horizontalOffset: 2 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: -10 });
    expect(next.horizontalOffset).toBe(0);
  });

  it('does not affect cursor or viewport offset', () => {
    const state = makeState({ cursorLine: 10, viewportOffset: 5, horizontalOffset: 0 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: 4 });
    expect(next.cursorLine).toBe(10);
    expect(next.viewportOffset).toBe(5);
  });

  it('caps at maxLineWidth + 20', () => {
    const state = makeState({ horizontalOffset: 0, maxLineWidth: 80 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: 200 });
    expect(next.horizontalOffset).toBe(100); // 80 + 20
  });

  it('caps at 0 when maxLineWidth is 0', () => {
    const state = makeState({ horizontalOffset: 0, maxLineWidth: 0 });
    const next = reduce(state, { type: 'scroll_horizontal', delta: 50 });
    expect(next.horizontalOffset).toBe(20); // 0 + 20
  });
});

// ---------------------------------------------------------------------------
// reset_horizontal

describe('reduce — reset_horizontal', () => {
  it('resets horizontalOffset to 0', () => {
    const state = makeState({ horizontalOffset: 42 });
    const next = reduce(state, { type: 'reset_horizontal' });
    expect(next.horizontalOffset).toBe(0);
  });

  it('is a no-op when already 0', () => {
    const state = makeState({ horizontalOffset: 0 });
    const next = reduce(state, { type: 'reset_horizontal' });
    expect(next.horizontalOffset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// collapse_all / expand_all

describe('reduce — collapse_all', () => {
  it('clears all expanded annotations', () => {
    const state = makeState({
      annotations: [makeAnnotation({ id: 'a' }), makeAnnotation({ id: 'b' })],
      expandedAnnotations: new Set(['a', 'b']),
    });
    const next = reduce(state, { type: 'collapse_all' });
    expect(next.expandedAnnotations.size).toBe(0);
  });

  it('is a no-op when none expanded', () => {
    const state = makeState({ expandedAnnotations: new Set() });
    const next = reduce(state, { type: 'collapse_all' });
    expect(next.expandedAnnotations.size).toBe(0);
  });
});

describe('reduce — expand_all', () => {
  it('expands all annotations', () => {
    const anns = [makeAnnotation({ id: 'a' }), makeAnnotation({ id: 'b' })];
    const state = makeState({ annotations: anns, expandedAnnotations: new Set() });
    const next = reduce(state, { type: 'expand_all' });
    expect(next.expandedAnnotations).toEqual(new Set(['a', 'b']));
  });

  it('is idempotent when all already expanded', () => {
    const anns = [makeAnnotation({ id: 'a' })];
    const state = makeState({ annotations: anns, expandedAnnotations: new Set(['a']) });
    const next = reduce(state, { type: 'expand_all' });
    expect(next.expandedAnnotations).toEqual(new Set(['a']));
  });
});

// ---------------------------------------------------------------------------
// applyActions

import { applyActions } from './state.js';

describe('applyActions', () => {
  it('applies multiple actions in sequence', () => {
    const state = makeState({ cursorLine: 1, mode: 'browse' });
    const next = applyActions(state, [
      { type: 'move_cursor', delta: 5 },
      { type: 'set_mode', mode: 'goto' },
    ]);
    expect(next.cursorLine).toBe(6);
    expect(next.mode).toBe('goto');
  });

  it('returns original state for empty actions list', () => {
    const state = makeState();
    const next = applyActions(state, []);
    expect(next).toBe(state);
  });

  it('composes start_select + extend_select correctly', () => {
    const state = makeState({ cursorLine: 10 });
    const next = applyActions(state, [
      { type: 'start_select' },
      { type: 'extend_select', delta: 3 },
    ]);
    expect(next.mode).toBe('select');
    expect(next.selection).toEqual({ anchor: 10, active: 13 });
    expect(next.cursorLine).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// computeFocus
// ---------------------------------------------------------------------------

describe('computeFocus', () => {
  const ann1 = makeAnnotation({ id: 'a1', startLine: 5, endLine: 8 });
  const ann2 = makeAnnotation({ id: 'a2', startLine: 5, endLine: 10 });

  it('returns null when no annotations on line', () => {
    expect(computeFocus(1, [ann1], new Set(['a1']))).toBeNull();
  });

  it('returns null when annotations exist but none expanded', () => {
    expect(computeFocus(5, [ann1], new Set())).toBeNull();
  });

  it('auto-focuses visually topmost expanded annotation on line', () => {
    // ann1 has lower endLine (8 < 10) → visually on top
    expect(computeFocus(5, [ann1, ann2], new Set(['a2']))).toBe('a2');
    expect(computeFocus(5, [ann1, ann2], new Set(['a1', 'a2']))).toBe('a1');
  });

  it('is deterministic regardless of arrival direction', () => {
    // Same result whether coming from above or below — no sticky focus
    expect(computeFocus(6, [ann1, ann2], new Set(['a1', 'a2']))).toBe('a1');
    expect(computeFocus(9, [ann1, ann2], new Set(['a1', 'a2']))).toBe('a2');
  });

  it('clears focus when only collapsed annotations on line', () => {
    expect(computeFocus(5, [ann1, ann2], new Set())).toBeNull();
  });

  it('focuses visually topmost (lowest endLine) regardless of array order', () => {
    // ann2 first in array, but ann1 has lower endLine → ann1 wins
    expect(computeFocus(5, [ann2, ann1], new Set(['a1', 'a2']))).toBe('a1');
  });

  it('breaks endLine tie with startLine', () => {
    const annA = makeAnnotation({ id: 'x', startLine: 3, endLine: 5 });
    const annB = makeAnnotation({ id: 'y', startLine: 1, endLine: 5 });
    // Both end at 5 → sort by startLine asc → annB (start=1) before annA (start=3)
    expect(computeFocus(4, [annA, annB], new Set(['x', 'y']))).toBe('y');
  });
});

// ---------------------------------------------------------------------------
// focusedAnnotationId integration
// ---------------------------------------------------------------------------

describe('focusedAnnotationId — reducer integration', () => {
  const ann1 = makeAnnotation({ id: 'a1', startLine: 5, endLine: 8 });
  const ann2 = makeAnnotation({ id: 'a2', startLine: 5, endLine: 10 });

  it('move_cursor auto-focuses expanded annotation on new line', () => {
    const state = makeState({
      cursorLine: 1,
      annotations: [ann1],
      expandedAnnotations: new Set(['a1']),
    });
    const next = reduce(state, { type: 'move_cursor', delta: 4 });
    expect(next.cursorLine).toBe(5);
    expect(next.focusedAnnotationId).toBe('a1');
  });

  it('move_cursor clears focus when leaving annotated range', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1],
      expandedAnnotations: new Set(['a1']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'set_cursor', line: 20 });
    expect(next.focusedAnnotationId).toBeNull();
  });

  it('toggle_annotation updates focus after expanding', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1],
      expandedAnnotations: new Set(),
    });
    const next = reduce(state, { type: 'toggle_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(true);
    expect(next.focusedAnnotationId).toBe('a1');
  });

  it('toggle_annotation clears focus after collapsing last expanded', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1],
      expandedAnnotations: new Set(['a1']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'toggle_annotation', annotationId: 'a1' });
    expect(next.expandedAnnotations.has('a1')).toBe(false);
    expect(next.focusedAnnotationId).toBeNull();
  });

  it('delete_annotation advances focus to next annotation on line', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['a1', 'a2']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'delete_annotation', annotationId: 'a1' });
    expect(next.focusedAnnotationId).toBe('a2');
  });

  it('delete_annotation clears focus when no annotations remain on line', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1],
      expandedAnnotations: new Set(['a1']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'delete_annotation', annotationId: 'a1' });
    expect(next.focusedAnnotationId).toBeNull();
  });

  it('collapse_all clears focus', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1],
      expandedAnnotations: new Set(['a1']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'collapse_all' });
    expect(next.focusedAnnotationId).toBeNull();
  });

  it('expand_all auto-focuses first expanded annotation on cursor line', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(),
    });
    const next = reduce(state, { type: 'expand_all' });
    expect(next.focusedAnnotationId).toBe('a1');
  });

  it('focus_annotation sets focus directly', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['a1', 'a2']),
    });
    const next = reduce(state, { type: 'focus_annotation', annotationId: 'a2' });
    expect(next.focusedAnnotationId).toBe('a2');
  });
});

// ---------------------------------------------------------------------------
// Diff mode helpers
// ---------------------------------------------------------------------------

/**
 * Helper: create a DiffMeta representing a diff with visible new-file lines.
 * newLineToRow maps each visible line to a sequential row index.
 */
const makeDiffMeta = (visibleLines: number[]): DiffMeta => {
  const newLineToRow = new Map<number, number>();
  visibleLines.forEach((ln, i) => newLineToRow.set(ln, i));
  return {
    rowCount: visibleLines.length + 2, // +2 for hunk headers / padding
    visibleLines,
    newLineToRow,
  };
};

// ---------------------------------------------------------------------------
// findNearestVisibleIndex
// ---------------------------------------------------------------------------

describe('findNearestVisibleIndex', () => {
  const vis = [3, 7, 10, 15, 20];

  it('returns exact match index', () => {
    expect(findNearestVisibleIndex(vis, 10)).toBe(2);
  });

  it('returns nearest when target is between values', () => {
    expect(findNearestVisibleIndex(vis, 8)).toBe(1); // 7 is closer than 10 (dist 1 vs 2)
    expect(findNearestVisibleIndex(vis, 9)).toBe(2); // 10 is closer than 7 (dist 1 vs 2)
  });

  it('returns 0 for target below all', () => {
    expect(findNearestVisibleIndex(vis, 1)).toBe(0);
  });

  it('returns last for target above all', () => {
    expect(findNearestVisibleIndex(vis, 100)).toBe(4);
  });

  it('returns -1 for empty array', () => {
    expect(findNearestVisibleIndex([], 5)).toBe(-1);
  });

  it('handles single-element array', () => {
    expect(findNearestVisibleIndex([10], 5)).toBe(0);
    expect(findNearestVisibleIndex([10], 15)).toBe(0);
    expect(findNearestVisibleIndex([10], 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clampCursor
// ---------------------------------------------------------------------------

describe('clampCursor', () => {
  it('snaps to nearest visible line in diff mode', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta: makeDiffMeta([3, 7, 10, 15, 20]),
    });
    expect(clampCursor(state, 8)).toBe(7);
    expect(clampCursor(state, 10)).toBe(10);
    expect(clampCursor(state, 1)).toBe(3);
    expect(clampCursor(state, 100)).toBe(20);
  });

  it('falls through to raw clamping in raw mode', () => {
    const state = makeState({ viewMode: 'raw', lineCount: 50 });
    expect(clampCursor(state, 0)).toBe(1);
    expect(clampCursor(state, 60)).toBe(50);
    expect(clampCursor(state, 25)).toBe(25);
  });

  it('falls through to raw clamping when diffMeta is absent', () => {
    const state = makeState({ viewMode: 'diff', lineCount: 50 });
    expect(clampCursor(state, 60)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// reduce — move_cursor in diff mode
// ---------------------------------------------------------------------------

describe('reduce — move_cursor (diff mode)', () => {
  const diffMeta = makeDiffMeta([3, 7, 10, 15, 20]);

  it('steps to next visible line with delta +1', () => {
    const state = makeState({ cursorLine: 7, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: 1 });
    expect(next.cursorLine).toBe(10);
  });

  it('steps to previous visible line with delta -1', () => {
    const state = makeState({ cursorLine: 10, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: -1 });
    expect(next.cursorLine).toBe(7);
  });

  it('clamps at first visible line', () => {
    const state = makeState({ cursorLine: 3, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: -5 });
    expect(next.cursorLine).toBe(3);
  });

  it('clamps at last visible line', () => {
    const state = makeState({ cursorLine: 20, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: 5 });
    expect(next.cursorLine).toBe(20);
  });

  it('jumps multiple visible lines with larger delta', () => {
    const state = makeState({ cursorLine: 3, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: 3 });
    expect(next.cursorLine).toBe(15);
  });

  it('handles cursor between visible lines (snaps first)', () => {
    // cursorLine=8 is not visible; nearest is index 1 (line 7)
    const state = makeState({ cursorLine: 8, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'move_cursor', delta: 1 });
    // From index 1 (7) + 1 → index 2 (10)
    expect(next.cursorLine).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// reduce — set_cursor in diff mode
// ---------------------------------------------------------------------------

describe('reduce — set_cursor (diff mode)', () => {
  const diffMeta = makeDiffMeta([3, 7, 10, 15, 20]);

  it('snaps to nearest visible line', () => {
    const state = makeState({ cursorLine: 3, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'set_cursor', line: 12 });
    expect(next.cursorLine).toBe(10);
  });

  it('snaps to first visible line for line 1', () => {
    const state = makeState({ cursorLine: 10, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'set_cursor', line: 1 });
    expect(next.cursorLine).toBe(3);
  });

  it('snaps to last visible line for very large line', () => {
    const state = makeState({ cursorLine: 3, viewMode: 'diff', diffMeta });
    const next = reduce(state, { type: 'set_cursor', line: 999 });
    expect(next.cursorLine).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// reduce — toggle_view_mode
// ---------------------------------------------------------------------------

describe('reduce — toggle_view_mode', () => {
  const diffMeta = makeDiffMeta([3, 7, 10, 15, 20]);

  it('toggles from raw to diff', () => {
    const state = makeState({ viewMode: 'raw', diffMeta });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next.viewMode).toBe('diff');
  });

  it('toggles from diff to raw', () => {
    const state = makeState({ viewMode: 'diff', diffMeta, cursorLine: 10 });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next.viewMode).toBe('raw');
    expect(next.cursorLine).toBe(10); // preserved
  });

  it('snaps cursor to nearest visible line when switching to diff', () => {
    const state = makeState({ viewMode: 'raw', diffMeta, cursorLine: 12 });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next.viewMode).toBe('diff');
    expect(next.cursorLine).toBe(10); // nearest visible
  });

  it('is a no-op without diffMeta', () => {
    const state = makeState({ viewMode: 'raw' });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next).toBe(state);
  });

  it('preserves expanded annotations across toggle', () => {
    const ann = makeAnnotation({ id: 'a1', startLine: 5, endLine: 10 });
    const state = makeState({
      viewMode: 'raw',
      diffMeta,
      cursorLine: 7,
      annotations: [ann],
      expandedAnnotations: new Set(['a1']),
    });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next.expandedAnnotations.has('a1')).toBe(true);
  });

  it('recomputes focus on toggle', () => {
    const ann = makeAnnotation({ id: 'a1', startLine: 5, endLine: 10 });
    const state = makeState({
      viewMode: 'raw',
      diffMeta,
      cursorLine: 7,
      annotations: [ann],
      expandedAnnotations: new Set(['a1']),
      focusedAnnotationId: 'a1',
    });
    const next = reduce(state, { type: 'toggle_view_mode' });
    expect(next.focusedAnnotationId).toBe('a1'); // still on the annotation
  });
});

// ---------------------------------------------------------------------------
// reduce — extend_select in diff mode
// ---------------------------------------------------------------------------

describe('reduce — extend_select (diff mode)', () => {
  const diffMeta = makeDiffMeta([3, 7, 10, 15, 20]);

  it('extends selection through visible lines only', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta,
      cursorLine: 7,
      mode: 'select',
      selection: { anchor: 7, active: 7 },
    });
    const next = reduce(state, { type: 'extend_select', delta: 2 });
    expect(next.selection?.active).toBe(15);
    expect(next.cursorLine).toBe(15);
  });

  it('clamps at first visible line', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta,
      cursorLine: 7,
      mode: 'select',
      selection: { anchor: 10, active: 7 },
    });
    const next = reduce(state, { type: 'extend_select', delta: -5 });
    expect(next.selection?.active).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// reduce — scroll_viewport in diff mode
// ---------------------------------------------------------------------------

describe('reduce — scroll_viewport (diff mode)', () => {
  const diffMeta = makeDiffMeta([3, 7, 10, 15, 20]);

  it('uses diffMeta.rowCount for max offset', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta,
      viewportHeight: 5,
      viewportOffset: 0,
      cursorLine: 3,
    });
    // rowCount = 7 (5 visible + 2 hunk headers)
    const next = reduce(state, { type: 'scroll_viewport', delta: 10 });
    expect(next.viewportOffset).toBe(2); // max(0, 7 - 5) = 2
  });

  it('does not clamp cursor in diff mode (cursor stays put)', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta,
      viewportHeight: 5,
      viewportOffset: 0,
      cursorLine: 7,
    });
    const next = reduce(state, { type: 'scroll_viewport', delta: 1 });
    expect(next.cursorLine).toBe(7); // unchanged
  });
});
