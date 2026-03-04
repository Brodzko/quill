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
/** Focused annotation marker/border accent. */
export const FOCUS_MARKER = `${ESC}38;2;97;175;239m`; // vivid blue
/** Focused annotation border color. */
export const FOCUS_BORDER = `${ESC}38;2;97;175;239m`; // same vivid blue

// --- Diff mode colors ---

/** Diff: removed line background (subtle red tint). */
export const DIFF_REMOVED_BG = `${ESC}48;2;50;30;30m`;
/** Diff: added line background (subtle green tint). */
export const DIFF_ADDED_BG = `${ESC}48;2;30;50;30m`;
/** Diff: modified line old-side background (muted red). */
export const DIFF_MODIFIED_OLD_BG = `${ESC}48;2;55;33;33m`;
/** Diff: modified line new-side background (muted green). */
export const DIFF_MODIFIED_NEW_BG = `${ESC}48;2;33;55;33m`;
/** Diff: hunk header background (muted blue). */
export const DIFF_HUNK_BG = `${ESC}48;2;35;40;50m`;
/** Diff: padding (empty) cell background — slightly darker than terminal. */
export const DIFF_PAD_BG = `${ESC}48;2;25;27;32m`;
/** Diff: added line + cursor (brighter green tint). */
export const DIFF_ADDED_CURSOR_BG = `${ESC}48;2;38;62;38m`;
/** Diff: modified new-side + cursor (brighter green tint). */
export const DIFF_MODIFIED_NEW_CURSOR_BG = `${ESC}48;2;42;66;42m`;
/** Diff: center separator foreground. */
export const DIFF_SEPARATOR_FG = `${ESC}38;2;60;65;75m`;

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
 * Truncate an ANSI-styled string to `maxVisible` visible characters.
 * Preserves ANSI sequences that appear before the cutoff, appends RESET.
 * Returns the string unchanged if it fits within the limit.
 */
export const truncateAnsi = (s: string, maxVisible: number): string => {
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < maxVisible) {
    // Skip ANSI escape sequences (they have zero visible width)
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const mIdx = s.indexOf('m', i + 2);
      if (mIdx !== -1) {
        i = mIdx + 1;
        continue;
      }
    }
    visible++;
    i++;
  }
  if (i >= s.length) return s; // fits — no truncation needed
  return `${s.slice(0, i)}${RESET}`;
};

/**
 * Slice an ANSI-styled string: skip `start` visible characters, then take up to
 * `width` visible characters. Preserves ANSI state accumulated before the window
 * so colors/styles carry over correctly. Appends RESET if truncated.
 *
 * Returns the string unchanged when start=0 and it fits within width.
 */
export const sliceAnsi = (
  s: string,
  start: number,
  width: number
): string => {
  if (start === 0) return truncateAnsi(s, width);

  // Phase 1: skip `start` visible chars, collecting ANSI sequences
  let i = 0;
  let skipped = 0;
  const pendingAnsi: string[] = [];

  while (i < s.length && skipped < start) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const mIdx = s.indexOf('m', i + 2);
      if (mIdx !== -1) {
        pendingAnsi.push(s.slice(i, mIdx + 1));
        i = mIdx + 1;
        continue;
      }
    }
    skipped++;
    i++;
  }

  // Collect any trailing ANSI sequences right after the skip window
  while (i < s.length && s[i] === '\x1b' && s[i + 1] === '[') {
    const mIdx = s.indexOf('m', i + 2);
    if (mIdx === -1) break;
    pendingAnsi.push(s.slice(i, mIdx + 1));
    i = mIdx + 1;
  }

  if (i >= s.length) return ''; // nothing left after skip

  // Phase 2: take up to `width` visible chars from position i
  const rest = s.slice(i);
  const prefix = pendingAnsi.join('');
  return truncateAnsi(`${prefix}${rest}`, width);
};

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
