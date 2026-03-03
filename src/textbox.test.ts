import { describe, it, expect } from 'vitest';
import { renderTextbox, textboxHeight } from './textbox.js';
import { createBuffer, insertNewline, insertChar } from './text-buffer.js';
import { stripAnsi } from './ansi.js';

describe('renderTextbox', () => {
  const cols = 80;

  it('renders empty buffer with cursor', () => {
    const buf = createBuffer();
    const rows = renderTextbox(buf, { label: 'Comment', cols });
    const plain = rows.map(stripAnsi);

    // Top border with label
    expect(plain[0]).toContain('┌');
    expect(plain[0]).toContain('Comment');

    // First text row should show cursor (reverse video space in raw, visible as space)
    // The raw ANSI will contain \x1b[7m \x1b[27m for the cursor
    expect(rows[1]).toContain('\x1b[7m');

    // Bottom border
    expect(plain[plain.length - 1]).toContain('└');

    // Hints
    expect(plain[plain.length - 2]).toContain('submit');
    expect(plain[plain.length - 2]).toContain('new line');
  });

  it('renders text with cursor at position', () => {
    const buf = createBuffer('hello');
    const rows = renderTextbox(buf, { label: 'Comment', cols });
    const plain = rows.map(stripAnsi);

    // Text row should contain 'hello' and cursor
    expect(plain[1]).toContain('hello');
    // Cursor is at end — reverse video space after 'hello'
    expect(rows[1]).toContain('hello\x1b[7m \x1b[27m');
  });

  it('renders multi-line text', () => {
    let buf = createBuffer('line one');
    buf = insertNewline(buf);
    buf = insertChar(buf, 'l');
    buf = insertChar(buf, 'i');
    buf = insertChar(buf, 'n');
    buf = insertChar(buf, 'e');
    buf = insertChar(buf, ' ');
    buf = insertChar(buf, 't');
    buf = insertChar(buf, 'w');
    buf = insertChar(buf, 'o');

    const rows = renderTextbox(buf, { label: 'Comment', cols });
    const plain = rows.map(stripAnsi);
    expect(plain[1]).toContain('line one');
    expect(plain[2]).toContain('line two');
  });

  it('renders context line when provided', () => {
    const buf = createBuffer();
    const rows = renderTextbox(buf, {
      label: 'Comment',
      cols,
      context: 'Intent: instruct · Category: bug',
    });
    const plain = rows.map(stripAnsi);
    expect(plain[1]).toContain('Intent: instruct');
  });

  it('shows scroll indicator when lines exceed visible rows', () => {
    let buf = createBuffer('');
    for (let i = 0; i < 10; i++) {
      buf = insertNewline(buf);
    }
    const rows = renderTextbox(buf, {
      label: 'Comment',
      cols,
      visibleRows: 4,
    });
    const plain = rows.map(stripAnsi);
    // Should contain percentage and line count
    const scrollRow = plain.find((r) => r.includes('lines'));
    expect(scrollRow).toBeDefined();
  });

  it('uses custom hints when provided', () => {
    const buf = createBuffer();
    const rows = renderTextbox(buf, {
      label: 'Reply',
      cols,
      hints: 'Enter submit · Esc cancel',
    });
    const plain = rows.map(stripAnsi);
    const hintRow = plain.find((r) => r.includes('submit'));
    expect(hintRow).toContain('Enter submit');
  });
});

describe('textboxHeight', () => {
  it('computes height for basic textbox', () => {
    const buf = createBuffer();
    expect(textboxHeight(buf, {})).toBe(9); // border + 6 rows + hints + border
  });

  it('includes context line', () => {
    const buf = createBuffer();
    expect(textboxHeight(buf, { context: true })).toBe(10);
  });

  it('includes scroll indicator for long text', () => {
    let buf = createBuffer('');
    for (let i = 0; i < 10; i++) {
      buf = insertNewline(buf);
    }
    expect(textboxHeight(buf, { visibleRows: 4 })).toBe(8); // border + 4 rows + scroll + hints + border
  });
});
