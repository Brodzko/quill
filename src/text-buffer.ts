/**
 * Pure multi-line text buffer with cursor tracking.
 *
 * All operations return new TextBuffer instances — no mutation.
 * Designed for comment/reply textbox inputs.
 */

// --- Types ---

export type CursorPos = {
  readonly row: number; // 0-indexed line
  readonly col: number; // 0-indexed column within line
};

export type TextBuffer = {
  readonly lines: readonly string[];
  readonly cursor: CursorPos;
};

// --- Internal helpers ---

/** Safe line access — returns '' for out-of-range. */
const lineAt = (buf: TextBuffer, row: number): string => buf.lines[row] ?? '';

const isWordChar = (c: string): boolean => /\w/.test(c);

// --- Factory ---

/** Create a buffer. Cursor defaults to end of text. */
export const createBuffer = (text = ''): TextBuffer => {
  const lines = text.split('\n');
  const lastRow = lines.length - 1;
  return {
    lines,
    cursor: { row: lastRow, col: lineAt({ lines, cursor: { row: 0, col: 0 } }, lastRow).length },
  };
};

// --- Queries ---

export const getText = (buf: TextBuffer): string => buf.lines.join('\n');

export const isEmpty = (buf: TextBuffer): boolean =>
  buf.lines.length === 1 && lineAt(buf, 0).length === 0;

// --- Insertion ---

export const insertChar = (buf: TextBuffer, char: string): TextBuffer => {
  const { lines, cursor } = buf;
  const line = lineAt(buf, cursor.row);
  const newLine = line.slice(0, cursor.col) + char + line.slice(cursor.col);
  const next = [...lines];
  next[cursor.row] = newLine;
  return { lines: next, cursor: { row: cursor.row, col: cursor.col + char.length } };
};

export const insertNewline = (buf: TextBuffer): TextBuffer => {
  const { lines, cursor } = buf;
  const line = lineAt(buf, cursor.row);
  const before = line.slice(0, cursor.col);
  const after = line.slice(cursor.col);
  const next = [...lines];
  next.splice(cursor.row, 1, before, after);
  return { lines: next, cursor: { row: cursor.row + 1, col: 0 } };
};

// --- Deletion ---

export const deleteBack = (buf: TextBuffer): TextBuffer => {
  const { lines, cursor } = buf;
  if (cursor.col > 0) {
    const line = lineAt(buf, cursor.row);
    const next = [...lines];
    next[cursor.row] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
    return { lines: next, cursor: { row: cursor.row, col: cursor.col - 1 } };
  }
  if (cursor.row > 0) {
    const prevLine = lineAt(buf, cursor.row - 1);
    const curLine = lineAt(buf, cursor.row);
    const prevLen = prevLine.length;
    const next = [...lines];
    next.splice(cursor.row - 1, 2, prevLine + curLine);
    return { lines: next, cursor: { row: cursor.row - 1, col: prevLen } };
  }
  return buf;
};

export const deleteWordBack = (buf: TextBuffer): TextBuffer => {
  const target = moveWordLeft(buf);
  // Same row — delete range
  if (target.cursor.row === buf.cursor.row) {
    const line = lineAt(buf, buf.cursor.row);
    const next = [...buf.lines];
    next[buf.cursor.row] = line.slice(0, target.cursor.col) + line.slice(buf.cursor.col);
    return { lines: next, cursor: target.cursor };
  }
  // Cross-line (at start of line → join with prev)
  return deleteBack(buf);
};

export const deleteToLineStart = (buf: TextBuffer): TextBuffer => {
  const { lines, cursor } = buf;
  if (cursor.col === 0) return buf;
  const line = lineAt(buf, cursor.row);
  const next = [...lines];
  next[cursor.row] = line.slice(cursor.col);
  return { lines: next, cursor: { row: cursor.row, col: 0 } };
};

// --- Cursor movement ---

export const moveLeft = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  if (cursor.col > 0) {
    return { ...buf, cursor: { row: cursor.row, col: cursor.col - 1 } };
  }
  if (cursor.row > 0) {
    return { ...buf, cursor: { row: cursor.row - 1, col: lineAt(buf, cursor.row - 1).length } };
  }
  return buf;
};

export const moveRight = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  const lineLen = lineAt(buf, cursor.row).length;
  if (cursor.col < lineLen) {
    return { ...buf, cursor: { row: cursor.row, col: cursor.col + 1 } };
  }
  if (cursor.row < buf.lines.length - 1) {
    return { ...buf, cursor: { row: cursor.row + 1, col: 0 } };
  }
  return buf;
};

export const moveUp = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  if (cursor.row <= 0) return buf;
  const col = Math.min(cursor.col, lineAt(buf, cursor.row - 1).length);
  return { ...buf, cursor: { row: cursor.row - 1, col } };
};

export const moveDown = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  if (cursor.row >= buf.lines.length - 1) return buf;
  const col = Math.min(cursor.col, lineAt(buf, cursor.row + 1).length);
  return { ...buf, cursor: { row: cursor.row + 1, col } };
};

export const moveWordLeft = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  let { row, col } = cursor;

  // At start of line → jump to end of previous line
  if (col === 0 && row > 0) {
    row--;
    col = lineAt(buf, row).length;
    return { ...buf, cursor: { row, col } };
  }

  const line = lineAt(buf, row);
  // Skip non-word backward
  while (col > 0 && !isWordChar(line.charAt(col - 1))) col--;
  // Skip word backward
  while (col > 0 && isWordChar(line.charAt(col - 1))) col--;

  return { ...buf, cursor: { row, col } };
};

export const moveWordRight = (buf: TextBuffer): TextBuffer => {
  const { cursor } = buf;
  let { row, col } = cursor;
  const lineLen = lineAt(buf, row).length;

  // At end of line → jump to start of next line
  if (col >= lineLen && row < buf.lines.length - 1) {
    return { ...buf, cursor: { row: row + 1, col: 0 } };
  }

  const line = lineAt(buf, row);
  // Skip word forward
  while (col < line.length && isWordChar(line.charAt(col))) col++;
  // Skip non-word forward
  while (col < line.length && !isWordChar(line.charAt(col))) col++;

  return { ...buf, cursor: { row, col } };
};

export const moveLineStart = (buf: TextBuffer): TextBuffer => ({
  ...buf,
  cursor: { row: buf.cursor.row, col: 0 },
});

export const moveLineEnd = (buf: TextBuffer): TextBuffer => ({
  ...buf,
  cursor: { row: buf.cursor.row, col: lineAt(buf, buf.cursor.row).length },
});

// --- Scroll helper (pure, stateless) ---

/**
 * Compute the scroll offset to keep the cursor visible within `visibleRows`.
 * Deterministic from cursor position — no stored offset needed.
 */
export const scrollForCursor = (
  cursorRow: number,
  visibleRows: number,
  totalRows: number
): number => {
  const maxOffset = Math.max(0, totalRows - visibleRows);
  const raw = Math.max(0, cursorRow - visibleRows + 1);
  return Math.min(raw, maxOffset);
};
