import { describe, expect, it } from 'vitest';
import { type Key, parseKeypress } from './keypress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert only the truthy fields, everything else is falsy/empty. */
const expectKey = (
  input: string | Buffer,
  expected: Partial<Key>
): void => {
  const key = parseKeypress(input);
  for (const [k, v] of Object.entries(expected)) {
    expect(key[k as keyof Key], `key.${k}`).toBe(v);
  }
  // All other boolean fields should be false
  const boolFields: (keyof Key)[] = [
    'ctrl',
    'shift',
    'alt',
    'escape',
    'return',
    'backspace',
    'tab',
    'upArrow',
    'downArrow',
    'leftArrow',
    'rightArrow',
    'pageUp',
    'pageDown',
    'home',
    'end',
    'scrollUp',
    'scrollDown',
    'scrollLeft',
    'scrollRight',
  ];
  for (const field of boolFields) {
    if (!(field in expected)) {
      expect(key[field], `key.${field} should be false`).toBe(false);
    }
  }
};

// ---------------------------------------------------------------------------
// Printable characters
// ---------------------------------------------------------------------------

describe('printable characters', () => {
  it.each(['a', 'z', 'A', 'Z', '0', '9', ':', '/', ' ', '.', '-'])(
    'parses "%s"',
    (ch) => {
      expectKey(ch, { char: ch });
    }
  );
});

// ---------------------------------------------------------------------------
// Arrow keys
// ---------------------------------------------------------------------------

describe('arrow keys', () => {
  it('parses up arrow', () => {
    expectKey('\x1b[A', { upArrow: true });
  });

  it('parses down arrow', () => {
    expectKey('\x1b[B', { downArrow: true });
  });
});

// ---------------------------------------------------------------------------
// Shift+Arrow keys
// ---------------------------------------------------------------------------

describe('shift+arrow keys', () => {
  it('parses Shift+Up (\\x1b[1;2A)', () => {
    expectKey('\x1b[1;2A', { upArrow: true, shift: true });
  });

  it('parses Shift+Down (\\x1b[1;2B)', () => {
    expectKey('\x1b[1;2B', { downArrow: true, shift: true });
  });
});

// ---------------------------------------------------------------------------
// Page keys
// ---------------------------------------------------------------------------

describe('page keys', () => {
  it('parses PgUp (\\x1b[5~)', () => {
    expectKey('\x1b[5~', { pageUp: true });
  });

  it('parses PgDn (\\x1b[6~)', () => {
    expectKey('\x1b[6~', { pageDown: true });
  });
});

// ---------------------------------------------------------------------------
// Home / End — multiple terminal encodings
// ---------------------------------------------------------------------------

describe('home key', () => {
  it('parses \\x1b[H', () => {
    expectKey('\x1b[H', { home: true });
  });

  it('parses \\x1b[1~', () => {
    expectKey('\x1b[1~', { home: true });
  });

  it('parses \\x1bOH', () => {
    expectKey('\x1bOH', { home: true });
  });
});

describe('end key', () => {
  it('parses \\x1b[F', () => {
    expectKey('\x1b[F', { end: true });
  });

  it('parses \\x1b[4~', () => {
    expectKey('\x1b[4~', { end: true });
  });

  it('parses \\x1bOF', () => {
    expectKey('\x1bOF', { end: true });
  });
});

// ---------------------------------------------------------------------------
// Control characters
// ---------------------------------------------------------------------------

describe('control characters', () => {
  it('parses Ctrl+C (0x03)', () => {
    expectKey('\x03', { char: 'c', ctrl: true });
  });

  it('parses Ctrl+D (0x04)', () => {
    expectKey('\x04', { char: 'd', ctrl: true });
  });

  it('parses Ctrl+G (0x07)', () => {
    expectKey('\x07', { char: 'g', ctrl: true });
  });

  it('parses Ctrl+N (0x0E)', () => {
    expectKey('\x0e', { char: 'n', ctrl: true });
  });

  it('parses Ctrl+P (0x10)', () => {
    expectKey('\x10', { char: 'p', ctrl: true });
  });

  it('parses Ctrl+U (0x15)', () => {
    expectKey('\x15', { char: 'u', ctrl: true });
  });
});

// ---------------------------------------------------------------------------
// Special keys
// ---------------------------------------------------------------------------

describe('special keys', () => {
  it('parses Escape', () => {
    expectKey('\x1b', { escape: true });
  });

  it('parses Tab', () => {
    expectKey('\t', { tab: true, char: '\t' });
  });

  it('parses Shift+Tab (backtab)', () => {
    expectKey('\x1b[Z', { tab: true, shift: true });
  });

  it('parses Enter (\\r)', () => {
    expectKey('\r', { return: true });
  });

  it('parses Enter (\\n)', () => {
    expectKey('\n', { return: true });
  });

  it('parses Backspace (0x7f)', () => {
    expectKey('\x7f', { backspace: true });
  });

  it('parses Backspace (0x08)', () => {
    expectKey('\x08', { backspace: true });
  });
});

// ---------------------------------------------------------------------------
// Buffer input
// ---------------------------------------------------------------------------

describe('buffer input', () => {
  it('parses a Buffer the same as a string', () => {
    const key = parseKeypress(Buffer.from('\x1b[A'));
    expect(key.upArrow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown sequences
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Left/Right arrows
// ---------------------------------------------------------------------------

describe('left/right arrows', () => {
  it('parses left arrow', () => {
    expectKey('\x1b[D', { leftArrow: true });
  });

  it('parses right arrow', () => {
    expectKey('\x1b[C', { rightArrow: true });
  });

  it('parses Shift+Left', () => {
    expectKey('\x1b[1;2D', { leftArrow: true, shift: true });
  });

  it('parses Shift+Right', () => {
    expectKey('\x1b[1;2C', { rightArrow: true, shift: true });
  });
});

// ---------------------------------------------------------------------------
// Alt/Option key combos (macOS navigation)
// ---------------------------------------------------------------------------

describe('alt/option key combos', () => {
  it('parses Alt+Left (xterm: \\x1b[1;3D)', () => {
    expectKey('\x1b[1;3D', { leftArrow: true, alt: true });
  });

  it('parses Alt+Right (xterm: \\x1b[1;3C)', () => {
    expectKey('\x1b[1;3C', { rightArrow: true, alt: true });
  });

  it('parses Alt+Left (readline: ESC b)', () => {
    expectKey('\x1bb', { leftArrow: true, alt: true });
  });

  it('parses Alt+Right (readline: ESC f)', () => {
    expectKey('\x1bf', { rightArrow: true, alt: true });
  });

  it('parses Alt+Backspace (ESC DEL)', () => {
    expectKey('\x1b\x7f', { backspace: true, alt: true });
  });

  it('parses Alt+Enter (ESC CR)', () => {
    expectKey('\x1b\r', { return: true, alt: true });
  });

  it('parses Ctrl+Left (\\x1b[1;5D)', () => {
    expectKey('\x1b[1;5D', { leftArrow: true, ctrl: true });
  });

  it('parses Ctrl+Right (\\x1b[1;5C)', () => {
    expectKey('\x1b[1;5C', { rightArrow: true, ctrl: true });
  });
});

// ---------------------------------------------------------------------------
// Ctrl+A / Ctrl+E (line start/end)
// ---------------------------------------------------------------------------

describe('ctrl+a / ctrl+e', () => {
  it('parses Ctrl+A (0x01)', () => {
    expectKey('\x01', { char: 'a', ctrl: true });
  });

  it('parses Ctrl+E (0x05)', () => {
    expectKey('\x05', { char: 'e', ctrl: true });
  });
});

// ---------------------------------------------------------------------------
// Shift+Enter (CSI u protocol)
// ---------------------------------------------------------------------------

describe('shift+enter', () => {
  it('parses Shift+Enter (CSI u: \\x1b[13;2u)', () => {
    expectKey('\x1b[13;2u', { return: true, shift: true });
  });
});

// ---------------------------------------------------------------------------
// Mouse wheel
// ---------------------------------------------------------------------------

describe('mouse wheel', () => {
  it('parses SGR wheel up (\x1b[<64;1;1M)', () => {
    expectKey('\x1b[<64;1;1M', { scrollUp: true });
  });

  it('parses SGR wheel down (\x1b[<65;10;20M)', () => {
    expectKey('\x1b[<65;10;20M', { scrollDown: true });
  });

  it('ignores SGR non-wheel non-click mouse events', () => {
    const key = parseKeypress('\x1b[<2;10;20M');
    expect(key.scrollUp).toBe(false);
    expect(key.scrollDown).toBe(false);
    expect(key.mouseRow).toBe(0);
  });

  it('parses SGR left click press', () => {
    expectKey('\x1b[<0;15;8M', { mouseRow: 8, mouseCol: 15 });
  });

  it('ignores SGR left click release (lowercase m)', () => {
    const key = parseKeypress('\x1b[<0;15;8m');
    expect(key.mouseRow).toBe(0);
  });

  it('parses legacy X10 wheel up', () => {
    // Button 64+32=96=0x60, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(96, 33, 33)}`;
    expectKey(raw, { scrollUp: true });
  });

  it('parses legacy X10 wheel down', () => {
    // Button 65+32=97=0x61, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(97, 33, 33)}`;
    expectKey(raw, { scrollDown: true });
  });

  it('parses SGR native horizontal scroll left (button 66)', () => {
    expectKey('\x1b[<66;1;1M', { scrollLeft: true });
  });

  it('parses SGR native horizontal scroll right (button 67)', () => {
    expectKey('\x1b[<67;1;1M', { scrollRight: true });
  });

  it('parses SGR Shift+wheel up as scrollLeft (button 68)', () => {
    expectKey('\x1b[<68;1;1M', { scrollLeft: true });
  });

  it('parses SGR Shift+wheel down as scrollRight (button 69)', () => {
    expectKey('\x1b[<69;1;1M', { scrollRight: true });
  });

  it('parses legacy X10 native horizontal scroll left (button 66)', () => {
    // Button 66+32=98, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(98, 33, 33)}`;
    expectKey(raw, { scrollLeft: true });
  });

  it('parses legacy X10 native horizontal scroll right (button 67)', () => {
    // Button 67+32=99, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(99, 33, 33)}`;
    expectKey(raw, { scrollRight: true });
  });

  it('parses legacy X10 Shift+wheel up as scrollLeft (button 68)', () => {
    // Button 68+32=100, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(100, 33, 33)}`;
    expectKey(raw, { scrollLeft: true });
  });

  it('parses legacy X10 Shift+wheel down as scrollRight (button 69)', () => {
    // Button 69+32=101, col=1+32=33, row=1+32=33
    const raw = `\x1b[M${String.fromCharCode(101, 33, 33)}`;
    expectKey(raw, { scrollRight: true });
  });
});

// ---------------------------------------------------------------------------
// Unknown sequences
// ---------------------------------------------------------------------------

describe('unknown sequences', () => {
  it('returns empty key for unknown escape sequence', () => {
    const key = parseKeypress('\x1b[99~');
    expect(key.char).toBe('');
    expect(key.ctrl).toBe(false);
  });

  it('returns empty key for multi-byte non-escape string', () => {
    const key = parseKeypress('ab');
    expect(key.char).toBe('');
  });
});
