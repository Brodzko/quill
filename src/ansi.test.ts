import { describe, expect, it } from 'vitest';
import {
  BOLD,
  RESET,
  bgLine,
  bold,
  colorBold,
  dim,
  highlightSearchMatches,
  stripAnsi,
  visibleLength,
} from './ansi.js';

describe('stripAnsi', () => {
  it('strips color codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('strips truecolor codes', () => {
    expect(stripAnsi('\x1b[38;2;255;0;0mred\x1b[0m')).toBe('red');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('visibleLength', () => {
  it('counts visible characters only', () => {
    expect(visibleLength('\x1b[32mhello\x1b[0m')).toBe(5);
  });

  it('handles mixed ANSI and plain text', () => {
    expect(visibleLength('pre \x1b[1mbold\x1b[0m post')).toBe(13);
  });
});

describe('bgLine', () => {
  it('pads to full terminal width', () => {
    const result = bgLine('hi', '\x1b[44m', 10);
    const visible = stripAnsi(result);
    expect(visible.length).toBe(10);
  });

  it('re-injects bg after embedded RESETs', () => {
    const input = `${BOLD}word${RESET} rest`;
    const bg = '\x1b[44m';
    const result = bgLine(input, bg, 20);
    // After RESET, bg should be re-injected
    expect(result).toContain(`${RESET}${bg}`);
  });

  it('handles string wider than cols (no negative padding)', () => {
    const result = bgLine('very long string here', '\x1b[44m', 5);
    // Should not throw, padding should be 0
    expect(result).toContain('very long string here');
  });
});

describe('highlightSearchMatches', () => {
  const BG = '\x1b[48;2;80;65;15m';

  it('highlights a plain-text match', () => {
    const result = highlightSearchMatches('hello world', 'world', BG);
    expect(result).toContain(`${BG}world${RESET}`);
    // 'hello ' should be untouched
    expect(result).toMatch(/^hello /);
  });

  it('is case-insensitive', () => {
    const result = highlightSearchMatches('Hello World', 'hello', BG);
    expect(result).toContain(`${BG}Hello${RESET}`);
  });

  it('highlights multiple occurrences', () => {
    const result = highlightSearchMatches('foo bar foo', 'foo', BG);
    // Two injections of BG
    const count = result.split(BG).length - 1;
    expect(count).toBe(2);
  });

  it('handles ANSI-escaped input preserving syntax colors', () => {
    const input = `\x1b[32mconst\x1b[0m foo = 1`;
    const result = highlightSearchMatches(input, 'foo', BG);
    // Match should be highlighted
    expect(result).toContain(BG);
    // Visible text should be unchanged
    expect(stripAnsi(result)).toBe('const foo = 1');
  });

  it('re-injects match bg after embedded RESETs within match span', () => {
    // Pattern spans across a RESET boundary: "st f" in "con[st] [f]oo"
    const input = `con\x1b[1mst\x1b[0m foo`;
    const result = highlightSearchMatches(input, 'st f', BG);
    expect(result).toContain(`${RESET}${BG}`);
  });

  it('returns input unchanged for empty pattern', () => {
    const input = 'hello';
    expect(highlightSearchMatches(input, '', BG)).toBe(input);
  });

  it('returns input unchanged when pattern is not found', () => {
    const input = 'hello world';
    expect(highlightSearchMatches(input, 'xyz', BG)).toBe(input);
  });

  it('handles match at start of string', () => {
    const result = highlightSearchMatches('foo bar', 'foo', BG);
    expect(result.startsWith(BG)).toBe(true);
  });

  it('handles match at end of string', () => {
    const result = highlightSearchMatches('bar foo', 'foo', BG);
    expect(result).toContain(`${BG}foo${RESET}`);
  });
});

describe('formatting helpers', () => {
  it('bold wraps in BOLD + RESET', () => {
    expect(bold('x')).toBe(`${BOLD}x${RESET}`);
  });

  it('dim wraps in DIM + RESET', () => {
    const result = dim('x');
    expect(result).toContain('x');
    expect(result).toContain(RESET);
  });

  it('colorBold wraps in color + BOLD + RESET', () => {
    const result = colorBold('\x1b[32m', 'ok');
    expect(result).toContain('\x1b[32m');
    expect(result).toContain(BOLD);
    expect(result).toContain(RESET);
  });
});
