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
import type { CollapsedRegion, DiffData, DiffMetaLike, RegionExpansion } from './diff-align.js';
import {
  getNormalizedRegionExpansion,
  recomputeDiffMeta,
  findRegionForLine as findRegionForLineHelper,
  isLineRevealed as isLineRevealedHelper,
  autoExpandForLine as autoExpandForLineHelper,
} from './diff-align.js';

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
  /** When true, annotation targets the whole file (startLine: 0, endLine: 0). */
  readonly fileLevel?: boolean;
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
  /** Number of matches hidden in collapsed regions (diff mode only). */
  readonly hiddenMatchCount?: number;
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
export type DiffMeta = DiffMetaLike & {
  /** Collapsed regions — immutable reference from DiffData. Needed for expand/collapse. */
  readonly collapsedRegions?: readonly CollapsedRegion[];
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
  /** Diff display metadata. Recomputed when regions expand/collapse. */
  readonly diffMeta?: DiffMeta;
  /** Per-region expansion state for diff collapsed regions. Key = region index. */
  readonly expandedRegions?: ReadonlyMap<number, RegionExpansion>;
  /** Base DiffData reference — immutable, set once at startup. Needed by reducer for region expansion. */
  readonly baseDiffData?: DiffData;

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
  | { type: 'toggle_view_mode' }
  | { type: 'expand_region'; regionIndex: number; direction: 'up' | 'down'; step: number }
  | { type: 'expand_all_regions' }
  | { type: 'collapse_all_regions' }
  | { type: 'set_expanded_regions'; expandedRegions: ReadonlyMap<number, import('./diff-align.js').RegionExpansion> };

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
 * Count display rows consumed by expanded annotation boxes between the
 * viewport start and the cursor row in diff mode. Only annotations whose
 * endLine maps to a diff row in [viewportOffset, cursorRow) are counted.
 */
const diffAnnotationRowsAboveCursor = (
  viewportOffset: number,
  cursorRow: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
  newLineToRow: ReadonlyMap<number, number>,
): number => {
  if (expandedAnnotations.size === 0) return 0;
  let extra = 0;
  for (const ann of annotations) {
    if (!expandedAnnotations.has(ann.id)) continue;
    const row = newLineToRow.get(ann.endLine);
    if (row === undefined) continue;
    if (row >= viewportOffset && row < cursorRow) {
      extra += annotationBoxHeight(ann, { maxWidth: 80, isFocused: true });
    }
  }
  return extra;
};

/**
 * Compute the 0-indexed visual row of the cursor within the diff viewport,
 * accounting for expanded annotation boxes between viewport start and cursor.
 */
const cursorDiffDisplayRow = (
  viewportOffset: number,
  cursorRow: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
  newLineToRow: ReadonlyMap<number, number>,
): number =>
  (cursorRow - viewportOffset) +
  diffAnnotationRowsAboveCursor(viewportOffset, cursorRow, annotations, expandedAnnotations, newLineToRow);

/**
 * Compute viewport offset in diff mode. Translates cursor (new-file line)
 * to a display row, then adjusts the offset to keep the cursor within the
 * scroll-off zone, accounting for expanded annotation boxes.
 */
const computeDiffViewportOffset = (
  state: SessionState,
  cursorLine: number,
): number => {
  const meta = state.diffMeta!;
  const { annotations, expandedAnnotations, viewportHeight } = state;
  const cursorRow = meta.newLineToRow.get(cursorLine) ?? 0; // 0-indexed row
  const totalExtra = expandedAnnotations.size === 0
    ? 0
    : computeExpandedExtraRows(annotations, expandedAnnotations);
  const maxOffset = Math.max(0, meta.rowCount + totalExtra - viewportHeight);

  // Fast path — no expanded annotations
  if (expandedAnnotations.size === 0) {
    const displayRow = cursorRow + 1; // 1-indexed for computeViewportOffset
    return computeViewportOffset({
      cursorLine: displayRow,
      currentOffset: state.viewportOffset,
      viewportHeight,
      lineCount: meta.rowCount,
    });
  }

  let offset = state.viewportOffset;

  const dr = cursorDiffDisplayRow(offset, cursorRow, annotations, expandedAnnotations, meta.newLineToRow);

  // Scroll up: cursor too close to top
  if (dr < SCROLL_OFF) {
    while (offset > 0) {
      offset--;
      const d = cursorDiffDisplayRow(offset, cursorRow, annotations, expandedAnnotations, meta.newLineToRow);
      if (d >= SCROLL_OFF) break;
    }
    return Math.min(offset, maxOffset);
  }

  // Scroll down: cursor too close to bottom
  if (dr >= viewportHeight - SCROLL_OFF) {
    while (offset < maxOffset) {
      offset++;
      const d = cursorDiffDisplayRow(offset, cursorRow, annotations, expandedAnnotations, meta.newLineToRow);
      if (d < viewportHeight - SCROLL_OFF) break;
    }
    return Math.min(offset, maxOffset);
  }

  return offset;
};

/**
 * Nudge viewport offset so that an annotation box (rendered below its endLine)
 * is fully visible. Works in both raw and diff modes.
 *
 * Returns the adjusted viewportOffset, or the current one if no adjustment needed.
 */
export const nudgeForAnnotationBox = (
  state: SessionState,
  ann: Annotation,
  expandedAnnotations: ReadonlySet<string>,
): number => {
  const boxH = annotationBoxHeight(ann, { maxWidth: 80, isFocused: true });
  const padding = 1;
  const inDiff = state.viewMode === 'diff' && state.diffMeta;

  if (inDiff) {
    const meta = state.diffMeta!;
    const displayRow = meta.newLineToRow.get(state.cursorLine);
    if (displayRow === undefined) return state.viewportOffset;
    // displayRow is 0-indexed row in diff. viewportOffset is also a row index.
    const relRow = displayRow - state.viewportOffset;
    const bottomNeeded = relRow + 1 + boxH + padding;

    if (relRow < 0) {
      // Cursor is above viewport — scroll up to show it
      return Math.max(0, displayRow - SCROLL_OFF);
    }
    if (bottomNeeded > state.viewportHeight) {
      // Box extends below viewport — scroll down
      const maxOff = Math.max(0, meta.rowCount - state.viewportHeight);
      return Math.min(maxOff, displayRow - state.viewportHeight + 1 + boxH + padding);
    }
    return state.viewportOffset;
  }

  // Raw mode — use display-row-aware check
  const dr = cursorDisplayRow(
    state.viewportOffset, ann.endLine,
    state.annotations, expandedAnnotations,
  );
  const bottomNeeded = dr + 1 + boxH + padding;

  if (dr < 0) {
    // Cursor scrolled above viewport — reset offset so cursor is near top
    const totalExtra = computeExpandedExtraRows(state.annotations, expandedAnnotations);
    const maxOff = Math.max(0, state.lineCount + totalExtra - state.viewportHeight);
    let adjusted = Math.max(0, ann.endLine - 1 - SCROLL_OFF);
    return Math.min(adjusted, maxOff);
  }

  if (bottomNeeded > state.viewportHeight) {
    const totalExtra = computeExpandedExtraRows(state.annotations, expandedAnnotations);
    const maxOff = Math.max(0, state.lineCount + totalExtra - state.viewportHeight);
    let adjusted = state.viewportOffset;
    while (adjusted < maxOff) {
      adjusted++;
      const d = cursorDisplayRow(adjusted, ann.endLine, state.annotations, expandedAnnotations);
      if (d + 1 + boxH + padding <= state.viewportHeight) break;
    }
    return adjusted;
  }

  return state.viewportOffset;
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
 * Compute the 0-indexed visual row of the cursor within the viewport.
 * Works for both raw and diff modes. In diff mode pass the 0-indexed
 * display row from `newLineToRow`, in raw mode pass `cursorLine - 1`.
 */
export const getCursorVisualRow = (viewportOffset: number, cursorRow: number): number =>
  cursorRow - viewportOffset;

/**
 * Compute viewport offset that pins a target display row at a desired
 * visual row within the viewport. Clamps to valid range.
 *
 * @param targetRow - 0-indexed display row of the target line.
 * @param desiredVisualRow - 0-indexed visual row where the target should appear.
 * @param viewportHeight - viewport height in rows.
 * @param totalRows - total display rows (lineCount for raw, rowCount for diff).
 */
export const stableViewportOffset = (
  targetRow: number,
  desiredVisualRow: number,
  viewportHeight: number,
  totalRows: number,
): number => {
  const maxOffset = Math.max(0, totalRows - viewportHeight);
  return R.clamp(targetRow - desiredVisualRow, { min: 0, max: maxOffset });
};

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

/**
 * Build the reducer-facing DiffMeta from immutable DiffData + optional expansion state.
 */
export const createDiffMeta = (
  baseDiffData: DiffData,
  expandedRegions?: ReadonlyMap<number, RegionExpansion>,
): DiffMeta => {
  const meta = expandedRegions
    ? recomputeDiffMeta(baseDiffData, expandedRegions)
    : {
        rowCount: baseDiffData.rows.length,
        visibleLines: baseDiffData.visibleNewLines,
        newLineToRow: baseDiffData.newLineToRowIndex,
      };

  return {
    ...meta,
    collapsedRegions: baseDiffData.collapsedRegions,
  };
};

/**
 * Apply region expansion to state, recomputing DiffMeta.
 * Uses baseDiffData to pass to recomputeDiffMeta for structural metadata.
 */
const applyRegionExpansion = (
  state: SessionState,
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
  baseDiffData: DiffData,
): SessionState => {
  const diffMeta = createDiffMeta(baseDiffData, expandedRegions);
  return { ...state, expandedRegions, diffMeta };
};

const recomputeOffset = (state: SessionState, viewportHeight: number): number => {
  if (state.viewMode === 'diff' && state.diffMeta) {
    return computeDiffViewportOffset({ ...state, viewportHeight }, state.cursorLine);
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

      // Pin new cursor at the same visual row as the old cursor
      const oldCursorRow = inDiff
        ? (state.diffMeta!.newLineToRow.get(state.cursorLine) ?? 0)
        : (state.cursorLine - 1);
      const oldVisualRow = getCursorVisualRow(state.viewportOffset, oldCursorRow);
      const newCursorRow = inDiff
        ? (state.diffMeta!.newLineToRow.get(cursorLine) ?? 0)
        : (cursorLine - 1);
      const totalRows = inDiff
        ? state.diffMeta!.rowCount + extraRows(state)
        : state.lineCount + extraRows(state);
      const viewportOffset = stableViewportOffset(
        newCursorRow, oldVisualRow, state.viewportHeight, totalRows,
      );

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

      // When expanding, auto-expand collapsed region if endLine is hidden
      let stateWithRegion: SessionState = { ...state, expandedAnnotations: next };
      if (isExpanding && state.baseDiffData && state.diffMeta?.collapsedRegions) {
        const ann = state.annotations.find((a) => a.id === action.annotationId);
        if (ann) {
          const region = findRegionForLineHelper(state.diffMeta.collapsedRegions, ann.endLine);
          if (region) {
            const expandedRegions = state.expandedRegions ?? new Map<number, RegionExpansion>();
            const current = expandedRegions.get(region.index) ?? { fromTop: 0, fromBottom: 0 };
            if (!isLineRevealedHelper(region, current, ann.endLine)) {
              const expansion = autoExpandForLineHelper(ann.endLine, region, current);
              const nextMap = new Map(expandedRegions);
              nextMap.set(region.index, expansion);
              stateWithRegion = applyRegionExpansion(
                stateWithRegion, nextMap, state.baseDiffData
              );
            }
          }
        }
      }

      const focusedAnnotationId = computeFocus(
        stateWithRegion.cursorLine, stateWithRegion.annotations, next
      );
      // When expanding, nudge viewport so the box is fully visible
      if (isExpanding) {
        const ann = stateWithRegion.annotations.find((a) => a.id === action.annotationId);
        if (ann) {
          const adjusted = nudgeForAnnotationBox(
            { ...stateWithRegion, focusedAnnotationId },
            ann,
            next,
          );
          if (adjusted !== stateWithRegion.viewportOffset) {
            return { ...stateWithRegion, focusedAnnotationId, viewportOffset: adjusted };
          }
        }
      }
      return { ...stateWithRegion, focusedAnnotationId };
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
          search: { pattern: action.pattern, matchLines: [], currentMatchIndex: -1, hiddenMatchCount: 0 },
        };
      }
      const inDiff = state.viewMode === 'diff' && state.diffMeta;

      // In diff mode, filter matches to visible lines only and count hidden
      let visibleMatchLines = action.matchLines;
      let hiddenMatchCount = 0;
      if (inDiff) {
        const visibleSet = new Set(state.diffMeta!.visibleLines);
        visibleMatchLines = action.matchLines.filter(l => visibleSet.has(l));
        hiddenMatchCount = action.matchLines.length - visibleMatchLines.length;
      }

      if (visibleMatchLines.length === 0) {
        return {
          ...state,
          search: { pattern: action.pattern, matchLines: visibleMatchLines, currentMatchIndex: -1, hiddenMatchCount },
        };
      }

      // Find the first match at or after the current cursor line
      const idx = visibleMatchLines.findIndex((l) => l >= state.cursorLine);
      const matchIdx = idx >= 0 ? idx : 0;
      const rawCursorLine = visibleMatchLines[matchIdx]!;
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
        search: { pattern: action.pattern, matchLines: visibleMatchLines, currentMatchIndex: matchIdx, hiddenMatchCount },
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

      // Pin cursor at same visual row
      const oldCursorRowNav = inDiff
        ? (state.diffMeta!.newLineToRow.get(state.cursorLine) ?? 0)
        : (state.cursorLine - 1);
      const oldVisualRowNav = getCursorVisualRow(state.viewportOffset, oldCursorRowNav);
      const newCursorRowNav = inDiff
        ? (state.diffMeta!.newLineToRow.get(cursorLine) ?? 0)
        : (cursorLine - 1);
      const totalRowsNav = inDiff
        ? state.diffMeta!.rowCount + extraRows(state)
        : state.lineCount + extraRows(state);
      const viewportOffset = stableViewportOffset(
        newCursorRowNav, oldVisualRowNav, state.viewportHeight, totalRowsNav,
      );

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
      const effectiveLineCount = baseLineCount + extraRows(state);
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

      // Capture current visual row of cursor before mode change
      const oldCursorRow = state.viewMode === 'diff'
        ? (state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0)
        : (state.cursorLine - 1);
      const oldVisualRow = getCursorVisualRow(state.viewportOffset, oldCursorRow);

      const nextState = { ...state, viewMode: nextMode } as SessionState;
      const cursorLine = nextMode === 'diff'
        ? clampCursor(nextState, state.cursorLine)
        : state.cursorLine;

      // Pin new cursor at same visual row
      const newCursorRow = nextMode === 'diff'
        ? (nextState.diffMeta!.newLineToRow.get(cursorLine) ?? 0)
        : (cursorLine - 1);
      const totalRows = nextMode === 'diff'
        ? nextState.diffMeta!.rowCount + extraRows(nextState)
        : state.lineCount + extraRows(nextState);
      const viewportOffset = stableViewportOffset(
        newCursorRow, oldVisualRow, state.viewportHeight, totalRows,
      );
      const focusedAnnotationId = computeFocus(
        cursorLine, state.annotations, state.expandedAnnotations
      );
      return { ...nextState, cursorLine, viewportOffset, focusedAnnotationId };
    }
    case 'expand_region': {
      if (!state.baseDiffData || !state.diffMeta?.collapsedRegions) return state;
      const regions = state.diffMeta.collapsedRegions;
      const region = regions[action.regionIndex];
      if (!region) return state;

      const currentMap = state.expandedRegions ?? new Map<number, RegionExpansion>();
      const current = currentMap.get(region.index) ?? { fromTop: 0, fromBottom: 0 };
      const { remaining } = getNormalizedRegionExpansion(region, current);

      if (remaining <= 0) return state; // fully expanded already

      let next: RegionExpansion;
      if (action.direction === 'down') {
        const step = Math.min(action.step, remaining);
        next = { ...current, fromTop: current.fromTop + step };
      } else {
        const step = Math.min(action.step, remaining);
        next = { ...current, fromBottom: current.fromBottom + step };
      }

      // Capture current visual row of cursor before expansion
      const oldCursorRow = state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0;
      const oldVisualRow = getCursorVisualRow(state.viewportOffset, oldCursorRow);

      const nextMap = new Map(currentMap);
      nextMap.set(region.index, next);
      const expanded = applyRegionExpansion(state, nextMap, state.baseDiffData);

      // Pin cursor at same visual row after expansion
      const newCursorRow = expanded.diffMeta!.newLineToRow.get(expanded.cursorLine) ?? 0;
      const totalRowsExp = expanded.diffMeta!.rowCount + extraRows(expanded);
      const viewportOffset = stableViewportOffset(
        newCursorRow, oldVisualRow, state.viewportHeight, totalRowsExp,
      );
      return { ...expanded, viewportOffset };
    }
    case 'expand_all_regions': {
      if (!state.baseDiffData || !state.diffMeta?.collapsedRegions) return state;
      const regions = state.diffMeta.collapsedRegions;
      if (regions.length === 0) return state;

      // Capture current visual row
      const oldCursorRowAll = state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0;
      const oldVisualRowAll = getCursorVisualRow(state.viewportOffset, oldCursorRowAll);

      const nextMap = new Map<number, RegionExpansion>();
      for (const region of regions) {
        nextMap.set(region.index, { fromTop: region.lineCount, fromBottom: 0 });
      }
      const expanded = applyRegionExpansion(state, nextMap, state.baseDiffData);

      // Pin cursor at same visual row
      const newCursorRowAll = expanded.diffMeta!.newLineToRow.get(expanded.cursorLine) ?? 0;
      const totalRowsAll = expanded.diffMeta!.rowCount + extraRows(expanded);
      const viewportOffset = stableViewportOffset(
        newCursorRowAll, oldVisualRowAll, state.viewportHeight, totalRowsAll,
      );
      return { ...expanded, viewportOffset };
    }
    case 'collapse_all_regions': {
      if (!state.baseDiffData || !state.diffMeta?.collapsedRegions) return state;

      // Capture current visual row before collapse
      const oldCursorRowC = state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0;
      const oldVisualRowC = getCursorVisualRow(state.viewportOffset, oldCursorRowC);

      const nextMap = new Map<number, RegionExpansion>();
      const collapsed = applyRegionExpansion(state, nextMap, state.baseDiffData);
      // Cursor may be on an expanded line that disappears — clamp it
      const cursorLine = clampCursor(collapsed, collapsed.cursorLine);

      // Pin cursor at same visual row
      const newCursorRowC = collapsed.diffMeta!.newLineToRow.get(cursorLine) ?? 0;
      const totalRowsC = collapsed.diffMeta!.rowCount + extraRows(collapsed);
      const viewportOffset = stableViewportOffset(
        newCursorRowC, oldVisualRowC, state.viewportHeight, totalRowsC,
      );
      const focusedAnnotationId = computeFocus(
        cursorLine, collapsed.annotations, collapsed.expandedAnnotations
      );
      return { ...collapsed, cursorLine, viewportOffset, focusedAnnotationId };
    }
    case 'set_expanded_regions': {
      if (!state.baseDiffData) return state;

      // Capture current visual row
      const oldCursorRowSet = state.viewMode === 'diff' && state.diffMeta
        ? (state.diffMeta.newLineToRow.get(state.cursorLine) ?? 0)
        : (state.cursorLine - 1);
      const oldVisualRowSet = getCursorVisualRow(state.viewportOffset, oldCursorRowSet);

      const expanded = applyRegionExpansion(state, action.expandedRegions, state.baseDiffData);

      // Pin cursor at same visual row
      const newCursorRowSet = expanded.diffMeta
        ? (expanded.diffMeta.newLineToRow.get(expanded.cursorLine) ?? 0)
        : (expanded.cursorLine - 1);
      const totalRowsSet = expanded.diffMeta
        ? expanded.diffMeta.rowCount + extraRows(expanded)
        : expanded.lineCount + extraRows(expanded);
      const viewportOffset = stableViewportOffset(
        newCursorRowSet, oldVisualRowSet, state.viewportHeight, totalRowsSet,
      );
      return { ...expanded, viewportOffset };
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
