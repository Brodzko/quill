/**
 * Shared ANSI escape sequences and string helpers.
 *
 * Pure utilities — no side effects, no state.
 */

// --- Escape sequences ---

export const ESC = '\x1b[';
export const RESET = `${ESC}0m`;
export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;
export const GREEN = `${ESC}32m`;
export const YELLOW = `${ESC}33m`;
export const CYAN = `${ESC}36m`;
export const RED = `${ESC}31m`;
export const CLEAR_LINE = `${ESC}2K`;

/** Subtle highlight background — slightly lighter than one-dark-pro's #282C34. */
export const CURSOR_BG = `${ESC}48;2;44;49;58m`;

/** Selection range background — muted blue tint. */
export const SELECT_BG = `${ESC}48;2;38;50;70m`;

// --- Formatting helpers ---

export const bold = (s: string): string => `${BOLD}${s}${RESET}`;
export const dim = (s: string): string => `${DIM}${s}${RESET}`;
export const colorBold = (color: string, s: string): string =>
  `${color}${BOLD}${s}${RESET}`;

// --- ANSI-aware string helpers ---

/** Strip ANSI escape sequences to compute visible character width. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');
export const visibleLength = (s: string): number => stripAnsi(s).length;

/**
 * Wrap a string with a background color that extends to the full terminal width.
 *
 * Embedded RESET sequences (`\x1b[0m`) kill all attributes including background,
 * so we re-inject the background after every reset to keep it continuous.
 */
export const bgLine = (s: string, bg: string, cols: number): string => {
  const visible = visibleLength(s);
  const padding = Math.max(0, cols - visible);
  const patched = s.replaceAll(RESET, `${RESET}${bg}`);
  return `${bg}${patched}${' '.repeat(padding)}${RESET}`;
};
