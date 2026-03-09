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
  FOCUS_BORDER,
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
  if (status === 'approved') return `${GREEN}${BOLD}👍 approved${RESET}`;
  if (status === 'dismissed') return `${DIM}👎 dismissed${RESET}`;
  return '';
};

// --- Public API ---

export type AnnotationBoxOptions = {
  /** Max visible width of the box (including borders). */
  maxWidth: number;
  /** Gutter prefix string (spaces matching line number gutter). */
  gutterPrefix: string;
  /** Whether this annotation is the currently focused target for r/w/x actions. */
  isFocused: boolean;
};

/**
 * Render an annotation as a bordered box — an array of ANSI-styled strings,
 * one per display row. Each string is prefixed with the gutter.
 */
export const renderAnnotationBox = (
  annotation: Annotation,
  options: AnnotationBoxOptions
): string[] => {
  const { maxWidth, gutterPrefix, isFocused } = options;
  // Inner width = maxWidth minus borders (│ + space on each side)
  const innerWidth = Math.max(20, maxWidth - 4);
  const rows: string[] = [];
  const borderColor = isFocused ? FOCUS_BORDER : ANN_BORDER;

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
  if (annotation.fileLevel) {
    headerParts.push(`${DIM}·${RESET}`, `${DIM}📄 file${RESET}`);
  }
  const headerText = headerParts.join(' ');
  const headerVisLen = visibleLength(headerText);
  const fillLen = Math.max(0, innerWidth - headerVisLen - 1);
  const topBorder = `${borderColor}${BOX.topLeft}${BOX.horizontal} ${headerText} ${borderColor}${BOX.horizontal.repeat(fillLen)}${BOX.topRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${gutterPrefix}${topBorder}`);

  // --- Comment body ---
  const commentStyle = annotation.source === 'user' ? '' : ITALIC;
  const commentLines = wordWrap(annotation.comment, innerWidth);
  for (const line of commentLines) {
    const content = `${commentStyle}${line}${commentStyle ? RESET : ''}`;
    const padded = padTo(` ${content} `, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${padded}${borderColor}${BOX.vertical}${RESET}`
    );
  }

  // --- Replies ---
  if (annotation.replies && annotation.replies.length > 0) {
    // Separator
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${' '.repeat(innerWidth + 2)}${borderColor}${BOX.vertical}${RESET}`
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
          `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${padded}${borderColor}${BOX.vertical}${RESET}`
        );
      }
    }
  }

  // --- Status + action hints ---
  // When focused: always render separator + hints (stable 2-line height).
  // When not focused: render only if there's a status to show (1 line).
  const status = statusIndicator(annotation.status);

  if (isFocused) {
    // Separator
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${' '.repeat(innerWidth + 2)}${borderColor}${BOX.vertical}${RESET}`
    );
    // Inline status + action hints on one line
    const statusPrefix = status ? `${status}   ` : '';
    const actionText = `${statusPrefix}${DIM}[s]tatus  [r]eply  [w] edit  [x] delete  [c] toggle${RESET}`;
    const padded = padTo(` ${actionText} `, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${padded}${borderColor}${BOX.vertical}${RESET}`
    );
  } else if (status) {
    // Not focused but has status — show it standalone
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${' '.repeat(innerWidth + 2)}${borderColor}${BOX.vertical}${RESET}`
    );
    const padded = padTo(` ${status} `, innerWidth + 2);
    rows.push(
      `${CLEAR_LINE}${gutterPrefix}${borderColor}${BOX.vertical}${RESET}${padded}${borderColor}${BOX.vertical}${RESET}`
    );
  }

  // --- Bottom border ---
  const bottomBorder = `${borderColor}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${RESET}`;
  rows.push(`${CLEAR_LINE}${gutterPrefix}${bottomBorder}`);

  return rows;
};

/**
 * Compute the rendered height (number of terminal rows) of an annotation box
 * without actually building the ANSI strings. Mirrors the structure of
 * `renderAnnotationBox` — keep in sync.
 */
export const annotationBoxHeight = (
  annotation: Annotation,
  options: { maxWidth: number; isFocused: boolean }
): number => {
  const innerWidth = Math.max(20, options.maxWidth - 4);
  let rows = 1; // top border

  // Comment body
  rows += wordWrap(annotation.comment, innerWidth).length;

  // Replies
  if (annotation.replies && annotation.replies.length > 0) {
    rows += 1; // separator
    for (const reply of annotation.replies) {
      const prefix = `↳ ${reply.source === 'user' ? 'you' : reply.source}: `;
      const replyLines = wordWrap(reply.comment, innerWidth - prefix.length);
      rows += replyLines.length;
    }
  }

  // Status + action hints
  const hasStatus = annotation.status === 'approved' || annotation.status === 'dismissed';
  if (hasStatus || options.isFocused) {
    rows += 1; // separator
    rows += 1; // action/status line
  }

  rows += 1; // bottom border
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
