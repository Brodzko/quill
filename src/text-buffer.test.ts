import { describe, it, expect } from 'vitest';
import {
  createBuffer,
  getText,
  isEmpty,
  insertChar,
  insertNewline,
  deleteBack,
  deleteWordBack,
  deleteToLineStart,
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  moveWordLeft,
  moveWordRight,
  moveLineStart,
  moveLineEnd,
  scrollForCursor,
} from './text-buffer.js';

describe('createBuffer', () => {
  it('creates empty buffer with cursor at 0,0', () => {
    const buf = createBuffer();
    expect(buf.lines).toEqual(['']);
    expect(buf.cursor).toEqual({ row: 0, col: 0 });
  });

  it('creates buffer from text with cursor at end', () => {
    const buf = createBuffer('hello');
    expect(buf.lines).toEqual(['hello']);
    expect(buf.cursor).toEqual({ row: 0, col: 5 });
  });

  it('handles multi-line text', () => {
    const buf = createBuffer('line1\nline2\nline3');
    expect(buf.lines).toEqual(['line1', 'line2', 'line3']);
    expect(buf.cursor).toEqual({ row: 2, col: 5 });
  });
});

describe('getText', () => {
  it('round-trips through createBuffer', () => {
    const text = 'hello\nworld';
    expect(getText(createBuffer(text))).toBe(text);
  });

  it('returns empty string for empty buffer', () => {
    expect(getText(createBuffer())).toBe('');
  });
});

describe('isEmpty', () => {
  it('is true for empty buffer', () => {
    expect(isEmpty(createBuffer())).toBe(true);
  });

  it('is false for non-empty buffer', () => {
    expect(isEmpty(createBuffer('a'))).toBe(false);
  });

  it('is false for buffer with only newline', () => {
    expect(isEmpty(createBuffer('\n'))).toBe(false);
  });
});

describe('insertChar', () => {
  it('inserts at cursor position', () => {
    const buf = createBuffer();
    const result = insertChar(buf, 'a');
    expect(result.lines).toEqual(['a']);
    expect(result.cursor).toEqual({ row: 0, col: 1 });
  });

  it('inserts mid-line', () => {
    const buf = { lines: ['hllo'], cursor: { row: 0, col: 1 } };
    const result = insertChar(buf, 'e');
    expect(result.lines).toEqual(['hello']);
    expect(result.cursor).toEqual({ row: 0, col: 2 });
  });
});

describe('insertNewline', () => {
  it('splits line at cursor', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 5 } };
    const result = insertNewline(buf);
    expect(result.lines).toEqual(['hello', ' world']);
    expect(result.cursor).toEqual({ row: 1, col: 0 });
  });

  it('inserts newline at end of line', () => {
    const buf = createBuffer('hello');
    const result = insertNewline(buf);
    expect(result.lines).toEqual(['hello', '']);
    expect(result.cursor).toEqual({ row: 1, col: 0 });
  });

  it('inserts newline at start of line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 0 } };
    const result = insertNewline(buf);
    expect(result.lines).toEqual(['', 'hello']);
    expect(result.cursor).toEqual({ row: 1, col: 0 });
  });
});

describe('deleteBack', () => {
  it('deletes character before cursor', () => {
    const buf = createBuffer('abc');
    const result = deleteBack(buf);
    expect(result.lines).toEqual(['ab']);
    expect(result.cursor).toEqual({ row: 0, col: 2 });
  });

  it('joins lines when at start of line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 1, col: 0 } };
    const result = deleteBack(buf);
    expect(result.lines).toEqual(['helloworld']);
    expect(result.cursor).toEqual({ row: 0, col: 5 });
  });

  it('is a no-op at start of buffer', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 0 } };
    expect(deleteBack(buf)).toBe(buf);
  });

  it('deletes mid-line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 3 } };
    const result = deleteBack(buf);
    expect(result.lines).toEqual(['helo']);
    expect(result.cursor).toEqual({ row: 0, col: 2 });
  });
});

describe('deleteWordBack', () => {
  it('deletes word before cursor', () => {
    const buf = createBuffer('hello world');
    const result = deleteWordBack(buf);
    expect(result.lines).toEqual(['hello ']);
    expect(result.cursor).toEqual({ row: 0, col: 6 });
  });

  it('deletes through whitespace to previous word', () => {
    const buf = { lines: ['hello   world'], cursor: { row: 0, col: 8 } };
    const result = deleteWordBack(buf);
    expect(result.lines).toEqual(['world']);
    expect(result.cursor).toEqual({ row: 0, col: 0 });
  });

  it('joins with previous line when at start of line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 1, col: 0 } };
    const result = deleteWordBack(buf);
    expect(result.lines).toEqual(['helloworld']);
    expect(result.cursor).toEqual({ row: 0, col: 5 });
  });
});

describe('deleteToLineStart', () => {
  it('deletes from cursor to line start', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 6 } };
    const result = deleteToLineStart(buf);
    expect(result.lines).toEqual(['world']);
    expect(result.cursor).toEqual({ row: 0, col: 0 });
  });

  it('is a no-op when cursor is at line start', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 0 } };
    expect(deleteToLineStart(buf)).toBe(buf);
  });
});

describe('moveLeft', () => {
  it('moves left within line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 3 } };
    const result = moveLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 2 });
  });

  it('wraps to end of previous line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 1, col: 0 } };
    const result = moveLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 5 });
  });

  it('is a no-op at start of buffer', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 0 } };
    expect(moveLeft(buf)).toBe(buf);
  });
});

describe('moveRight', () => {
  it('moves right within line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 2 } };
    const result = moveRight(buf);
    expect(result.cursor).toEqual({ row: 0, col: 3 });
  });

  it('wraps to start of next line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 0, col: 5 } };
    const result = moveRight(buf);
    expect(result.cursor).toEqual({ row: 1, col: 0 });
  });

  it('is a no-op at end of buffer', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 5 } };
    expect(moveRight(buf)).toBe(buf);
  });
});

describe('moveUp', () => {
  it('moves to previous line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 1, col: 3 } };
    const result = moveUp(buf);
    expect(result.cursor).toEqual({ row: 0, col: 3 });
  });

  it('clamps column to shorter line', () => {
    const buf = { lines: ['hi', 'hello'], cursor: { row: 1, col: 4 } };
    const result = moveUp(buf);
    expect(result.cursor).toEqual({ row: 0, col: 2 });
  });

  it('is a no-op on first line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 3 } };
    expect(moveUp(buf)).toBe(buf);
  });
});

describe('moveDown', () => {
  it('moves to next line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 0, col: 3 } };
    const result = moveDown(buf);
    expect(result.cursor).toEqual({ row: 1, col: 3 });
  });

  it('clamps column to shorter line', () => {
    const buf = { lines: ['hello', 'hi'], cursor: { row: 0, col: 4 } };
    const result = moveDown(buf);
    expect(result.cursor).toEqual({ row: 1, col: 2 });
  });

  it('is a no-op on last line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 3 } };
    expect(moveDown(buf)).toBe(buf);
  });
});

describe('moveWordLeft', () => {
  it('jumps to start of current word', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 9 } };
    const result = moveWordLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 6 });
  });

  it('skips whitespace to previous word', () => {
    const buf = { lines: ['hello   world'], cursor: { row: 0, col: 8 } };
    const result = moveWordLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 0 });
  });

  it('jumps to end of previous line from col 0', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 1, col: 0 } };
    const result = moveWordLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 5 });
  });

  it('handles cursor at end of word', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 5 } };
    const result = moveWordLeft(buf);
    expect(result.cursor).toEqual({ row: 0, col: 0 });
  });
});

describe('moveWordRight', () => {
  it('jumps past current word and whitespace', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 0 } };
    const result = moveWordRight(buf);
    expect(result.cursor).toEqual({ row: 0, col: 6 });
  });

  it('jumps to start of next line from end of line', () => {
    const buf = { lines: ['hello', 'world'], cursor: { row: 0, col: 5 } };
    const result = moveWordRight(buf);
    expect(result.cursor).toEqual({ row: 1, col: 0 });
  });

  it('jumps from mid-word to end of next word', () => {
    const buf = { lines: ['hello world'], cursor: { row: 0, col: 2 } };
    const result = moveWordRight(buf);
    expect(result.cursor).toEqual({ row: 0, col: 6 });
  });
});

describe('moveLineStart / moveLineEnd', () => {
  it('moveLineStart goes to column 0', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 3 } };
    expect(moveLineStart(buf).cursor).toEqual({ row: 0, col: 0 });
  });

  it('moveLineEnd goes to end of line', () => {
    const buf = { lines: ['hello'], cursor: { row: 0, col: 0 } };
    expect(moveLineEnd(buf).cursor).toEqual({ row: 0, col: 5 });
  });
});

describe('scrollForCursor', () => {
  it('returns 0 when cursor fits in view', () => {
    expect(scrollForCursor(2, 6, 10)).toBe(0);
  });

  it('scrolls to keep cursor visible', () => {
    expect(scrollForCursor(8, 6, 10)).toBe(3);
  });

  it('caps at max offset', () => {
    expect(scrollForCursor(9, 6, 10)).toBe(4);
  });

  it('returns 0 for single line', () => {
    expect(scrollForCursor(0, 6, 1)).toBe(0);
  });
});
