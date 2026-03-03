import { describe, expect, it } from 'vitest';
import {
  BOLD,
  RESET,
  bgLine,
  bold,
  colorBold,
  dim,
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
