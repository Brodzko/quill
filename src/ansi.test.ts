import { describe, expect, it } from 'vitest';
import {
  BOLD,
  RESET,
  bgLine,
  bold,
  colorBold,
  dim,
  highlightSearchMatches,
  sliceAnsi,
  stripAnsi,
  truncateAnsi,
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

describe('truncateAnsi', () => {
  it('returns string unchanged when shorter than limit', () => {
    expect(truncateAnsi('hello', 10)).toBe('hello');
  });

  it('returns string unchanged when exactly at limit', () => {
    expect(truncateAnsi('hello', 5)).toBe('hello');
  });

  it('truncates plain text at limit', () => {
    expect(truncateAnsi('hello world', 5)).toBe(`hello${RESET}`);
  });

  it('preserves ANSI sequences before cutoff', () => {
    const styled = `\x1b[32mhello\x1b[0m world`;
    const result = truncateAnsi(styled, 5);
    expect(result).toContain('\x1b[32m');
    expect(stripAnsi(result)).toBe('hello');
  });

  it('truncates mid-styled text correctly', () => {
    const styled = `\x1b[32mhello world\x1b[0m`;
    const result = truncateAnsi(styled, 7);
    expect(stripAnsi(result)).toBe('hello w');
    expect(result).toContain('\x1b[32m');
    expect(result.endsWith(RESET)).toBe(true);
  });

  it('handles zero-width ANSI sequences at truncation point', () => {
    // "ab" + color change + "cd" → truncate at 2 should give "ab"
    const styled = `ab\x1b[31mcd`;
    const result = truncateAnsi(styled, 2);
    expect(stripAnsi(result)).toBe('ab');
  });
});

describe('sliceAnsi', () => {
  it('with start=0 behaves like truncateAnsi', () => {
    expect(sliceAnsi('hello world', 0, 5)).toBe(`hello${RESET}`);
  });

  it('skips start visible chars from plain text', () => {
    expect(sliceAnsi('hello world', 6, 5)).toBe('world');
  });

  it('returns empty string when start exceeds visible length', () => {
    expect(sliceAnsi('hello', 10, 5)).toBe('');
  });

  it('preserves ANSI sequences from before the slice window', () => {
    const styled = `\x1b[32mhello world\x1b[0m`;
    const result = sliceAnsi(styled, 6, 5);
    // Should contain the green escape and show 'world'
    expect(stripAnsi(result)).toBe('world');
    expect(result).toContain('\x1b[32m');
  });

  it('handles ANSI sequence at the slice boundary', () => {
    // "ab" + color change + "cd" → skip 2, take 2 → "cd" with color
    const styled = `ab\x1b[31mcd`;
    const result = sliceAnsi(styled, 2, 2);
    expect(stripAnsi(result)).toBe('cd');
    expect(result).toContain('\x1b[31m');
  });

  it('truncates at width when content exceeds it', () => {
    const result = sliceAnsi('abcdefghij', 2, 4);
    expect(stripAnsi(result)).toBe('cdef');
  });

  it('returns remainder when width exceeds remaining content', () => {
    const result = sliceAnsi('abcde', 3, 10);
    expect(result).toBe('de');
  });

  it('handles multiple ANSI sequences across skip and window', () => {
    // green "ab" + red "cd" + blue "ef"
    const styled = `\x1b[32mab\x1b[31mcd\x1b[34mef`;
    const result = sliceAnsi(styled, 2, 3);
    // Should show "cde" with red/blue coloring
    expect(stripAnsi(result)).toBe('cde');
  });
});
