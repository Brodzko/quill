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
  EditFlowState,
  GotoFlowState,
  Mode,
  ReplyFlowState,
  Selection,
} from './state.js';
import { selectionRange } from './state.js';
import {
  CLEAR_LINE,
  CURSOR_BG,
  CYAN,
  GREEN,
  RED,
  SELECT_BG,
  YELLOW,
  bgLine,
  bold,
  colorBold,
  dim,
} from './ansi.js';
import { annotationsOnLine, renderAnnotationBox } from './annotation-box.js';

// --- Annotation flow rendering ---

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

  // Check for expanded annotations on this line
  const hasExpanded = lineAnns.some((a) => expandedAnnotations.has(a.id));
  if (hasExpanded) return '▼';

  if (typeof focusAnnotation === 'string') {
    const hasFocus = lineAnns.some((a) => a.id === focusAnnotation);
    if (hasFocus) return '◎';
  }

  return '●';
};

// --- Frame builders ---

/**
 * Build the gutter prefix for annotation box rows.
 * Matches the width of ">{lineNum} {marker} " but blank.
 */
const gutterBlank = (gutterWidth: number): string =>
  ' '.repeat(1 + gutterWidth + 1 + 1 + 1); // pointer + num + space + marker + space

const renderViewport = (
  lines: string[],
  state: BrowseState,
  viewportHeight: number,
  cols: number,
  focusAnnotation?: string,
  selection?: Selection
): string[] => {
  const gutterWidth = String(lines.length).length;
  const rows: string[] = [];
  const selRange = selection ? selectionRange(selection) : undefined;
  const gutterPfx = gutterBlank(gutterWidth);

  // Max width for annotation boxes: cols minus gutter, capped at 80
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

    const bg = isSelected ? SELECT_BG : isCursor ? CURSOR_BG : undefined;
    rows.push(`${CLEAR_LINE}${bg ? bgLine(raw, bg, cols) : raw}`);

    // Interleave expanded annotation boxes after the last line of each annotation's range
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

const MODE_COLORS: Record<Mode, string> = {
  browse: GREEN,
  decide: YELLOW,
  annotate: CYAN,
  goto: CYAN,
  select: YELLOW,
  reply: CYAN,
  edit: CYAN,
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
  const info = dim(
    `  ln ${state.cursorLine}/${state.lineCount}${selInfo}  ${count} annotation${count === 1 ? '' : 's'}  raw  ${filePath}`
  );
  return `${CLEAR_LINE}${modeTag}${info}`;
};

const HELP_HINTS: Record<Mode, string> = {
  browse:
    '[j/k ↑↓] move  [v Shift+↑↓] select  [Tab] toggle annotation  [PgUp/Dn Ctrl+U/D] half-page  [gg/G Home/End] jump  [:] goto  [n] annotate  [q] finish',
  decide: '[a] approve  [d] deny  [Esc] back',
  annotate: '[Esc] cancel',
  goto: '',
  select:
    '[j/k ↑↓ Shift+↑↓] extend  [Enter] annotate  [Esc] cancel',
  reply: '[Enter] submit  [Esc] cancel',
  edit: '[Enter] save  [Esc] cancel',
};

const renderHelpBar = (mode: Mode): string =>
  `${CLEAR_LINE}${dim(HELP_HINTS[mode])}`;

const renderDecisionPicker = (): string[] => [
  CLEAR_LINE,
  `${CLEAR_LINE}${colorBold(YELLOW, 'Decision required:')}`,
  `${CLEAR_LINE}  ${colorBold(GREEN, '[a]')} approve  ${colorBold(RED, '[d]')} deny  ${dim('[Esc]')} back`,
];

const renderAnnotationFlow = (
  cursorLine: number,
  flow: AnnotationFlowState
): string[] => {
  const rows: string[] = [
    CLEAR_LINE,
    `${CLEAR_LINE}${colorBold(CYAN, `Annotate line ${cursorLine}`)}`,
  ];

  if (flow.step === 'intent') {
    rows.push(
      `${CLEAR_LINE}Intent: ${bold('[i]')}nstruct  ${bold('[q]')}uestion  ${bold('[c]')}omment  ${bold('[p]')}raise  ${dim('[Esc] cancel')}`
    );
  } else if (flow.step === 'category') {
    rows.push(`${CLEAR_LINE}${dim(`Intent: ${flow.intent}`)}`);
    rows.push(
      `${CLEAR_LINE}Category: ${bold('[b]')}ug  ${bold('[s]')}ecurity  per${bold('[f]')}ormance  ${bold('[d]')}esign  s${bold('[t]')}yle  nit pic${bold('[k]')}  ${dim('[Enter] skip  [Esc] cancel')}`
    );
  } else {
    rows.push(
      `${CLEAR_LINE}${dim(`Intent: ${flow.intent}${flow.category ? `  Category: ${flow.category}` : ''}`)}`
    );
    rows.push(`${CLEAR_LINE}Comment: ${flow.comment}${dim('▎')}`);
    rows.push(`${CLEAR_LINE}${dim('[Enter] submit  [Esc] cancel')}`);
  }

  return rows;
};

// --- Goto prompt ---

const renderGotoPrompt = (flow: GotoFlowState, lineCount: number): string =>
  `${CLEAR_LINE}${colorBold(CYAN, 'Go to line:')} ${flow.input}${dim('▎')}  ${dim(`(1–${lineCount})  [Enter] jump  [Esc] cancel`)}`;

// --- Reply prompt ---

const renderReplyPrompt = (flow: ReplyFlowState): string =>
  `${CLEAR_LINE}${colorBold(CYAN, 'Reply:')} ${flow.comment}${dim('▎')}  ${dim('[Enter] submit  [Esc] cancel')}`;

// --- Edit prompt ---

const renderEditPrompt = (flow: EditFlowState): string =>
  `${CLEAR_LINE}${colorBold(CYAN, 'Edit comment:')} ${flow.comment}${dim('▎')}  ${dim('[Enter] save  [Esc] cancel')}`;

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
};

/** Number of chrome rows below the viewport (status + help + potential modal). */
export const VIEWPORT_CHROME_LINES = 3; // title + status + help

/**
 * Build a complete terminal frame as a single string.
 *
 * The caller should write this with cursor homed (`\x1b[H`) so the frame
 * overwrites the previous one in-place — no clearing required.
 */
export const buildFrame = (ctx: RenderContext): string => {
  const viewportHeight = Math.max(
    3,
    ctx.terminalRows - VIEWPORT_CHROME_LINES - 1 // -1 for title row
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
      ctx.state.selection
    )
  );

  // Status + Help
  frame.push(renderStatusBar(ctx.state, ctx.filePath));
  frame.push(renderHelpBar(ctx.state.mode));

  // Modal overlays
  if (ctx.state.mode === 'decide') {
    frame.push(...renderDecisionPicker());
  }
  if (ctx.state.mode === 'annotate' && ctx.annotationFlow) {
    frame.push(
      ...renderAnnotationFlow(ctx.state.cursorLine, ctx.annotationFlow)
    );
  }
  if (ctx.state.mode === 'goto' && ctx.gotoFlow) {
    frame.push(renderGotoPrompt(ctx.gotoFlow, ctx.state.lineCount));
  }
  if (ctx.state.mode === 'reply' && ctx.replyFlow) {
    frame.push(renderReplyPrompt(ctx.replyFlow));
  }
  if (ctx.state.mode === 'edit' && ctx.editFlow) {
    frame.push(renderEditPrompt(ctx.editFlow));
  }

  // Pad remaining terminal rows with cleared lines to avoid leftover content
  while (frame.length < ctx.terminalRows) {
    frame.push(CLEAR_LINE);
  }

  return frame.join('\n');
};

/** Compute the viewport height for a given terminal height. */
export const getViewportHeight = (terminalRows: number): number =>
  Math.max(3, terminalRows - VIEWPORT_CHROME_LINES - 1);
