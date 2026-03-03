/**
 * Pure functions for rendering GitLab-style annotation boxes.
 *
 * An annotation box is a bordered block displayed between source lines,
 * showing the annotation's metadata, comment, replies, and action hints.
 */

import type { Annotation } from './schema.js';
import {
  ANN_BORDER,
  AGENT_ACCENT,
  BOLD,
  CLEAR_LINE,
  DIM,
  GREEN,
  ITALIC,
  RESET,
  USER_ACCENT,
  visibleLength,
} from './ansi.js';

// --- Box drawing characters ---

const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  replyArrow: '↳',
} as const;

// --- Helpers ---

/** Word-wrap a single paragraph (no newlines) to fit within `maxWidth`. */
const wrapParagraph = (text: string, maxWidth: number): string[] => {
  const words = text.split(/[ \t]+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length === 0) lines.push('');
  return lines;
};

/**
 * Word-wrap a string to fit within `maxWidth` visible characters.
 * Preserves explicit newlines — each `\n` produces a line break.
 */
export const wordWrap = (text: string, maxWidth: number): string[] => {
  if (maxWidth <= 0) return [text];
  const paragraphs = text.split('\n');
  return paragraphs.flatMap((p) => wrapParagraph(p, maxWidth));
};

/** Pad or truncate `text` to exactly `width` visible chars. */
const padTo = (text: string, width: number): string => {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  return `${text}${' '.repeat(width - vis)}`;
};

const sourceLabel = (source: string): string =>
  source === 'user' ? 'you' : source;

const sourceColor = (source: string): string =>
  source === 'user' ? USER_ACCENT : AGENT_ACCENT;

/** Format the status indicator for an annotation. */
const statusIndicator = (status?: 'approved' | 'dismissed'): string => {
  if (status === 'approved') return `${GREEN}${BOLD}✓ approved${RESET}`;
  if (status === 'dismissed') return `${DIM}✗ dismissed${RESET}`;
  return '';
};

// --- Public API ---

export type AnnotationBoxOptions = {
  /** Max visible width of the box (including borders). */
  maxWidth: number;
  /** Gutter prefix string (spaces matching line number gutter). */
  gutterPrefix: string;
  /** Whether this annotation's line is the cursor line (shows action hints). */
  isCursorLine: boolean;
};

/**
 * Render an annotation as a bordered box — an array of ANSI-styled strings,
 * one per display row. Each string is prefixed with the gutter.
 */
export const renderAnnotationBox = (
  annotation: Annotation,
  options: AnnotationBoxOptions
): string[] => {
  const { maxWidth, gutterPrefix, isCursorLine } = options;
  // Inner width = maxWidth minus borders (│ + space on each side)
  const innerWidth = Math.max(20, maxWidth - 4);
  const rows: string[] = [];

  // --- Header line ---
  const srcLabel = sourceLabel(annotation.source);
  const srcClr = sourceColor(annotation.source);
  const headerParts = [
    `${srcClr}${BOLD}${srcLabel}${RESET}`,
    `${DIM}·${RESET}`,
    `${DIM}${annotation.intent}${RESET}`,
  ];
  if (annotation.category) {
    headerParts.push(`${DIM}·${RESET}`, `${DIM}${annotation.category}${RESET}`);
  }
  const headerText = headerParts.join(' ');
  const headerVisLen = visibleLength(headerText);
  const fillLen = Math.max(0, innerWidth - headerVisLen - 1);
  const topBorder = `${ANN_BORDER}${BOX.topLeft}${BOX.horizontal} ${headerText} ${ANN_BORDER}${BOX.horizontal.repeat(fillLen)}${BOX.topRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${gutterPrefix}${topBorder}`);

  // --- Comment body ---
  const commentStyle = annotation.source === 'user' ? '' : ITALIC;
  const commentLines = wordWrap(annotation.comment, innerWidth);
  for (const line of commentLines) {
    const content = `${commentStyle}${line}${commentStyle ? RESET : ''}`;
    const padded = padTo(` ${content} `, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${ANN_BORDER}${BOX.vertical}${RESET}${padded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Replies ---
  if (annotation.replies && annotation.replies.length > 0) {
    // Separator
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${ANN_BORDER}${BOX.vertical}${RESET}${' '.repeat(innerWidth + 2)}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
    for (const reply of annotation.replies) {
      const replySrc = sourceLabel(reply.source);
      const replyClr = sourceColor(reply.source);
      const prefix = `${BOX.replyArrow} ${replyClr}${replySrc}${RESET}: `;
      const prefixVisLen = visibleLength(prefix);
      const replyLines = wordWrap(reply.comment, innerWidth - prefixVisLen);
      for (let i = 0; i < replyLines.length; i++) {
        const linePrefix = i === 0 ? prefix : ' '.repeat(prefixVisLen);
        const content = `${linePrefix}${replyLines[i]}`;
        const padded = padTo(` ${content} `, innerWidth + 2);
        rows.push(
          `${CLEAR_LINE}${gutterPrefix}${ANN_BORDER}${BOX.vertical}${RESET}${padded}${ANN_BORDER}${BOX.vertical}${RESET}`
        );
      }
    }
  }

  // --- Status + action hints ---
  const statusParts: string[] = [];
  const status = statusIndicator(annotation.status);
  if (status) statusParts.push(status);

  if (isCursorLine) {
    statusParts.push(
      `${DIM}[r]eply  [w] edit  [x] delete  [c] toggle${RESET}`
    );
  }

  if (statusParts.length > 0) {
    // Blank separator line
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${ANN_BORDER}${BOX.vertical}${RESET}${' '.repeat(innerWidth + 2)}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
    const actionText = statusParts.join('   ');
    const padded = padTo(` ${actionText} `, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${ANN_BORDER}${BOX.vertical}${RESET}${padded}${ANN_BORDER}${BOX.vertical}${RESET}`
    );
  }

  // --- Bottom border ---
  const bottomBorder = `${ANN_BORDER}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${gutterPrefix}${bottomBorder}`);

  return rows;
};

/**
 * Get annotations on a specific line, sorted by creation order (array index).
 */
export const annotationsOnLine = (
  annotations: readonly Annotation[],
  lineNumber: number
): Annotation[] =>
  annotations.filter(
    (a) => lineNumber >= a.startLine && lineNumber <= a.endLine
  );
