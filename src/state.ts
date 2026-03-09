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
import { annotationBoxHeight } from './annotation-box.js';

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

/**
 * Diff mode display metadata — derived from DiffData at startup, stored on
 * state so the reducer can clamp cursors and compute viewport offsets without
 * needing the full DiffData. Undefined when no diff data exists.
 */
export type DiffMeta = {
  /** Total display rows (DiffData.rows.length). */
  readonly rowCount: number;
  /** Sorted new-file line numbers visible in the diff (from DiffData.visibleNewLines). */
  readonly visibleLines: readonly number[];
  /** Maps new-file line number (1-indexed) → display row index. */
  readonly newLineToRow: ReadonlyMap<number, number>;
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
  /**
   * The single annotation currently targeted by keyboard actions (r/w/x).
   * Always refers to an annotation whose range covers the current cursorLine,
   * or null when no annotation is focused.
   */
  readonly focusedAnnotationId: string | null;
  /** Persistent search state — survives mode transitions. */
  readonly search?: SearchState;
  /** Current view — 'raw' (default) or 'diff' (side-by-side). */
  readonly viewMode: 'raw' | 'diff';
  /** Diff display metadata. Set once at startup when diff data exists; undefined otherwise. */
  readonly diffMeta?: DiffMeta;

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
  | { type: 'expand_all' }
  | { type: 'focus_annotation'; annotationId: string | null }
  | { type: 'toggle_view_mode' };

export const clampLine = (value: number, lineCount: number): number =>
  R.clamp(value, { min: 1, max: Math.max(1, lineCount) });

/**
 * Find the index of the nearest visible line to `target` via binary search.
 * `visibleLines` must be sorted ascending. Returns -1 for empty arrays.
 */
export const findNearestVisibleIndex = (
  visibleLines: readonly number[],
  target: number,
): number => {
  if (visibleLines.length === 0) return -1;
  let lo = 0;
  let hi = visibleLines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (visibleLines[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  // lo = first element >= target. Check if lo-1 is closer.
  if (lo > 0) {
    const distLo = Math.abs(visibleLines[lo]! - target);
    const distPrev = Math.abs(visibleLines[lo - 1]! - target);
    if (distPrev < distLo) return lo - 1;
  }
  return lo;
};

/**
 * Clamp a cursor value for the current view mode.
 * In raw mode, clamps to [1, lineCount].
 * In diff mode, snaps to the nearest visible new-file line.
 */
export const clampCursor = (state: SessionState, value: number): number => {
  if (state.viewMode === 'diff' && state.diffMeta && state.diffMeta.visibleLines.length > 0) {
    const idx = findNearestVisibleIndex(state.diffMeta.visibleLines, value);
    return state.diffMeta.visibleLines[idx]!;
  }
  return clampLine(value, state.lineCount);
};

/**
 * Move cursor by delta in diff mode — steps through visible lines by index
 * rather than by absolute line number.
 */
const moveCursorDiff = (state: SessionState, delta: number): number => {
  const visLines = state.diffMeta!.visibleLines;
  if (visLines.length === 0) return state.cursorLine;
  const currentIdx = findNearestVisibleIndex(visLines, state.cursorLine);
  const nextIdx = R.clamp(currentIdx + delta, { min: 0, max: visLines.length - 1 });
  return visLines[nextIdx]!;
};

/**
 * Compute viewport offset in diff mode. Translates cursor (new-file line)
 * to a display row, then delegates to `computeViewportOffset`.
 */
const computeDiffViewportOffset = (
  state: SessionState,
  cursorLine: number,
): number => {
  const meta = state.diffMeta!;
  const displayRow = (meta.newLineToRow.get(cursorLine) ?? 0) + 1; // 1-indexed
  return computeViewportOffset({
    cursorLine: displayRow,
    currentOffset: state.viewportOffset,
    viewportHeight: state.viewportHeight,
    lineCount: meta.rowCount,
  });
};

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

/**
 * Compute extra display rows added by expanded annotation boxes.
 * Each expanded annotation whose endLine falls within the file contributes
 * its box height. Used to extend maxOffset so the viewport can scroll past
 * the last source line to reveal boxes at the bottom.
 */
export const computeExpandedExtraRows = (
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
): number => {
  let extra = 0;
  for (const ann of annotations) {
    if (expandedAnnotations.has(ann.id)) {
      extra += annotationBoxHeight(ann, { maxWidth: 80, isFocused: true });
    }
  }
  return extra;
};

/**
 * Count display rows consumed by expanded annotation boxes that render
 * between the viewport start and the cursor line. Only annotations whose
 * endLine falls in [firstVisibleLine, cursorLine) are counted — they push
 * the cursor further down in the viewport.
 */
export const annotationRowsAboveCursor = (
  viewportOffset: number,
  cursorLine: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
): number => {
  if (expandedAnnotations.size === 0) return 0;
  const firstVisible = viewportOffset + 1; // 1-indexed
  let extra = 0;
  for (const ann of annotations) {
    if (
      expandedAnnotations.has(ann.id) &&
      ann.endLine >= firstVisible &&
      ann.endLine < cursorLine
    ) {
      extra += annotationBoxHeight(ann, { maxWidth: 80, isFocused: true });
    }
  }
  return extra;
};

/**
 * Compute the 0-indexed display row of the cursor within the viewport,
 * accounting for expanded annotation boxes between the viewport start and
 * the cursor.
 */
export const cursorDisplayRow = (
  viewportOffset: number,
  cursorLine: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
): number =>
  (cursorLine - 1 - viewportOffset) +
  annotationRowsAboveCursor(viewportOffset, cursorLine, annotations, expandedAnnotations);

export const computeViewportOffset = (params: {
  cursorLine: number;
  currentOffset: number;
  viewportHeight: number;
  lineCount: number;
  /** Extra rows from expanded annotation boxes — extends maxOffset so the
   *  viewport can scroll past the last source line. Defaults to 0. */
  extraRows?: number;
}): number => {
  const { cursorLine, currentOffset, viewportHeight, lineCount } = params;
  const cursorIndex = cursorLine - 1; // 0-indexed
  const effectiveLineCount = lineCount + (params.extraRows ?? 0);
  const maxOffset = Math.max(0, effectiveLineCount - viewportHeight);

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

/**
 * Annotation-aware viewport offset for raw mode. Uses the actual display row
 * of the cursor (accounting for annotation boxes between viewport start and
 * cursor) and iteratively adjusts the offset to keep the cursor within the
 * scroll-off zone.
 *
 * Falls back to the fast `computeViewportOffset` when no annotations are
 * expanded.
 */
export const computeRawViewportOffset = (
  state: SessionState,
  cursorLine: number,
): number => {
  const { annotations, expandedAnnotations, viewportHeight, lineCount } = state;
  const totalExtra = computeExpandedExtraRows(annotations, expandedAnnotations);
  const maxOffset = Math.max(0, lineCount + totalExtra - viewportHeight);

  // Fast path — no expanded annotations
  if (expandedAnnotations.size === 0) {
    return computeViewportOffset({
      cursorLine,
      currentOffset: state.viewportOffset,
      viewportHeight,
      lineCount,
    });
  }

  let offset = state.viewportOffset;

  // Compute actual display row
  const dr = cursorDisplayRow(offset, cursorLine, annotations, expandedAnnotations);

  // Scroll up: cursor too close to top
  if (dr < SCROLL_OFF) {
    while (offset > 0) {
      offset--;
      const d = cursorDisplayRow(offset, cursorLine, annotations, expandedAnnotations);
      if (d >= SCROLL_OFF) break;
    }
    return Math.min(offset, maxOffset);
  }

  // Scroll down: cursor too close to bottom
  if (dr >= viewportHeight - SCROLL_OFF) {
    while (offset < maxOffset) {
      offset++;
      const d = cursorDisplayRow(offset, cursorLine, annotations, expandedAnnotations);
      if (d < viewportHeight - SCROLL_OFF) break;
    }
    return Math.min(offset, maxOffset);
  }

  return offset;
};

/**
 * Sort annotations covering a line in visual order: lowest endLine first
 * (box renders higher), then lowest startLine, then insertion order.
 * This matches the Tab-cycle sort in dispatch.ts.
 */
const visualSort = (annotations: readonly Annotation[]): Annotation[] =>
  annotations
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.endLine - y.a.endLine || x.a.startLine - y.a.startLine || x.i - y.i)
    .map((x) => x.a);

/**
 * Compute the appropriate focusedAnnotationId for a given cursor line.
 *
 * Always picks the visually topmost expanded annotation (lowest endLine,
 * then lowest startLine, then insertion order). This keeps auto-focus
 * deterministic — direction of arrival doesn't matter. Explicit focus
 * (Tab / `focus_annotation`) overrides this via a separate dispatch.
 */
export const computeFocus = (
  cursorLine: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
): string | null => {
  const onLine = annotations.filter(
    (a) => cursorLine >= a.startLine && cursorLine <= a.endLine
  );
  if (onLine.length === 0) return null;

  const sorted = visualSort(onLine);
  const firstExpanded = sorted.find((a) => expandedAnnotations.has(a.id));
  return firstExpanded?.id ?? null;
};

/** Extra rows from expanded annotations — shorthand for reducer use. */
const extraRows = (state: SessionState): number =>
  computeExpandedExtraRows(state.annotations, state.expandedAnnotations);

const recomputeOffset = (state: SessionState, viewportHeight: number): number => {
  if (state.viewMode === 'diff' && state.diffMeta) {
    const displayRow = (state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0) + 1;
    return computeViewportOffset({
      cursorLine: displayRow,
      currentOffset: state.viewportOffset,
      viewportHeight,
      lineCount: state.diffMeta.rowCount,
    });
  }
  return computeRawViewportOffset(
    { ...state, viewportHeight },
    state.cursorLine,
  );
};

export const reduce = (state: SessionState, action: BrowseAction): SessionState => {
  switch (action.type) {
    case 'move_cursor': {
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      const cursorLine = inDiff
        ? moveCursorDiff(state, action.delta)
        : clampLine(state.cursorLine + action.delta, state.lineCount);
      const viewportOffset = inDiff
        ? computeDiffViewportOffset(state, cursorLine)
        : computeRawViewportOffset({ ...state, cursorLine }, cursorLine);
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return { ...state, cursorLine, viewportOffset, focusedAnnotationId };
    }
    case 'set_cursor': {
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      const cursorLine = inDiff
        ? clampCursor(state, action.line)
        : clampLine(action.line, state.lineCount);
      const viewportOffset = inDiff
        ? computeDiffViewportOffset(state, cursorLine)
        : computeRawViewportOffset({ ...state, cursorLine }, cursorLine);
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return { ...state, cursorLine, viewportOffset, focusedAnnotationId };
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
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      const active = inDiff
        ? moveCursorDiff({ ...state, cursorLine: state.selection.active }, action.delta)
        : clampLine(state.selection.active + action.delta, state.lineCount);
      const cursorLine = active;
      const viewportOffset = inDiff
        ? computeDiffViewportOffset(state, cursorLine)
        : computeRawViewportOffset({ ...state, cursorLine }, cursorLine);
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
      const isExpanding = !next.has(action.annotationId);
      if (isExpanding) {
        next.add(action.annotationId);
      } else {
        next.delete(action.annotationId);
      }
      const focusedAnnotationId = computeFocus(
        state.cursorLine, state.annotations, next
      );
      // When expanding, nudge viewport so the box is fully visible
      if (isExpanding) {
        const ann = state.annotations.find((a) => a.id === action.annotationId);
        if (ann) {
          const boxH = annotationBoxHeight(ann, { maxWidth: 80, isFocused: true });
          const padding = 1;
          // Use display-row-aware check: compute where the cursor (endLine) actually
          // sits in the viewport accounting for annotation boxes above it, then check
          // whether the box below it fits.
          const dr = cursorDisplayRow(
            state.viewportOffset, ann.endLine,
            state.annotations, next,
          );
          const bottomNeeded = dr + 1 + boxH + padding; // cursor row + box + padding
          if (bottomNeeded > state.viewportHeight) {
            const totalExtra = computeExpandedExtraRows(state.annotations, next);
            const maxOff = Math.max(0, state.lineCount + totalExtra - state.viewportHeight);
            // Iteratively increase offset until the box fits
            let adjusted = state.viewportOffset;
            while (adjusted < maxOff) {
              adjusted++;
              const d = cursorDisplayRow(adjusted, ann.endLine, state.annotations, next);
              if (d + 1 + boxH + padding <= state.viewportHeight) break;
            }
            return { ...state, expandedAnnotations: next, focusedAnnotationId, viewportOffset: adjusted };
          }
        }
      }
      return { ...state, expandedAnnotations: next, focusedAnnotationId };
    }
    case 'delete_annotation': {
      const next = new Set(state.expandedAnnotations);
      next.delete(action.annotationId);
      const remaining = state.annotations.filter((a) => a.id !== action.annotationId);
      const focusedAnnotationId = computeFocus(state.cursorLine, remaining, next);
      return {
        ...state,
        annotations: remaining,
        expandedAnnotations: next,
        focusedAnnotationId,
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
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      // Find the first match at or after the current cursor line
      const idx = action.matchLines.findIndex((l) => l >= state.cursorLine);
      const matchIdx = idx >= 0 ? idx : 0;
      const rawCursorLine = action.matchLines[matchIdx]!;
      const cursorLine = inDiff ? clampCursor(state, rawCursorLine) : rawCursorLine;
      const viewportOffset = inDiff
        ? computeDiffViewportOffset(state, cursorLine)
        : computeRawViewportOffset({ ...state, cursorLine }, cursorLine);
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return {
        ...state,
        cursorLine,
        viewportOffset,
        focusedAnnotationId,
        search: { pattern: action.pattern, matchLines: action.matchLines, currentMatchIndex: matchIdx },
      };
    }
    case 'clear_search': {
      return { ...state, search: undefined };
    }
    case 'navigate_match': {
      if (!state.search || state.search.matchLines.length === 0) return state;
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      const len = state.search.matchLines.length;
      const nextIdx = ((state.search.currentMatchIndex + action.delta) % len + len) % len;
      const rawCursorLine = state.search.matchLines[nextIdx]!;
      const cursorLine = inDiff ? clampCursor(state, rawCursorLine) : rawCursorLine;
      const viewportOffset = inDiff
        ? computeDiffViewportOffset(state, cursorLine)
        : computeRawViewportOffset({ ...state, cursorLine }, cursorLine);
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return {
        ...state,
        cursorLine,
        viewportOffset,
        focusedAnnotationId,
        search: { ...state.search, currentMatchIndex: nextIdx },
      };
    }
    case 'scroll_viewport': {
      const inDiff = state.viewMode === 'diff' && state.diffMeta;
      const baseLineCount = inDiff ? state.diffMeta!.rowCount : state.lineCount;
      const effectiveLineCount = baseLineCount + (inDiff ? 0 : extraRows(state));
      const maxOffset = Math.max(0, effectiveLineCount - state.viewportHeight);
      const viewportOffset = R.clamp(state.viewportOffset + action.delta, {
        min: 0,
        max: maxOffset,
      });
      if (inDiff) {
        // In diff mode, cursor stays put unless we'd need more complex row-based clamping.
        // For now, keep cursor unchanged — the renderer will handle visibility.
        return { ...state, viewportOffset };
      }
      // Raw mode: clamp cursor to stay within the visible viewport
      const visTop = viewportOffset + 1;
      const visBottom = Math.min(
        viewportOffset + state.viewportHeight,
        state.lineCount
      );
      const cursorLine = R.clamp(state.cursorLine, {
        min: visTop,
        max: visBottom,
      });
      const focusedAnnotationId = cursorLine !== state.cursorLine
        ? computeFocus(cursorLine, state.annotations, state.expandedAnnotations)
        : state.focusedAnnotationId;
      return { ...state, viewportOffset, cursorLine, focusedAnnotationId };
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
      return { ...state, expandedAnnotations: new Set<string>(), focusedAnnotationId: null };
    }
    case 'expand_all': {
      const expanded = new Set(state.annotations.map((a) => a.id));
      const focusedAnnotationId = computeFocus(
        state.cursorLine, state.annotations, expanded
      );
      return { ...state, expandedAnnotations: expanded, focusedAnnotationId };
    }
    case 'focus_annotation': {
      return { ...state, focusedAnnotationId: action.annotationId };
    }
    case 'toggle_view_mode': {
      if (!state.diffMeta) return state; // no-op without diff data
      const nextMode = state.viewMode === 'raw' ? 'diff' : 'raw';
      const nextState = { ...state, viewMode: nextMode } as SessionState;
      const cursorLine = nextMode === 'diff'
        ? clampCursor(nextState, state.cursorLine)
        : state.cursorLine;
      const viewportOffset = nextMode === 'diff'
        ? computeDiffViewportOffset(nextState, cursorLine)
        : computeRawViewportOffset(
            { ...nextState, cursorLine, viewportOffset: 0 }, // reset viewport on toggle
            cursorLine,
          );
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return { ...nextState, cursorLine, viewportOffset, focusedAnnotationId };
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
