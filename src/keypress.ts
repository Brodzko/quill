/**
 * Minimal keypress parser for raw-mode stdin.
 *
 * Converts raw stdin data chunks into structured key events.
 * Handles printable chars, common control sequences (arrows, escape, enter,
 * backspace), and Ctrl+C.
 */

export type Key = {
  /** The printable character, or empty string for control/special keys. */
  char: string;
  ctrl: boolean;
  escape: boolean;
  return: boolean;
  backspace: boolean;
  upArrow: boolean;
  downArrow: boolean;
};

const EMPTY_KEY: Key = {
  char: '',
  ctrl: false,
  escape: false,
  return: false,
  backspace: false,
  upArrow: false,
  downArrow: false,
};

export const parseKeypress = (data: Buffer | string): Key => {
  const raw = typeof data === 'string' ? data : data.toString('utf-8');

  // Escape sequences (arrows, etc.)
  if (raw === '\x1b[A') return { ...EMPTY_KEY, upArrow: true };
  if (raw === '\x1b[B') return { ...EMPTY_KEY, downArrow: true };

  // Single escape
  if (raw === '\x1b') return { ...EMPTY_KEY, escape: true };

  // Ctrl+C
  if (raw === '\x03') return { ...EMPTY_KEY, char: 'c', ctrl: true };

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
