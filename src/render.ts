/**
 * Pure rendering functions that build terminal frame strings from state.
 *
 * No side effects — the caller writes the returned string to the terminal.
 * Uses raw ANSI escapes for styling (inverse, dim, bold, color).
 */

import type { Annotation } from './schema.js';
import type { BrowseState, Mode } from './state.js';

// --- ANSI escape helpers ---

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const INVERSE = `${ESC}7m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const CYAN = `${ESC}36m`;
const RED = `${ESC}31m`;
const CLEAR_LINE = `${ESC}2K`;

const bold = (s: string): string => `${BOLD}${s}${RESET}`;
const dim = (s: string): string => `${DIM}${s}${RESET}`;
const inverse = (s: string): string => `${INVERSE}${s}${RESET}`;
const colorBold = (color: string, s: string): string =>
  `${color}${BOLD}${s}${RESET}`;

// --- Annotation flow types ---

export type AnnotationFlowState = {
  step: 'intent' | 'category' | 'comment';
  intent?: string;
  category?: string;
  comment: string;
};

export const INITIAL_ANNOTATION_FLOW: AnnotationFlowState = {
  step: 'intent',
  comment: '',
};

// --- Line marker ---

const lineMarker = (
  lineNumber: number,
  annotations: Annotation[],
  focusAnnotation?: string
): '◎' | '●' | ' ' => {
  if (typeof focusAnnotation === 'string') {
    const hasFocus = annotations.some(
      (a) =>
        a.id === focusAnnotation &&
        lineNumber >= a.startLine &&
        lineNumber <= a.endLine
    );
    if (hasFocus) return '◎';
  }

  const hasAnnotation = annotations.some(
    (a) => lineNumber >= a.startLine && lineNumber <= a.endLine
  );
  return hasAnnotation ? '●' : ' ';
};

// --- Frame builders ---

const renderViewport = (
  lines: string[],
  state: BrowseState,
  viewportHeight: number,
  focusAnnotation?: string
): string[] => {
  const gutterWidth = String(lines.length).length;
  const rows: string[] = [];

  for (let i = 0; i < viewportHeight; i++) {
    const lineIndex = state.viewportOffset + i;
    if (lineIndex >= lines.length) {
      rows.push(`${CLEAR_LINE}~`);
      continue;
    }

    const lineNumber = lineIndex + 1;
    const isCursor = lineNumber === state.cursorLine;
    const pointer = isCursor ? '>' : ' ';
    const marker = lineMarker(
      lineNumber,
      state.annotations,
      focusAnnotation
    );
    const paddedNum = String(lineNumber).padStart(gutterWidth, ' ');
    const raw = `${pointer}${paddedNum} ${marker} ${lines[lineIndex]}`;

    rows.push(`${CLEAR_LINE}${isCursor ? inverse(raw) : raw}`);
  }

  return rows;
};

const MODE_COLORS: Record<Mode, string> = {
  browse: GREEN,
  decide: YELLOW,
  annotate: CYAN,
};

const renderStatusBar = (state: BrowseState, filePath: string): string => {
  const modeTag = colorBold(
    MODE_COLORS[state.mode],
    ` ${state.mode.toUpperCase()} `
  );
  const count = state.annotations.length;
  const info = dim(
    `  ln ${state.cursorLine}/${state.lineCount}  ${count} annotation${count === 1 ? '' : 's'}  raw  ${filePath}`
  );
  return `${CLEAR_LINE}${modeTag}${info}`;
};

const HELP_HINTS: Record<Mode, string> = {
  browse: '[j/k ↑↓] move  [n] annotate  [q] finish  [Ctrl+C] abort',
  decide: '[a] approve  [d] deny  [Esc] back',
  annotate: '[Esc] cancel',
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

// --- Public API ---

export type RenderContext = {
  filePath: string;
  lines: string[];
  state: BrowseState;
  terminalRows: number;
  terminalCols: number;
  focusAnnotation?: string;
  annotationFlow?: AnnotationFlowState;
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
    ...renderViewport(ctx.lines, ctx.state, viewportHeight, ctx.focusAnnotation)
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

  // Pad remaining terminal rows with cleared lines to avoid leftover content
  while (frame.length < ctx.terminalRows) {
    frame.push(CLEAR_LINE);
  }

  return frame.join('\n');
};

/** Compute the viewport height for a given terminal height. */
export const getViewportHeight = (terminalRows: number): number =>
  Math.max(3, terminalRows - VIEWPORT_CHROME_LINES - 1);
