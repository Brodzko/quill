/**
 * Navigable option picker — state, operations, and ANSI renderer.
 *
 * Supports arrow navigation with highlighted option + direct shortcut keys.
 * Pure functions — no side effects.
 */

import {
  ANN_BORDER,
  BOLD,
  CLEAR_LINE,
  CYAN,
  DIM,
  RESET,
  visibleLength,
} from './ansi.js';

// --- Types ---

export type PickerOption = {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  readonly hint?: string;
};

export type PickerState = {
  readonly options: readonly PickerOption[];
  readonly highlighted: number;
};

// --- State operations ---

export const createPicker = (
  options: readonly PickerOption[],
  initialHighlight = 0
): PickerState => ({
  options,
  highlighted: Math.max(0, Math.min(initialHighlight, options.length - 1)),
});

export const moveHighlight = (state: PickerState, delta: number): PickerState => {
  const len = state.options.length;
  if (len === 0) return state;
  // Wrap around
  const next = ((state.highlighted + delta) % len + len) % len;
  return { ...state, highlighted: next };
};

export const getHighlighted = (state: PickerState): PickerOption | undefined =>
  state.options[state.highlighted];

export const findByShortcut = (
  state: PickerState,
  char: string
): PickerOption | undefined =>
  state.options.find((o) => o.shortcut === char);

// --- Renderer ---

const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
} as const;

/** Pad a styled string to `width` visible chars. */
const padTo = (text: string, width: number): string => {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  return `${text}${' '.repeat(width - vis)}`;
};

export type RenderPickerOptions = {
  /** Label shown in the top border. */
  readonly label: string;
  /** Max box width (including borders). Capped by cols. */
  readonly maxWidth?: number;
  /** Terminal columns. */
  readonly cols: number;
  /** Extra hint text in the top border (e.g. "Enter to skip"). */
  readonly labelHint?: string;
  /** Custom hint line (replaces default navigation hints). */
  readonly hints?: string;
};

/**
 * Render a picker as a bordered box — an array of ANSI-styled strings.
 * Each string is one terminal row (includes CLEAR_LINE).
 */
export const renderPicker = (
  state: PickerState,
  opts: RenderPickerOptions
): string[] => {
  const maxW = Math.min(opts.maxWidth ?? 60, opts.cols - 2);
  const innerWidth = Math.max(20, maxW - 4); // minus │ + space on each side
  const rows: string[] = [];

  // --- Top border with label ---
  const labelText = opts.labelHint
    ? `${opts.label} ${DIM}(${opts.labelHint})${RESET}`
    : opts.label;
  const labelVis = visibleLength(labelText);
  const fillLen = Math.max(0, innerWidth - labelVis - 1);
  const topBorder = `${ANN_BORDER}${BOX.topLeft}${BOX.horizontal} ${labelText} ${ANN_BORDER}${BOX.horizontal.repeat(fillLen)}${BOX.topRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${topBorder}`);

  // --- Option rows ---
  for (let i = 0; i < state.options.length; i++) {
    const opt = state.options[i]!;
    const isHL = i === state.highlighted;
    const marker = isHL ? `${CYAN}${BOLD}▸${RESET}` : ' ';
    const shortcut = isHL
      ? `${CYAN}${BOLD}[${opt.shortcut}]${RESET}`
      : `${DIM}[${opt.shortcut}]${RESET}`;
    const label = isHL
      ? `${CYAN}${BOLD}${opt.label}${RESET}`
      : opt.label;
    const hint = opt.hint ? `  ${DIM}${opt.hint}${RESET}` : '';
    const content = ` ${marker} ${shortcut} ${label}${hint} `;
    const padded = padTo(content, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${ANN_BORDER}${BOX.vertical}${RESET}${padded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Hints row ---
  const hintsText = opts.hints ?? `${DIM}↑↓ move · Enter select · Esc cancel${RESET}`;
  const hintContent = ` ${hintsText} `;
  const hintPadded = padTo(hintContent, innerWidth + 2);
  rows.push(
    `${CLEAR_LINE}${ANN_BORDER}${BOX.vertical}${RESET}${hintPadded}${ANN_BORDER}${BOX.vertical}${RESET}`
  );

  // --- Bottom border ---
  const bottomBorder = `${ANN_BORDER}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${bottomBorder}`);

  return rows;
};

// --- Pre-defined option sets ---

export const INTENT_OPTIONS: readonly PickerOption[] = [
  { id: 'instruct', label: 'instruct', shortcut: 'i', hint: 'direct the agent to fix' },
  { id: 'question', label: 'question', shortcut: 'q', hint: 'ask the agent to explain' },
  { id: 'comment', label: 'comment', shortcut: 'c', hint: 'note for review system' },
  { id: 'praise', label: 'praise', shortcut: 'p', hint: 'positive feedback' },
];

export const CATEGORY_OPTIONS: readonly PickerOption[] = [
  { id: '', label: '(none)', shortcut: ' ', hint: 'skip category' },
  { id: 'bug', label: 'bug', shortcut: 'b', hint: 'correctness issue' },
  { id: 'security', label: 'security', shortcut: 's', hint: 'security concern' },
  { id: 'performance', label: 'performance', shortcut: 'f', hint: 'perf issue' },
  { id: 'design', label: 'design', shortcut: 'd', hint: 'architecture / structure' },
  { id: 'style', label: 'style', shortcut: 't', hint: 'naming, formatting' },
  { id: 'nitpick', label: 'nitpick', shortcut: 'n', hint: 'minor, non-blocking' },
];

export const DECISION_OPTIONS: readonly PickerOption[] = [
  { id: 'approve', label: 'approve', shortcut: 'a' },
  { id: 'deny', label: 'deny', shortcut: 'd' },
];

export const CONFIRM_OPTIONS: readonly PickerOption[] = [
  { id: 'no', label: 'no', shortcut: 'n' },
  { id: 'yes', label: 'yes', shortcut: 'y' },
];
