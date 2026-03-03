/**
 * Pure rendering functions that build terminal frame strings from state.
 *
 * No side effects — the caller writes the returned string to the terminal.
 * Uses raw ANSI escapes for styling (inverse, dim, bold, color).
 */

import type { Annotation } from './schema.js';
import type {
  AnnotationFlowState,
  BrowseState,
  ConfirmFlowState,
  DecideFlowState,
  EditFlowState,
  GotoFlowState,
  Mode,
  ReplyFlowState,
  SearchFlowState,
  SearchState,
  Selection,
} from './state.js';
import { selectionRange } from './state.js';
import {
  CLEAR_LINE,
  CURSOR_BG,
  CYAN,
  DIM,
  GREEN,
  RED,
  RESET,
  SEARCH_CURRENT_LINE_BG,
  SEARCH_CURRENT_MATCH_BG,
  SEARCH_LINE_BG,
  SEARCH_MATCH_BG,
  SELECT_BG,
  YELLOW,
  bgLine,
  bold,
  colorBold,
  dim,
  highlightSearchMatches,
} from './ansi.js';
import { annotationsOnLine, renderAnnotationBox } from './annotation-box.js';
import { renderPicker } from './picker.js';
import { renderTextbox } from './textbox.js';

// --- Line marker ---

const lineMarker = (
  lineNumber: number,
  annotations: readonly Annotation[],
  expandedAnnotations: ReadonlySet<string>,
  focusAnnotation?: string
): '▼' | '◎' | '●' | ' ' => {
  const lineAnns = annotations.filter(
    (a) => lineNumber >= a.startLine && lineNumber <= a.endLine
  );
  if (lineAnns.length === 0) return ' ';

  const hasExpanded = lineAnns.some((a) => expandedAnnotations.has(a.id));
  if (hasExpanded) return '▼';

  if (typeof focusAnnotation === 'string') {
    const hasFocus = lineAnns.some((a) => a.id === focusAnnotation);
    if (hasFocus) return '◎';
  }

  return '●';
};

// --- Frame builders ---

const gutterBlank = (gutterWidth: number): string =>
  ' '.repeat(1 + gutterWidth + 1 + 1 + 1);

const renderViewport = (
  lines: string[],
  state: BrowseState,
  viewportHeight: number,
  cols: number,
  focusAnnotation?: string,
  selection?: Selection,
  search?: SearchState
): string[] => {
  const gutterWidth = String(lines.length).length;
  const rows: string[] = [];
  const selRange = selection ? selectionRange(selection) : undefined;
  const gutterPfx = gutterBlank(gutterWidth);
  const boxMaxWidth = Math.min(80, cols - gutterPfx.length);

  let lineIndex = state.viewportOffset;

  while (rows.length < viewportHeight) {
    if (lineIndex >= lines.length) {
      rows.push(`${CLEAR_LINE}~`);
      lineIndex++;
      continue;
    }

    const lineNumber = lineIndex + 1;
    const isCursor = lineNumber === state.cursorLine;
    const isSelected =
      selRange !== undefined &&
      lineNumber >= selRange.startLine &&
      lineNumber <= selRange.endLine;
    const pointer = isCursor ? '>' : ' ';
    const marker = lineMarker(
      lineNumber,
      state.annotations,
      state.expandedAnnotations,
      focusAnnotation
    );
    const paddedNum = String(lineNumber).padStart(gutterWidth, ' ');
    const raw = `${pointer}${paddedNum} ${marker} ${lines[lineIndex]}`;

    const isCurrentMatch =
      search !== undefined &&
      search.currentMatchIndex >= 0 &&
      search.matchLines[search.currentMatchIndex] === lineNumber;
    const isMatch =
      !isCurrentMatch &&
      search !== undefined &&
      search.matchLines.length > 0 &&
      search.matchLines.includes(lineNumber);

    // Apply inline substring highlighting on match lines
    let displayRaw = raw;
    if ((isCurrentMatch || isMatch) && search) {
      const inlineBg = isCurrentMatch ? SEARCH_CURRENT_MATCH_BG : SEARCH_MATCH_BG;
      displayRaw = highlightSearchMatches(raw, search.pattern, inlineBg);
    }

    const bg = isSelected
      ? SELECT_BG
      : isCurrentMatch
        ? SEARCH_CURRENT_LINE_BG
        : isMatch
          ? SEARCH_LINE_BG
          : isCursor
            ? CURSOR_BG
            : undefined;
    rows.push(`${CLEAR_LINE}${bg ? bgLine(displayRaw, bg, cols) : displayRaw}`);

    const expandedAnns = annotationsOnLine(state.annotations, lineNumber).filter(
      (a) => state.expandedAnnotations.has(a.id) && a.endLine === lineNumber
    );

    for (const ann of expandedAnns) {
      if (rows.length >= viewportHeight) break;
      const boxRows = renderAnnotationBox(ann, {
        maxWidth: boxMaxWidth,
        gutterPrefix: gutterPfx,
        isCursorLine: isCursor,
      });
      for (const boxRow of boxRows) {
        if (rows.length >= viewportHeight) break;
        rows.push(boxRow);
      }
    }

    lineIndex++;
  }

  return rows;
};

// --- Status bar ---

const MODE_COLORS: Record<Mode, string> = {
  browse: GREEN,
  decide: YELLOW,
  annotate: CYAN,
  goto: CYAN,
  select: YELLOW,
  reply: CYAN,
  edit: CYAN,
  confirm: RED,
  search: YELLOW,
};

const renderStatusBar = (state: BrowseState, filePath: string): string => {
  const modeTag = colorBold(
    MODE_COLORS[state.mode],
    ` ${state.mode.toUpperCase()} `
  );
  const count = state.annotations.length;
  const selInfo =
    state.mode === 'select' && state.selection
      ? (() => {
          const r = selectionRange(state.selection);
          const span = r.endLine - r.startLine + 1;
          return `  sel ${r.startLine}–${r.endLine} (${span} ln${span === 1 ? '' : 's'})`;
        })()
      : '';
  const searchInfo = state.search && state.search.matchLines.length > 0
    ? `  "${state.search.pattern}" ${state.search.currentMatchIndex + 1}/${state.search.matchLines.length}`
    : state.search && state.search.pattern.length > 0
      ? `  "${state.search.pattern}" 0 matches`
      : '';
  const info = dim(
    `  ln ${state.cursorLine}/${state.lineCount}${selInfo}  ${count} annotation${count === 1 ? '' : 's'}${searchInfo}  raw  ${filePath}`
  );
  return `${CLEAR_LINE}${modeTag}${info}`;
};

// --- Help bar (browse/select only) ---

const BROWSE_HELP =
  '[j/k ↑↓] move  [v Shift+↑↓] select  [Tab/S-Tab] annotations  [/] search  [a] annotate  [:] goto  [q] finish';
const BROWSE_SEARCH_HELP =
  '[j/k ↑↓] move  [n/N] next/prev match  [/] new search  [Esc] clear  [a] annotate  [q] finish';
const BROWSE_EXPANDED_HELP =
  '[j/k ↑↓] move  [Tab/S-Tab] next/prev  [r]eply  [w] edit  [x] delete  [c] toggle  [C] toggle all  [a] new  [q] finish';
const SELECT_HELP =
  '[j/k ↑↓ Shift+↑↓] extend  [Enter] annotate  [Esc] cancel';

const renderHelpBar = (state: BrowseState): string => {
  if (state.mode === 'select') return `${CLEAR_LINE}${dim(SELECT_HELP)}`;
  if (state.mode === 'browse') {
    // Show annotation-specific hints when on an expanded annotation line
    const hasExpanded = annotationsOnLine(state.annotations, state.cursorLine)
      .some((a) => state.expandedAnnotations.has(a.id));
    const hasSearch = state.search !== undefined && state.search.matchLines.length > 0;
    const hints = hasExpanded ? BROWSE_EXPANDED_HELP : hasSearch ? BROWSE_SEARCH_HELP : BROWSE_HELP;
    return `${CLEAR_LINE}${dim(hints)}`;
  }
  return CLEAR_LINE;
};

// --- Annotation flow modal ---

const renderAnnotationModal = (
  flow: AnnotationFlowState,
  cursorLine: number,
  cols: number
): string[] => {
  if (flow.step === 'intent') {
    return renderPicker(flow.picker, {
      label: 'Intent',
      cols,
    });
  }

  if (flow.step === 'category') {
    return renderPicker(flow.picker, {
      label: 'Category',
      labelHint: 'Enter to skip',
      cols,
      hints: `${DIM}↑↓ move · Enter select/skip · Esc cancel${RESET}`,
    });
  }

  // Comment step — textbox
  const contextParts: string[] = [];
  if (flow.intent) contextParts.push(`Intent: ${flow.intent}`);
  if (flow.category) contextParts.push(`Category: ${flow.category}`);

  return renderTextbox(flow.comment, {
    label: `Annotate line ${cursorLine}`,
    cols,
    context: contextParts.length > 0 ? contextParts.join(' · ') : undefined,
  });
};

// --- Goto modal ---

const renderGotoModal = (
  flow: GotoFlowState,
  lineCount: number,
  cols: number
): string[] => {
  // Simple bordered prompt matching the picker style
  const label = `Go to line (1–${lineCount})`;
  const content = flow.input.length > 0 ? flow.input : '';
  const cursor = `\x1b[7m \x1b[27m`; // reverse video space
  const inner = `${content}${cursor}`;

  const maxW = Math.min(60, cols - 2);
  const innerWidth = Math.max(20, maxW - 4);
  const border = `\x1b[38;2;88;95;108m`; // ANN_BORDER
  const fillLen = Math.max(0, innerWidth - label.length - 1);

  const rows: string[] = [];
  rows.push(
    `${CLEAR_LINE}${border}┌─ ${label} ${border}${'─'.repeat(fillLen)}┐${RESET}`
  );

  const pad = (s: string, w: number) => {
    const vis = s.replace(/\x1b\[[0-9;]*m/g, '').length;
    return vis < w ? `${s}${' '.repeat(w - vis)}` : s;
  };

  rows.push(
    `${CLEAR_LINE}${border}│${RESET}${pad(` ${inner} `, innerWidth + 2)}${border}│${RESET}`
  );

  const hints = `${DIM}Enter jump · Esc cancel${RESET}`;
  rows.push(
    `${CLEAR_LINE}${border}│${RESET}${pad(` ${hints} `, innerWidth + 2)}${border}│${RESET}`
  );

  rows.push(
    `${CLEAR_LINE}${border}└${'─'.repeat(innerWidth + 2)}┘${RESET}`
  );

  return rows;
};

// --- Decision modal ---

const renderDecisionModal = (
  flow: DecideFlowState,
  cols: number
): string[] => {
  return renderPicker(flow.picker, {
    label: 'Decision',
    cols,
    hints: `${DIM}↑↓ move · Enter select · Esc cancel${RESET}`,
  });
};

// --- Confirm modal ---

const renderConfirmModal = (
  flow: ConfirmFlowState,
  annotations: readonly Annotation[],
  cols: number
): string[] => {
  const ann = annotations.find((a) => a.id === flow.annotationId);
  const label = ann
    ? `Delete annotation on L${ann.startLine}${ann.endLine !== ann.startLine ? `–${ann.endLine}` : ''}?`
    : 'Delete annotation?';
  return renderPicker(flow.picker, {
    label,
    cols,
    hints: `${DIM}↑↓ move · Enter confirm · Esc cancel${RESET}`,
  });
};

// --- Search modal ---

const renderSearchModal = (
  flow: SearchFlowState,
  searchState: SearchState | undefined,
  cols: number
): string[] => {
  return renderTextbox(flow.input, {
    label: 'Search',
    cols,
    visibleRows: 1,
    context: searchState && searchState.matchLines.length > 0
      ? `${searchState.currentMatchIndex + 1}/${searchState.matchLines.length} matches`
      : searchState && searchState.pattern.length > 0
        ? '0 matches'
        : undefined,
  });
};

// --- Reply / Edit modals ---

const renderReplyModal = (flow: ReplyFlowState, cols: number): string[] => {
  return renderTextbox(flow.comment, {
    label: 'Reply',
    cols,
    visibleRows: 4,
  });
};

const renderEditModal = (flow: EditFlowState, cols: number): string[] => {
  return renderTextbox(flow.comment, {
    label: 'Edit comment',
    cols,
  });
};

// --- Public API ---

export type RenderContext = {
  filePath: string;
  lines: string[];
  state: BrowseState;
  terminalRows: number;
  terminalCols: number;
  focusAnnotation?: string;
  annotationFlow?: AnnotationFlowState;
  gotoFlow?: GotoFlowState;
  replyFlow?: ReplyFlowState;
  editFlow?: EditFlowState;
  decideFlow?: DecideFlowState;
  confirmFlow?: ConfirmFlowState;
  searchFlow?: SearchFlowState;
};

/** Compute modal height for a given render context. */
const modalHeight = (ctx: RenderContext): number => {
  if (ctx.state.mode === 'annotate' && ctx.annotationFlow) {
    if (ctx.annotationFlow.step === 'intent') return 7; // picker: 4 options + 3 chrome
    if (ctx.annotationFlow.step === 'category') return 10; // picker: 7 options + 3 chrome
    // comment textbox
    const hasContext = !!(ctx.annotationFlow.intent);
    return 9 + (hasContext ? 1 : 0); // textbox: 6 rows + 3 chrome + context
  }
  if (ctx.state.mode === 'confirm' && ctx.confirmFlow) return 5; // 2 options + 3 chrome
  if (ctx.state.mode === 'decide' && ctx.decideFlow) return 5; // 2 options + 3 chrome
  if (ctx.state.mode === 'goto' && ctx.gotoFlow) return 4;
  if (ctx.state.mode === 'reply' && ctx.replyFlow) return 7; // 4 rows + 3 chrome
  if (ctx.state.mode === 'edit' && ctx.editFlow) return 9; // 6 rows + 3 chrome
  if (ctx.state.mode === 'search' && ctx.searchFlow) return 5; // 1 row + 3 chrome + context
  return 0;
};

/** Number of fixed chrome lines (title + status). */
const FIXED_CHROME = 2;

/**
 * Build a complete terminal frame as a single string.
 *
 * The caller should write this with cursor homed (`\x1b[H`) so the frame
 * overwrites the previous one in-place — no clearing required.
 */
export const buildFrame = (ctx: RenderContext): string => {
  const mH = modalHeight(ctx);
  const hasModal = mH > 0;

  // Help bar only in browse/select modes (when no modal is showing)
  const helpBarHeight = hasModal ? 0 : 1;

  const viewportHeight = Math.max(
    3,
    ctx.terminalRows - FIXED_CHROME - helpBarHeight - mH
  );

  const frame: string[] = [];

  // Title
  frame.push(`${CLEAR_LINE}${bold(`Quill — ${ctx.filePath}`)}`);

  // Viewport
  frame.push(
    ...renderViewport(
      ctx.lines,
      ctx.state,
      viewportHeight,
      ctx.terminalCols,
      ctx.focusAnnotation,
      ctx.state.selection,
      ctx.state.search
    )
  );

  // Status bar
  frame.push(renderStatusBar(ctx.state, ctx.filePath));

  // Help bar (browse/select only)
  if (!hasModal) {
    frame.push(renderHelpBar(ctx.state));
  }

  // Modal overlays
  if (ctx.state.mode === 'annotate' && ctx.annotationFlow) {
    frame.push(
      ...renderAnnotationModal(
        ctx.annotationFlow,
        ctx.state.cursorLine,
        ctx.terminalCols
      )
    );
  }
  if (ctx.state.mode === 'confirm' && ctx.confirmFlow) {
    frame.push(
      ...renderConfirmModal(ctx.confirmFlow, ctx.state.annotations, ctx.terminalCols)
    );
  }
  if (ctx.state.mode === 'decide' && ctx.decideFlow) {
    frame.push(...renderDecisionModal(ctx.decideFlow, ctx.terminalCols));
  }
  if (ctx.state.mode === 'goto' && ctx.gotoFlow) {
    frame.push(
      ...renderGotoModal(ctx.gotoFlow, ctx.state.lineCount, ctx.terminalCols)
    );
  }
  if (ctx.state.mode === 'reply' && ctx.replyFlow) {
    frame.push(...renderReplyModal(ctx.replyFlow, ctx.terminalCols));
  }
  if (ctx.state.mode === 'edit' && ctx.editFlow) {
    frame.push(...renderEditModal(ctx.editFlow, ctx.terminalCols));
  }
  if (ctx.state.mode === 'search' && ctx.searchFlow) {
    frame.push(
      ...renderSearchModal(ctx.searchFlow, ctx.state.search, ctx.terminalCols)
    );
  }

  // Pad remaining terminal rows
  while (frame.length < ctx.terminalRows) {
    frame.push(CLEAR_LINE);
  }

  return frame.join('\n');
};

/** Compute the viewport height for a given terminal height and context. */
export const getViewportHeight = (terminalRows: number): number =>
  Math.max(3, terminalRows - FIXED_CHROME - 1); // -1 for help bar in browse mode

// Keep for backward compat with cli.ts initial state calculation
export const VIEWPORT_CHROME_LINES = 3;
