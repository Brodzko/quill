/**
 * Bordered textbox renderer for multi-line text input.
 *
 * Renders a TextBuffer as a bordered box with visible cursor,
 * auto-scroll for long content, and hint bar. Pure functions.
 */

import {
  ANN_BORDER,
  CLEAR_LINE,
  DIM,
  RESET,
  REVERSE,
  REVERSE_OFF,
  visibleLength,
} from './ansi.js';
import type { TextBuffer } from './text-buffer.js';
import { scrollForCursor } from './text-buffer.js';

// --- Box drawing ---

const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
} as const;

const padTo = (text: string, width: number): string => {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  return `${text}${' '.repeat(width - vis)}`;
};

// --- Cursor rendering ---

/**
 * Render a text line with the cursor shown as reverse-video block.
 * Only call for the line containing the cursor.
 */
const renderCursorLine = (line: string, col: number): string => {
  const before = line.slice(0, col);
  const cursorChar = col < line.length ? line[col] : ' ';
  const after = col < line.length ? line.slice(col + 1) : '';
  return `${before}${REVERSE}${cursorChar}${REVERSE_OFF}${after}`;
};

// --- Public API ---

export type RenderTextboxOptions = {
  /** Label shown in the top border. */
  readonly label: string;
  /** Number of visible text rows (default: 6). */
  readonly visibleRows?: number;
  /** Max box width including borders. */
  readonly maxWidth?: number;
  /** Terminal columns. */
  readonly cols: number;
  /** Hint text for the bottom area. */
  readonly hints?: string;
  /** Context line shown above the text area (e.g. previous flow step info). */
  readonly context?: string;
};

/**
 * Render a textbox as a bordered box — an array of ANSI-styled strings.
 * Each string is one terminal row (includes CLEAR_LINE).
 */
export const renderTextbox = (
  buf: TextBuffer,
  opts: RenderTextboxOptions
): string[] => {
  const visRows = opts.visibleRows ?? 6;
  const maxW = Math.min(opts.maxWidth ?? opts.cols, opts.cols - 2);
  const innerWidth = Math.max(20, maxW - 4); // minus │ + space on each side
  const rows: string[] = [];

  // --- Top border with label ---
  const labelVis = visibleLength(opts.label);
  const fillLen = Math.max(0, innerWidth - labelVis - 1);
  const topBorder = `${ANN_BORDER}${BOX.topLeft}${BOX.horizontal} ${opts.label} ${ANN_BORDER}${BOX.horizontal.repeat(fillLen)}${BOX.topRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${topBorder}`);

  // --- Context line (optional) ---
  if (opts.context) {
    const ctxContent = ` ${DIM}${opts.context}${RESET} `;
    const ctxPadded = padTo(ctxContent, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${ANN_BORDER}${BOX.vertical}${RESET}${ctxPadded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Text area ---
  const scrollOffset = scrollForCursor(buf.cursor.row, visRows, buf.lines.length);
  const visibleSlice = buf.lines.slice(scrollOffset, scrollOffset + visRows);

  for (let i = 0; i < visRows; i++) {
    const lineIdx = scrollOffset + i;
    const rawLine = visibleSlice[i] ?? '';
    const isCursorRow = lineIdx === buf.cursor.row;
    const displayLine = isCursorRow
      ? renderCursorLine(rawLine, buf.cursor.col)
      : rawLine;

    // Truncate to inner width (simple truncation, no ANSI in user text)
    const truncated =
      rawLine.length > innerWidth && !isCursorRow
        ? rawLine.slice(0, innerWidth - 1) + '…'
        : displayLine;

    const content = ` ${truncated} `;
    const padded = padTo(content, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${ANN_BORDER}${BOX.vertical}${RESET}${padded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Scroll indicator ---
  if (buf.lines.length > visRows) {
    const pct = Math.round(((scrollOffset + visRows) / buf.lines.length) * 100);
    const scrollInfo = `${DIM}${pct}% (${buf.lines.length} lines)${RESET}`;
    const scrollContent = ` ${scrollInfo} `;
    const scrollPadded = padTo(scrollContent, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${ANN_BORDER}${BOX.vertical}${RESET}${scrollPadded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Hints row ---
  const defaultHints = `${DIM}Enter submit · ⇧Enter / ⌥Enter new line · Esc cancel${RESET}`;
  const hintsText = opts.hints ?? defaultHints;
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

/** Compute the total height (rows) a textbox will occupy. */
export const textboxHeight = (
  buf: TextBuffer,
  opts: { visibleRows?: number; context?: boolean }
): number => {
  const visRows = opts.visibleRows ?? 6;
  const hasScroll = buf.lines.length > visRows;
  return (
    1 + // top border
    (opts.context ? 1 : 0) + // context line
    visRows + // text area
    (hasScroll ? 1 : 0) + // scroll indicator
    1 + // hints
    1 // bottom border
  );
};
