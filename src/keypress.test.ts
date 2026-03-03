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
    'escape',
    'return',
    'backspace',
    'upArrow',
    'downArrow',
    'pageUp',
    'pageDown',
    'home',
    'end',
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
