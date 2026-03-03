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

/** Search match line background — very subtle tint so the line is distinguishable. */
export const SEARCH_LINE_BG = `${ESC}48;2;36;40;48m`;
/** Current/focused search match line background — slightly warmer. */
export const SEARCH_CURRENT_LINE_BG = `${ESC}48;2;42;45;52m`;
/** Inline search match highlight — warm tint visible over dark themes without killing readability. */
export const SEARCH_MATCH_BG = `${ESC}48;2;65;55;25m`;
/** Inline current search match highlight — reverse video (fg↔bg swap). */
export const SEARCH_CURRENT_MATCH_BG = `${ESC}7m`;

export const ITALIC = `${ESC}3m`;
export const MAGENTA = `${ESC}35m`;
export const WHITE = `${ESC}37m`;

/** Reverse video (for cursor display). */
export const REVERSE = `${ESC}7m`;
export const REVERSE_OFF = `${ESC}27m`;

/** Muted annotation box border background. */
export const ANN_BOX_BG = `${ESC}48;2;35;38;46m`;
/** Annotation box border color — subtle gray. */
export const ANN_BORDER = `${ESC}38;2;88;95;108m`;
/** Agent source accent. */
export const AGENT_ACCENT = `${ESC}38;2;130;140;160m`;
/** User source accent. */
export const USER_ACCENT = CYAN;

// --- Formatting helpers ---

export const bold = (s: string): string => `${BOLD}${s}${RESET}`;
export const dim = (s: string): string => `${DIM}${s}${RESET}`;
export const italic = (s: string): string => `${ITALIC}${s}${RESET}`;
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
/**
 * Build a mapping from visible character index to raw string index.
 * Returns an array where `map[visibleIdx]` is the raw string index of that
 * visible character. Length = number of visible characters.
 */
const buildVisibleToRawMap = (s: string): number[] => {
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    // Check for ANSI escape sequence at this position
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      // Skip past the escape sequence
      let j = i + 2;
      while (j < s.length && s[j] !== 'm') j++;
      i = j + 1; // skip past the 'm'
      continue;
    }
    map.push(i);
    i++;
  }
  return map;
};

/**
 * Highlight all occurrences of `pattern` within an ANSI-styled string.
 * Injects `matchBg` around each matched substring, preserving existing
 * syntax highlighting by saving/restoring surrounding escape state.
 *
 * Case-insensitive substring matching on visible text.
 */
export const highlightSearchMatches = (
  s: string,
  pattern: string,
  matchBg: string
): string => {
  if (pattern.length === 0) return s;

  const visMap = buildVisibleToRawMap(s);
  const visible = stripAnsi(s);
  const lowerVisible = visible.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  // Find all match ranges in visible text (non-overlapping, left to right)
  const matches: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom <= lowerVisible.length - lowerPattern.length) {
    const idx = lowerVisible.indexOf(lowerPattern, searchFrom);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + lowerPattern.length });
    searchFrom = idx + lowerPattern.length;
  }

  if (matches.length === 0) return s;

  // Build result by copying raw string segments and injecting highlights.
  // We process matches in reverse order so earlier indices stay valid.
  let result = s;
  for (let m = matches.length - 1; m >= 0; m--) {
    const match = matches[m]!;
    const rawStart = visMap[match.start]!;
    // rawEnd: position *after* the last matched visible char
    const rawEnd =
      match.end < visMap.length
        ? visMap[match.end]!
        : result.length;

    const before = result.slice(0, rawStart);
    const matched = result.slice(rawStart, rawEnd);
    const after = result.slice(rawEnd);

    // Patch the matched segment: inject matchBg after any RESETs inside it
    const patchedMatch = matched.replaceAll(RESET, `${RESET}${matchBg}`);
    result = `${before}${matchBg}${patchedMatch}${RESET}${after}`;
  }

  return result;
};

export const bgLine = (s: string, bg: string, cols: number): string => {
  const visible = visibleLength(s);
  const padding = Math.max(0, cols - visible);
  const patched = s.replaceAll(RESET, `${RESET}${bg}`);
  return `${bg}${patched}${' '.repeat(padding)}${RESET}`;
};
