/**
 * Minimal keypress parser for raw-mode stdin.
 *
 * Converts raw stdin data chunks into structured key events.
 * Handles printable chars, common control sequences (arrows, page keys,
 * home/end, escape, enter, backspace), and Ctrl+key combos.
 */

export type Key = {
  /** The printable character, or empty string for control/special keys. */
  char: string;
  ctrl: boolean;
  shift: boolean;
  escape: boolean;
  return: boolean;
  backspace: boolean;
  upArrow: boolean;
  downArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
};

const EMPTY_KEY: Key = {
  char: '',
  ctrl: false,
  shift: false,
  escape: false,
  return: false,
  backspace: false,
  upArrow: false,
  downArrow: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
};

export const parseKeypress = (data: Buffer | string): Key => {
  const raw = typeof data === 'string' ? data : data.toString('utf-8');

  // --- Escape sequences ---

  // Shift+Arrows: \x1b[1;2A / \x1b[1;2B (xterm-style modifier encoding)
  if (raw === '\x1b[1;2A')
    return { ...EMPTY_KEY, upArrow: true, shift: true };
  if (raw === '\x1b[1;2B')
    return { ...EMPTY_KEY, downArrow: true, shift: true };

  // Arrows
  if (raw === '\x1b[A') return { ...EMPTY_KEY, upArrow: true };
  if (raw === '\x1b[B') return { ...EMPTY_KEY, downArrow: true };

  // Page Up / Page Down
  // \x1b[5~ = PgUp, \x1b[6~ = PgDn (standard VT / xterm)
  if (raw === '\x1b[5~') return { ...EMPTY_KEY, pageUp: true };
  if (raw === '\x1b[6~') return { ...EMPTY_KEY, pageDown: true };

  // Home / End — multiple terminal encodings
  // \x1b[H / \x1b[1~ / \x1bOH = Home
  if (raw === '\x1b[H' || raw === '\x1b[1~' || raw === '\x1bOH')
    return { ...EMPTY_KEY, home: true };
  // \x1b[F / \x1b[4~ / \x1bOF = End
  if (raw === '\x1b[F' || raw === '\x1b[4~' || raw === '\x1bOF')
    return { ...EMPTY_KEY, end: true };

  // Single escape
  if (raw === '\x1b') return { ...EMPTY_KEY, escape: true };

  // --- Control characters ---

  // Ctrl+C
  if (raw === '\x03') return { ...EMPTY_KEY, char: 'c', ctrl: true };
  // Ctrl+D (0x04)
  if (raw === '\x04') return { ...EMPTY_KEY, char: 'd', ctrl: true };
  // Ctrl+G (0x07)
  if (raw === '\x07') return { ...EMPTY_KEY, char: 'g', ctrl: true };
  // Ctrl+U (0x15)
  if (raw === '\x15') return { ...EMPTY_KEY, char: 'u', ctrl: true };

  // Enter / Return
  if (raw === '\r' || raw === '\n') return { ...EMPTY_KEY, return: true };

  // Backspace (various terminal encodings)
  if (raw === '\x7f' || raw === '\x08')
    return { ...EMPTY_KEY, backspace: true };

  // Printable single character
  if (raw.length === 1 && raw >= ' ') {
    return { ...EMPTY_KEY, char: raw };
  }

  // Unknown sequence — return empty key (ignored by dispatch)
  return EMPTY_KEY;
};
