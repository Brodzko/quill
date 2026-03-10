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
import type { Annotation, KnownCategory, KnownIntent, SessionResult } from './schema.js';
import {
  type AnnotationFlowState,
  type ConfirmFlowState,
  type DecideFlowState,
  type EditFlowState,
  type GotoFlowState,
  type ReplyFlowState,
  type SearchFlowState,
  type SessionState,
  INITIAL_ANNOTATION_FLOW,
  INITIAL_CONFIRM_FLOW,
  INITIAL_DECIDE_FLOW,
  INITIAL_EDIT_FLOW,
  INITIAL_GOTO_FLOW,
  INITIAL_REPLY_FLOW,
  INITIAL_SEARCH_FLOW,
  applyActions,
  halfPage,
  nudgeForAnnotationBox,
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
import { BROWSE, SELECT, PICKER } from './keymap.js';
import type { CollapsedRegion, RegionExpansion } from './diff-align.js';
import { findRegionForLine, isLineRevealed, autoExpandForLine } from './diff-align.js';
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
  readonly state: SessionState;
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
  state: SessionState,
  flow: AnnotationFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: { ...state, mode: 'browse', selection: undefined, annotationFlow: undefined },
    };
  }

  // --- Intent picker step ---
  if (flow.step === 'intent') {
    // Arrow navigation
    if (PICKER.up.match(key)) {
      return {
        state: { ...state, annotationFlow: { ...flow, picker: moveHighlight(flow.picker, -1) } },
      };
    }
    if (PICKER.down.match(key)) {
      return {
        state: { ...state, annotationFlow: { ...flow, picker: moveHighlight(flow.picker, 1) } },
      };
    }

    // Enter confirms highlighted
    if (PICKER.confirm.match(key)) {
      const selected = getHighlighted(flow.picker);
      if (selected) {
        return {
          state: {
            ...state,
            annotationFlow: {
              ...flow,
              step: 'category',
              intent: selected.id,
              picker: createPicker(CATEGORY_OPTIONS),
            },
          },
        };
      }
      return { state: { ...state, annotationFlow: flow } };
    }

    // Direct shortcut
    const matched = findByShortcut(flow.picker, key.char);
    if (matched) {
      return {
        state: {
          ...state,
          annotationFlow: {
            ...flow,
            step: 'category',
            intent: matched.id,
            picker: createPicker(CATEGORY_OPTIONS),
          },
        },
      };
    }

    return { state: { ...state, annotationFlow: flow } };
  }

  // --- Category picker step ---
  if (flow.step === 'category') {
    // Arrow navigation
    if (PICKER.up.match(key)) {
      return {
        state: { ...state, annotationFlow: { ...flow, picker: moveHighlight(flow.picker, -1) } },
      };
    }
    if (PICKER.down.match(key)) {
      return {
        state: { ...state, annotationFlow: { ...flow, picker: moveHighlight(flow.picker, 1) } },
      };
    }

    // Enter confirms highlighted or skips
    if (PICKER.confirm.match(key)) {
      const selected = getHighlighted(flow.picker);
      return {
        state: {
          ...state,
          annotationFlow: {
            ...flow,
            step: 'comment',
            category: selected?.id || undefined,
          },
        },
      };
    }

    // Direct shortcut
    const matched = findByShortcut(flow.picker, key.char);
    if (matched) {
      return {
        state: {
          ...state,
          annotationFlow: {
            ...flow,
            step: 'comment',
            category: matched.id || undefined,
          },
        },
      };
    }

    return { state: { ...state, annotationFlow: flow } };
  }

  // --- Comment textbox step ---
  // Enter submits
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0 && flow.intent) {
      const range = state.selection
        ? selectionRange(state.selection)
        : { startLine: state.cursorLine, endLine: state.cursorLine };
      const newId = randomUUID();
      const nextState = applyActions(state, [
        {
          type: 'add_annotation',
          annotation: {
            id: newId,
            ...range,
            intent: flow.intent as KnownIntent,
            category: flow.category as KnownCategory | undefined,
            comment: trimmed,
            source: 'user',
          },
        },
        { type: 'toggle_annotation', annotationId: newId },
        { type: 'focus_annotation', annotationId: newId },
      ]);
      return {
        state: { ...nextState, mode: 'browse', selection: undefined, annotationFlow: undefined },
      };
    }
    return { state: { ...state, annotationFlow: flow } };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state: { ...state, annotationFlow: { ...flow, comment: updatedBuf } } };
  }

  return { state: { ...state, annotationFlow: flow } };
};

// --- Goto mode ---

export const handleGotoKey = (
  key: Key,
  state: SessionState,
  flow: GotoFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), gotoFlow: undefined },
    };
  }

  if (key.return) {
    const target = parseInt(flow.input, 10);
    // Auto-expand region if goto target is in a collapsed region
    const baseState = !Number.isNaN(target) && target > 0
      ? autoExpandIfNeeded(state, target)
      : state;
    const actions = [
      { type: 'set_mode' as const, mode: 'browse' as const },
      ...(!Number.isNaN(target) && target > 0
        ? [{ type: 'set_cursor' as const, line: target }]
        : []),
    ];
    return { state: { ...applyActions(baseState, actions), gotoFlow: undefined } };
  }

  if (key.backspace) {
    return { state: { ...state, gotoFlow: { input: flow.input.slice(0, -1) } } };
  }

  if (key.char >= '0' && key.char <= '9') {
    return { state: { ...state, gotoFlow: { input: flow.input + key.char } } };
  }

  return { state: { ...state, gotoFlow: flow } };
};

// --- Select mode ---

export const handleSelectKey = (
  key: Key,
  state: SessionState
): DispatchResult => {
  if (SELECT.cancel.match(key)) {
    return { state: reduce(state, { type: 'cancel_select' }) };
  }

  if (SELECT.confirm.match(key)) {
    return {
      state: { ...reduce(state, { type: 'confirm_select' }), annotationFlow: { ...INITIAL_ANNOTATION_FLOW } },
    };
  }

  if (SELECT.extendUp.match(key)) {
    return { state: reduce(state, { type: 'extend_select', delta: -1 }) };
  }
  if (SELECT.extendDown.match(key)) {
    return { state: reduce(state, { type: 'extend_select', delta: 1 }) };
  }

  if (SELECT.extendHalfPageUp.match(key)) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'extend_select', delta: -hp }) };
  }
  if (SELECT.extendHalfPageDown.match(key)) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'extend_select', delta: hp }) };
  }

  return { state };
};

// --- Annotation jump helper ---

/**
 * Sort annotations in Tab-cycle order: by endLine asc, startLine asc, array index.
 * Returns a new sorted array (does not mutate).
 */
const sortedAnnotations = (annotations: readonly Annotation[]): Annotation[] =>
  annotations
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.endLine - y.a.endLine || x.a.startLine - y.a.startLine || x.i - y.i)
    .map((x) => x.a);

/**
 * Jump to the next (direction=1) or previous (direction=-1) individual annotation,
 * cycling through a flat sorted list. Moves cursor to the target annotation's endLine,
 * expands it, and focuses it. Does NOT collapse the previously focused annotation
 * (the user uses `c` for that).
 */
const jumpToNextAnnotation = (
  state: SessionState,
  direction: 1 | -1
): DispatchResult => {
  if (state.annotations.length === 0) return { state };

  const sorted = sortedAnnotations(state.annotations);
  const currentIdx = state.focusedAnnotationId !== null
    ? sorted.findIndex((a) => a.id === state.focusedAnnotationId)
    : -1;

  let nextIdx: number;
  if (currentIdx === -1) {
    // No current focus — pick the first annotation after cursor line, or first overall
    if (direction === 1) {
      const after = sorted.findIndex((a) => a.endLine >= state.cursorLine);
      nextIdx = after >= 0 ? after : 0;
    } else {
      const before = R.pipe(
        sorted,
        R.findLastIndex((a) => a.endLine <= state.cursorLine),
      );
      nextIdx = before >= 0 ? before : sorted.length - 1;
    }
  } else {
    nextIdx = ((currentIdx + direction) % sorted.length + sorted.length) % sorted.length;
  }

  const target = sorted[nextIdx]!;
  const targetLine = target.endLine;

  // Auto-expand region if target endLine is in a collapsed region
  const expandedState = autoExpandIfNeeded(state, targetLine);

  // Expand the target annotation if not already expanded, move cursor, set focus
  const expandAction = expandedState.expandedAnnotations.has(target.id)
    ? []
    : [{ type: 'toggle_annotation' as const, annotationId: target.id }];

  const nextState = applyActions(expandedState, [
    { type: 'set_cursor', line: targetLine },
    ...expandAction,
    { type: 'focus_annotation', annotationId: target.id },
  ]);

  // Final nudge: ensure the focused annotation box (below endLine) plus
  // padding fits in the viewport. Works for both raw and diff modes.
  const adjusted = nudgeForAnnotationBox(nextState, target, nextState.expandedAnnotations);
  if (adjusted !== nextState.viewportOffset) {
    return { state: { ...nextState, viewportOffset: adjusted } };
  }

  return { state: nextState };
};

// --- Auto-expand helper ---

/**
 * If the target line is in a collapsed region, dispatch the necessary expansion.
 * Returns an updated state with the region auto-expanded, or the original state if not needed.
 */
const autoExpandIfNeeded = (state: SessionState, targetLine: number): SessionState => {
  if (!state.baseDiffData || !state.diffMeta?.collapsedRegions) return state;

  const region = findRegionForLine(state.diffMeta.collapsedRegions, targetLine);
  if (!region) return state;

  const expandedRegions = state.expandedRegions ?? new Map<number, RegionExpansion>();
  const current = expandedRegions.get(region.index) ?? { fromTop: 0, fromBottom: 0 };

  // Check if already revealed
  if (isLineRevealed(region, current, targetLine)) return state;

  const expansion = autoExpandForLine(targetLine, region, current);
  const nextMap = new Map(expandedRegions);
  nextMap.set(region.index, expansion);
  return reduce(state, { type: 'set_expanded_regions', expandedRegions: nextMap });
};

// --- Region expansion helpers ---

const EXPAND_STEP = 20;

/**
 * Find the nearest collapsed region below the cursor (for `]` key).
 * Scans regions to find the first one whose line range starts at or after
 * the cursor. Accounts for already-expanded top portions.
 */
const findNearestRegionBelow = (
  cursorLine: number,
  regions: readonly CollapsedRegion[],
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
): CollapsedRegion | undefined => {
  for (const region of regions) {
    const expansion = expandedRegions.get(region.index);
    const fromTop = expansion ? Math.min(expansion.fromTop, region.lineCount) : 0;
    const fromBottom = expansion ? Math.min(expansion.fromBottom, Math.max(0, region.lineCount - fromTop)) : 0;
    const remaining = region.lineCount - fromTop - fromBottom;
    if (remaining <= 0) continue; // fully expanded

    // The effective collapsed start is after any top-expanded lines
    const effectiveStart = region.newStartLine + fromTop;
    if (effectiveStart >= cursorLine) return region;
  }
  return undefined;
};

/**
 * Find the nearest collapsed region above the cursor (for `[` key).
 * Scans regions in reverse to find the first one whose line range ends
 * at or before the cursor. Accounts for already-expanded bottom portions.
 */
const findNearestRegionAbove = (
  cursorLine: number,
  regions: readonly CollapsedRegion[],
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
): CollapsedRegion | undefined => {
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i]!;
    const expansion = expandedRegions.get(region.index);
    const fromTop = expansion ? Math.min(expansion.fromTop, region.lineCount) : 0;
    const fromBottom = expansion ? Math.min(expansion.fromBottom, Math.max(0, region.lineCount - fromTop)) : 0;
    const remaining = region.lineCount - fromTop - fromBottom;
    if (remaining <= 0) continue; // fully expanded

    // The effective collapsed end is before any bottom-expanded lines
    const effectiveEnd = region.newEndLine - fromBottom;
    if (effectiveEnd <= cursorLine) return region;
  }
  return undefined;
};

// --- Browse mode ---

export const handleBrowseKey = (
  key: Key,
  state: SessionState,
  ggPending: boolean
): DispatchResult => {
  // Escape clears active search highlights
  if (BROWSE.clearSearch.match(key) && state.search) {
    return { state: reduce(state, { type: 'clear_search' }) };
  }

  // Shift+arrows → start selection and extend
  if (BROWSE.shiftSelectUp.match(key)) {
    return { state: applyActions(state, [
      { type: 'start_select' },
      { type: 'extend_select', delta: -1 },
    ]) };
  }
  if (BROWSE.shiftSelectDown.match(key)) {
    return { state: applyActions(state, [
      { type: 'start_select' },
      { type: 'extend_select', delta: 1 },
    ]) };
  }

  // Single-line movement
  if (BROWSE.moveUp.match(key)) {
    return { state: reduce(state, { type: 'move_cursor', delta: -1 }) };
  }
  if (BROWSE.moveDown.match(key)) {
    return { state: reduce(state, { type: 'move_cursor', delta: 1 }) };
  }

  // Half-page scroll
  if (BROWSE.halfPageUp.match(key)) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'move_cursor', delta: -hp }) };
  }
  if (BROWSE.halfPageDown.match(key)) {
    const hp = halfPage(state.viewportHeight);
    return { state: reduce(state, { type: 'move_cursor', delta: hp }) };
  }

  // Horizontal scroll (h/l or left/right arrows)
  if (BROWSE.scrollLeft.match(key)) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: -4 }) };
  }
  if (BROWSE.scrollRight.match(key)) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: 4 }) };
  }
  // Reset horizontal scroll
  if (BROWSE.resetHorizontal.match(key)) {
    return { state: reduce(state, { type: 'reset_horizontal' }) };
  }

  // Mouse wheel scroll — moves viewport, cursor stays unless off-screen
  if (BROWSE.mouseScrollUp.match(key)) {
    return { state: reduce(state, { type: 'scroll_viewport', delta: -3 }) };
  }
  if (BROWSE.mouseScrollDown.match(key)) {
    return { state: reduce(state, { type: 'scroll_viewport', delta: 3 }) };
  }

  // Mouse horizontal scroll (Shift+wheel / trackpad sideways)
  if (BROWSE.mouseScrollLeft.match(key)) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: -4 }) };
  }
  if (BROWSE.mouseScrollRight.match(key)) {
    return { state: reduce(state, { type: 'scroll_horizontal', delta: 4 }) };
  }

  // Jump to top/bottom
  if (BROWSE.jumpTop.match(key)) {
    return { state: reduce(state, { type: 'set_cursor', line: 1 }) };
  }
  if (BROWSE.jumpBottom.match(key)) {
    return {
      state: reduce(state, { type: 'set_cursor', line: state.lineCount }),
    };
  }

  // Search navigation: Ctrl+N / Ctrl+P
  if (BROWSE.nextMatchCtrl.match(key)) {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: 1 }) };
    }
    return { state };
  }
  if (BROWSE.prevMatchCtrl.match(key)) {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: -1 }) };
    }
    return { state };
  }

  // Goto line (must precede gg check — Ctrl+G has char='g' + ctrl=true)
  if (BROWSE.gotoLine.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'goto' }), gotoFlow: { ...INITIAL_GOTO_FLOW } },
    };
  }

  // gg — two-key sequence
  if (BROWSE.startGg.match(key)) {
    if (ggPending) {
      return {
        state: reduce(state, { type: 'set_cursor', line: 1 }),
        gg: { pending: false },
      };
    }
    return { state, gg: { pending: true } };
  }

  // G — jump to bottom
  if (BROWSE.jumpBottomG.match(key)) {
    return {
      state: reduce(state, { type: 'set_cursor', line: state.lineCount }),
    };
  }

  // Visual select
  if (BROWSE.startSelect.match(key)) {
    return { state: reduce(state, { type: 'start_select' }) };
  }

  // Tab / Shift+Tab — cycle through annotation lines
  if (BROWSE.prevAnnotation.match(key)) {
    return jumpToNextAnnotation(state, -1);
  }
  if (BROWSE.nextAnnotation.match(key)) {
    return jumpToNextAnnotation(state, 1);
  }

  // c — toggle annotations on cursor line (expand if collapsed, collapse if expanded)
  if (BROWSE.toggleAnnotation.match(key)) {
    const toggleActions = annotationsOnLine(state.annotations, state.cursorLine)
      .map((a) => ({ type: 'toggle_annotation' as const, annotationId: a.id }));
    return { state: toggleActions.length > 0 ? applyActions(state, toggleActions) : state };
  }

  // C — toggle all: collapse all if any expanded, expand all if none expanded
  if (BROWSE.toggleAllAnnotations.match(key)) {
    if (state.annotations.length === 0) return { state };
    const action = state.expandedAnnotations.size > 0
      ? { type: 'collapse_all' as const }
      : { type: 'expand_all' as const };
    return { state: reduce(state, action) };
  }

  // r — reply to focused annotation
  if (BROWSE.reply.match(key)) {
    const target = state.focusedAnnotationId !== null
      ? state.annotations.find((a) => a.id === state.focusedAnnotationId && state.expandedAnnotations.has(a.id))
      : undefined;
    if (target) {
      return {
        state: { ...reduce(state, { type: 'set_mode', mode: 'reply' }), replyFlow: INITIAL_REPLY_FLOW(target.id) },
      };
    }
  }

  // w — edit (rewrite) focused annotation
  if (BROWSE.editAnnotation.match(key)) {
    const target = state.focusedAnnotationId !== null
      ? state.annotations.find((a) => a.id === state.focusedAnnotationId && state.expandedAnnotations.has(a.id))
      : undefined;
    if (target) {
      return {
        state: { ...reduce(state, { type: 'set_mode', mode: 'edit' }), editFlow: INITIAL_EDIT_FLOW(target) },
      };
    }
  }

  // x — confirm delete of focused annotation
  if (BROWSE.deleteAnnotation.match(key)) {
    const target = state.focusedAnnotationId !== null
      ? state.annotations.find((a) => a.id === state.focusedAnnotationId && state.expandedAnnotations.has(a.id))
      : undefined;
    if (target) {
      return {
        state: { ...reduce(state, { type: 'set_mode', mode: 'confirm' }), confirmFlow: INITIAL_CONFIRM_FLOW(target.id) },
      };
    }
  }

  // s — cycle annotation status: none → approved → dismissed → none
  if (BROWSE.cycleStatus.match(key)) {
    const target = state.focusedAnnotationId !== null
      ? state.annotations.find((a) => a.id === state.focusedAnnotationId && state.expandedAnnotations.has(a.id))
      : undefined;
    if (target) {
      const nextStatus = target.status === undefined
        ? 'approved' as const
        : target.status === 'approved'
          ? 'dismissed' as const
          : undefined;
      return {
        state: reduce(state, {
          type: 'update_annotation',
          annotationId: target.id,
          changes: { status: nextStatus },
        }),
      };
    }
  }

  // Toggle diff/raw view
  if (BROWSE.toggleDiff.match(key)) {
    if (state.diffMeta) {
      return { state: reduce(state, { type: 'toggle_view_mode' }) };
    }
    return { state };
  }

  // Expand regions — diff mode only, browse mode only
  if (BROWSE.expandDown.match(key)) {
    if (state.viewMode === 'diff' && state.diffMeta?.collapsedRegions) {
      const regions = state.diffMeta.collapsedRegions;
      const expandedRegions = state.expandedRegions ?? new Map<number, RegionExpansion>();
      const region = findNearestRegionBelow(state.cursorLine, regions, expandedRegions);
      if (region) {
        return { state: reduce(state, { type: 'expand_region', regionIndex: region.index, direction: 'down', step: EXPAND_STEP }) };
      }
    }
    return { state };
  }
  if (BROWSE.expandUp.match(key)) {
    if (state.viewMode === 'diff' && state.diffMeta?.collapsedRegions) {
      const regions = state.diffMeta.collapsedRegions;
      const expandedRegions = state.expandedRegions ?? new Map<number, RegionExpansion>();
      const region = findNearestRegionAbove(state.cursorLine, regions, expandedRegions);
      if (region) {
        return { state: reduce(state, { type: 'expand_region', regionIndex: region.index, direction: 'up', step: EXPAND_STEP }) };
      }
    }
    return { state };
  }
  if (BROWSE.toggleAllRegions.match(key)) {
    if (state.viewMode === 'diff' && state.diffMeta?.collapsedRegions && state.diffMeta.collapsedRegions.length > 0) {
      const regions = state.diffMeta.collapsedRegions;
      const expandedRegions = state.expandedRegions ?? new Map<number, RegionExpansion>();
      // If any region has expansion → collapse all first. Otherwise → expand all.
      const anyExpanded = regions.some(r => {
        const exp = expandedRegions.get(r.index);
        return exp !== undefined && (exp.fromTop + exp.fromBottom) > 0;
      });
      if (anyExpanded) {
        return { state: reduce(state, { type: 'collapse_all_regions' }) };
      } else {
        return { state: reduce(state, { type: 'expand_all_regions' }) };
      }
    }
    return { state };
  }

  // Annotate (single-line)
  if (BROWSE.annotate.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'annotate' }), annotationFlow: { ...INITIAL_ANNOTATION_FLOW } },
    };
  }

  // Search
  if (BROWSE.search.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'search' }), searchFlow: { ...INITIAL_SEARCH_FLOW } },
    };
  }

  // Next search match
  if (BROWSE.nextMatch.match(key)) {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: 1 }) };
    }
    return { state };
  }

  // Previous search match
  if (BROWSE.prevMatch.match(key)) {
    if (state.search && state.search.matchLines.length > 0) {
      return { state: reduce(state, { type: 'navigate_match', delta: -1 }) };
    }
    return { state };
  }

  // Finish / decision picker
  if (BROWSE.finish.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'decide' }), decideFlow: { ...INITIAL_DECIDE_FLOW } },
    };
  }

  return { state };
};

// --- Reply mode ---

export const handleReplyKey = (
  key: Key,
  state: SessionState,
  flow: ReplyFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), replyFlow: undefined },
    };
  }

  // Enter submits (not Shift+Enter / Alt+Enter)
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0) {
      return {
        state: {
          ...applyActions(state, [
            { type: 'add_reply', annotationId: flow.annotationId, reply: { comment: trimmed, source: 'user' } },
            { type: 'set_mode', mode: 'browse' },
          ]),
          replyFlow: undefined,
        },
      };
    }
    return { state: { ...state, replyFlow: flow } };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state: { ...state, replyFlow: { ...flow, comment: updatedBuf } } };
  }

  return { state: { ...state, replyFlow: flow } };
};

// --- Edit mode ---

export const handleEditKey = (
  key: Key,
  state: SessionState,
  flow: EditFlowState
): DispatchResult => {
  if (key.escape) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), editFlow: undefined },
    };
  }

  // Enter saves (not Shift+Enter / Alt+Enter)
  if (key.return && !key.shift && !key.alt) {
    const trimmed = getText(flow.comment).trim();
    if (trimmed.length > 0) {
      return {
        state: {
          ...applyActions(state, [
            { type: 'update_annotation', annotationId: flow.annotationId, changes: { comment: trimmed } },
            { type: 'set_mode', mode: 'browse' },
          ]),
          editFlow: undefined,
        },
      };
    }
    return { state: { ...state, editFlow: flow } };
  }

  // Text editing keys
  const updatedBuf = applyTextKey(key, flow.comment);
  if (updatedBuf) {
    return { state: { ...state, editFlow: { ...flow, comment: updatedBuf } } };
  }

  return { state: { ...state, editFlow: flow } };
};

// --- Confirm mode ---

export const handleConfirmKey = (
  key: Key,
  state: SessionState,
  flow: ConfirmFlowState
): DispatchResult => {
  if (PICKER.cancel.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), confirmFlow: undefined },
    };
  }

  // Arrow navigation
  if (PICKER.up.match(key)) {
    return {
      state: { ...state, confirmFlow: { ...flow, picker: moveHighlight(flow.picker, -1) } },
    };
  }
  if (PICKER.down.match(key)) {
    return {
      state: { ...state, confirmFlow: { ...flow, picker: moveHighlight(flow.picker, 1) } },
    };
  }

  // Enter confirms highlighted
  if (PICKER.confirm.match(key)) {
    const selected = getHighlighted(flow.picker);
    if (selected?.id === 'yes') {
      return {
        state: {
          ...applyActions(state, [
            { type: 'delete_annotation', annotationId: flow.annotationId },
            { type: 'set_mode', mode: 'browse' },
          ]),
          confirmFlow: undefined,
        },
      };
    }
    // "no" or default — cancel
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), confirmFlow: undefined },
    };
  }

  // Direct shortcut
  const matched = findByShortcut(flow.picker, key.char);
  if (matched?.id === 'yes') {
    return {
      state: {
        ...applyActions(state, [
          { type: 'delete_annotation', annotationId: flow.annotationId },
          { type: 'set_mode', mode: 'browse' },
        ]),
        confirmFlow: undefined,
      },
    };
  }
  if (matched?.id === 'no') {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), confirmFlow: undefined },
    };
  }

  return { state: { ...state, confirmFlow: flow } };
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
  state: SessionState,
  flow: SearchFlowState,
  sourceLines: readonly string[]
): DispatchResult => {
  // Escape clears search and returns to browse
  if (key.escape) {
    return {
      state: {
        ...applyActions(state, [
          { type: 'clear_search' },
          { type: 'set_mode', mode: 'browse' },
        ]),
        searchFlow: undefined,
      },
    };
  }

  // Enter commits the search and returns to browse (keeps highlights)
  if (key.return && !key.shift && !key.alt) {
    const pattern = getText(flow.input).trim();
    if (pattern.length > 0) {
      const matchLines = findMatchLines(sourceLines, pattern);
      return {
        state: {
          ...applyActions(state, [
            { type: 'set_search', pattern, matchLines },
            { type: 'set_mode', mode: 'browse' },
          ]),
          searchFlow: undefined,
        },
      };
    }
    // Empty pattern — clear search and return
    return {
      state: {
        ...applyActions(state, [
          { type: 'clear_search' },
          { type: 'set_mode', mode: 'browse' },
        ]),
        searchFlow: undefined,
      },
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
    return { state: { ...nextState, searchFlow: { ...flow, input: updatedBuf } } };
  }

  return { state: { ...state, searchFlow: flow } };
};

// --- Decide mode ---

export const handleDecideKey = (
  key: Key,
  state: SessionState,
  flow: DecideFlowState
): DispatchResult => {
  if (PICKER.cancel.match(key)) {
    return {
      state: { ...reduce(state, { type: 'set_mode', mode: 'browse' }), decideFlow: undefined },
    };
  }

  // Arrow navigation
  if (PICKER.up.match(key)) {
    return {
      state: { ...state, decideFlow: { picker: moveHighlight(flow.picker, -1) } },
    };
  }
  if (PICKER.down.match(key)) {
    return {
      state: { ...state, decideFlow: { picker: moveHighlight(flow.picker, 1) } },
    };
  }

  // Enter confirms highlighted
  if (PICKER.confirm.match(key)) {
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
    return { state: { ...state, decideFlow: flow } };
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

  return { state: { ...state, decideFlow: flow } };
};
