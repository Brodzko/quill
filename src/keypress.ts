/**
 * Minimal keypress parser for raw-mode stdin.
 *
 * Converts raw stdin data chunks into structured key events.
 * Handles printable chars, common control sequences (arrows, page keys,
 * home/end, escape, enter, backspace), modifier combos (Ctrl, Shift, Alt/Option),
 * and macOS-style word/line navigation sequences.
 */

export type Key = {
  /** The printable character, or empty string for control/special keys. */
  char: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  escape: boolean;
  return: boolean;
  backspace: boolean;
  tab: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
};

const EMPTY_KEY: Key = {
  char: '',
  ctrl: false,
  shift: false,
  alt: false,
  escape: false,
  return: false,
  backspace: false,
  tab: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
};

export const parseKeypress = (data: Buffer | string): Key => {
  const raw = typeof data === 'string' ? data : data.toString('utf-8');

  // --- CSI u protocol (kitty keyboard) ---

  // Shift+Enter: \x1b[13;2u
  if (raw === '\x1b[13;2u')
    return { ...EMPTY_KEY, return: true, shift: true };

  // --- xterm modifier-encoded sequences: \x1b[1;<mod><letter> ---

  // Shift+Arrows
  if (raw === '\x1b[1;2A')
    return { ...EMPTY_KEY, upArrow: true, shift: true };
  if (raw === '\x1b[1;2B')
    return { ...EMPTY_KEY, downArrow: true, shift: true };
  if (raw === '\x1b[1;2C')
    return { ...EMPTY_KEY, rightArrow: true, shift: true };
  if (raw === '\x1b[1;2D')
    return { ...EMPTY_KEY, leftArrow: true, shift: true };

  // Alt/Option+Arrows (modifier 3)
  if (raw === '\x1b[1;3A')
    return { ...EMPTY_KEY, upArrow: true, alt: true };
  if (raw === '\x1b[1;3B')
    return { ...EMPTY_KEY, downArrow: true, alt: true };
  if (raw === '\x1b[1;3C')
    return { ...EMPTY_KEY, rightArrow: true, alt: true };
  if (raw === '\x1b[1;3D')
    return { ...EMPTY_KEY, leftArrow: true, alt: true };

  // Ctrl+Arrows (modifier 5)
  if (raw === '\x1b[1;5C')
    return { ...EMPTY_KEY, rightArrow: true, ctrl: true };
  if (raw === '\x1b[1;5D')
    return { ...EMPTY_KEY, leftArrow: true, ctrl: true };

  // --- Plain arrows ---

  if (raw === '\x1b[A') return { ...EMPTY_KEY, upArrow: true };
  if (raw === '\x1b[B') return { ...EMPTY_KEY, downArrow: true };
  if (raw === '\x1b[C') return { ...EMPTY_KEY, rightArrow: true };
  if (raw === '\x1b[D') return { ...EMPTY_KEY, leftArrow: true };

  // --- Page Up / Page Down ---

  if (raw === '\x1b[5~') return { ...EMPTY_KEY, pageUp: true };
  if (raw === '\x1b[6~') return { ...EMPTY_KEY, pageDown: true };

  // --- Home / End (multiple terminal encodings) ---

  if (raw === '\x1b[H' || raw === '\x1b[1~' || raw === '\x1bOH')
    return { ...EMPTY_KEY, home: true };
  if (raw === '\x1b[F' || raw === '\x1b[4~' || raw === '\x1bOF')
    return { ...EMPTY_KEY, end: true };

  // --- Alt/Option+key sequences (ESC prefix) ---

  // Option+Left / Option+Right (readline-style: ESC b / ESC f)
  if (raw === '\x1bb')
    return { ...EMPTY_KEY, leftArrow: true, alt: true };
  if (raw === '\x1bf')
    return { ...EMPTY_KEY, rightArrow: true, alt: true };

  // Option+Backspace (ESC + DEL)
  if (raw === '\x1b\x7f')
    return { ...EMPTY_KEY, backspace: true, alt: true };

  // Option+Enter / Alt+Enter (ESC + CR/LF — fallback for Shift+Enter)
  if (raw === '\x1b\r' || raw === '\x1b\n')
    return { ...EMPTY_KEY, return: true, alt: true };

  // Single escape
  if (raw === '\x1b') return { ...EMPTY_KEY, escape: true };

  // --- Control characters ---

  // Ctrl+A (0x01) — line start (Cmd+Left equivalent in terminals)
  if (raw === '\x01') return { ...EMPTY_KEY, char: 'a', ctrl: true };
  // Ctrl+C (0x03)
  if (raw === '\x03') return { ...EMPTY_KEY, char: 'c', ctrl: true };
  // Ctrl+D (0x04)
  if (raw === '\x04') return { ...EMPTY_KEY, char: 'd', ctrl: true };
  // Ctrl+E (0x05) — line end (Cmd+Right equivalent in terminals)
  if (raw === '\x05') return { ...EMPTY_KEY, char: 'e', ctrl: true };
  // Ctrl+G (0x07)
  if (raw === '\x07') return { ...EMPTY_KEY, char: 'g', ctrl: true };
  // Ctrl+U (0x15)
  if (raw === '\x15') return { ...EMPTY_KEY, char: 'u', ctrl: true };

  // Shift+Tab (reverse tab / backtab)
  if (raw === '\x1b[Z') return { ...EMPTY_KEY, tab: true, shift: true };

  // Tab
  if (raw === '\t') return { ...EMPTY_KEY, tab: true, char: '\t' };

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
