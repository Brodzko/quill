/**
 * Centralized keymap — single source of truth for key→action bindings.
 *
 * Consumed by dispatch (match predicates) and render (help bar generation).
 * To remap a key, change the `match` predicate and `hint` string here;
 * both logic and UI update automatically.
 */

import type { Key } from './keypress.js';

// --- Types ---

export type KeymapEntry = {
  /** Predicate: does this key event trigger this action? */
  readonly match: (key: Key) => boolean;
  /** Display label for help bars, e.g., "j/k ↑↓". */
  readonly hint: string;
  /** Human description, e.g., "move". */
  readonly description: string;
};

// --- Shared predicates ---

const isUp = (k: Key): boolean => k.char === 'k' || k.upArrow;
const isDown = (k: Key): boolean => k.char === 'j' || k.downArrow;
const isHalfPageUp = (k: Key): boolean =>
  k.pageUp || (k.ctrl && k.char === 'u');
const isHalfPageDown = (k: Key): boolean =>
  k.pageDown || (k.ctrl && k.char === 'd');
const isScrollLeft = (k: Key): boolean => k.char === 'h' || k.leftArrow;
const isScrollRight = (k: Key): boolean => k.char === 'l' || k.rightArrow;

// --- Browse mode keymap ---

export const BROWSE = {
  moveUp: {
    match: isUp,
    hint: 'j/k ↑↓',
    description: 'move',
  },
  moveDown: {
    match: isDown,
    hint: 'j/k ↑↓',
    description: 'move',
  },
  halfPageUp: {
    match: isHalfPageUp,
    hint: 'PgUp/Ctrl+U',
    description: 'half page up',
  },
  halfPageDown: {
    match: isHalfPageDown,
    hint: 'PgDn/Ctrl+D',
    description: 'half page down',
  },
  scrollLeft: {
    match: isScrollLeft,
    hint: 'h/l ←→',
    description: 'scroll',
  },
  scrollRight: {
    match: isScrollRight,
    hint: 'h/l ←→',
    description: 'scroll',
  },
  resetHorizontal: {
    match: (k: Key): boolean => k.char === '0',
    hint: '0',
    description: 'reset scroll',
  },
  mouseScrollUp: {
    match: (k: Key): boolean => k.scrollUp,
    hint: 'wheel',
    description: 'scroll',
  },
  mouseScrollDown: {
    match: (k: Key): boolean => k.scrollDown,
    hint: 'wheel',
    description: 'scroll',
  },
  mouseScrollLeft: {
    match: (k: Key): boolean => k.scrollLeft,
    hint: 'shift+wheel',
    description: 'h-scroll',
  },
  mouseScrollRight: {
    match: (k: Key): boolean => k.scrollRight,
    hint: 'shift+wheel',
    description: 'h-scroll',
  },
  jumpTop: {
    match: (k: Key): boolean => k.home,
    hint: 'Home/gg',
    description: 'top',
  },
  jumpBottom: {
    match: (k: Key): boolean => k.end,
    hint: 'End/G',
    description: 'bottom',
  },
  jumpBottomG: {
    match: (k: Key): boolean => k.char === 'G',
    hint: 'End/G',
    description: 'bottom',
  },
  startGg: {
    match: (k: Key): boolean => k.char === 'g',
    hint: 'Home/gg',
    description: 'top',
  },
  shiftSelectUp: {
    match: (k: Key): boolean => k.shift && k.upArrow,
    hint: 'v Shift+↑↓',
    description: 'select',
  },
  shiftSelectDown: {
    match: (k: Key): boolean => k.shift && k.downArrow,
    hint: 'v Shift+↑↓',
    description: 'select',
  },
  startSelect: {
    match: (k: Key): boolean => k.char === 'v',
    hint: 'v Shift+↑↓',
    description: 'select',
  },
  nextAnnotation: {
    match: (k: Key): boolean => k.tab && !k.shift,
    hint: 'Tab/S-Tab',
    description: 'annotations',
  },
  prevAnnotation: {
    match: (k: Key): boolean => k.tab && k.shift,
    hint: 'Tab/S-Tab',
    description: 'annotations',
  },
  toggleAnnotation: {
    match: (k: Key): boolean => k.char === 'c',
    hint: 'c',
    description: 'toggle',
  },
  toggleAllAnnotations: {
    match: (k: Key): boolean => k.char === 'C',
    hint: 'C',
    description: 'toggle all',
  },
  reply: {
    match: (k: Key): boolean => k.char === 'r',
    hint: 'r',
    description: 'reply',
  },
  editAnnotation: {
    match: (k: Key): boolean => k.char === 'w',
    hint: 'w',
    description: 'edit',
  },
  deleteAnnotation: {
    match: (k: Key): boolean => k.char === 'x',
    hint: 'x',
    description: 'delete',
  },
  cycleStatus: {
    match: (k: Key): boolean => k.char === 's',
    hint: 's',
    description: 'status',
  },
  annotate: {
    match: (k: Key): boolean => k.char === 'a',
    hint: 'a',
    description: 'annotate',
  },
  annotateFile: {
    match: (k: Key): boolean => k.char === 'A',
    hint: 'A',
    description: 'file comment',
  },
  search: {
    match: (k: Key): boolean => k.char === '/',
    hint: '/',
    description: 'search',
  },
  nextMatch: {
    match: (k: Key): boolean => k.char === 'n',
    hint: 'n/N',
    description: 'next/prev match',
  },
  prevMatch: {
    match: (k: Key): boolean => k.char === 'N',
    hint: 'n/N',
    description: 'next/prev match',
  },
  nextMatchCtrl: {
    match: (k: Key): boolean => k.ctrl && k.char === 'n',
    hint: 'Ctrl+N/P',
    description: 'next/prev match',
  },
  prevMatchCtrl: {
    match: (k: Key): boolean => k.ctrl && k.char === 'p',
    hint: 'Ctrl+N/P',
    description: 'next/prev match',
  },
  clearSearch: {
    match: (k: Key): boolean => k.escape,
    hint: 'Esc',
    description: 'clear',
  },
  gotoLine: {
    match: (k: Key): boolean => k.char === ':' || (k.ctrl && k.char === 'g'),
    hint: ':',
    description: 'goto',
  },
  toggleWrap: {
    match: (k: Key): boolean => k.char === 'W',
    hint: 'W',
    description: 'wrap',
  },
  toggleDiff: {
    match: (k: Key): boolean => k.char === 'd',
    hint: 'd',
    description: 'diff',
  },
  expandDown: {
    match: (k: Key): boolean => k.char === ']',
    hint: '[/]',
    description: 'expand',
  },
  expandUp: {
    match: (k: Key): boolean => k.char === '[',
    hint: '[/]',
    description: 'expand',
  },
  toggleAllRegions: {
    match: (k: Key): boolean => k.char === 'E',
    hint: 'E',
    description: 'expand/collapse all',
  },
  finish: {
    match: (k: Key): boolean => k.char === 'q',
    hint: 'q',
    description: 'finish',
  },
} as const satisfies Record<string, KeymapEntry>;

// --- Select mode keymap ---

export const SELECT = {
  extendUp: {
    match: isUp,
    hint: 'j/k ↑↓ Shift+↑↓',
    description: 'extend',
  },
  extendDown: {
    match: isDown,
    hint: 'j/k ↑↓ Shift+↑↓',
    description: 'extend',
  },
  extendHalfPageUp: {
    match: isHalfPageUp,
    hint: 'j/k ↑↓ Shift+↑↓',
    description: 'extend',
  },
  extendHalfPageDown: {
    match: isHalfPageDown,
    hint: 'j/k ↑↓ Shift+↑↓',
    description: 'extend',
  },
  confirm: {
    match: (k: Key): boolean => k.return || k.char === 'a',
    hint: 'Enter/a',
    description: 'annotate',
  },
  cancel: {
    match: (k: Key): boolean => k.escape,
    hint: 'Esc',
    description: 'cancel',
  },
} as const satisfies Record<string, KeymapEntry>;

// --- Picker navigation (shared across annotate/confirm/decide modes) ---

export const PICKER = {
  up: {
    match: (k: Key): boolean => k.upArrow || k.char === 'k',
    hint: '↑↓',
    description: 'move',
  },
  down: {
    match: (k: Key): boolean => k.downArrow || k.char === 'j',
    hint: '↑↓',
    description: 'move',
  },
  confirm: {
    match: (k: Key): boolean => k.return,
    hint: 'Enter',
    description: 'select',
  },
  cancel: {
    match: (k: Key): boolean => k.escape,
    hint: 'Esc',
    description: 'cancel',
  },
} as const satisfies Record<string, KeymapEntry>;

// --- Help bar generation ---

/**
 * Build a help bar string from keymap entries.
 * Deduplicates entries with identical hint+description.
 */
export const helpBar = (entries: readonly KeymapEntry[]): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const e of entries) {
    const key = `${e.hint}|${e.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`[${e.hint}] ${e.description}`);
  }
  return parts.join('  ');
};

// --- Pre-built help bar strings (derived from keymap) ---

/** Default browse mode help. */
export const BROWSE_HELP = helpBar([
  BROWSE.moveUp,
  BROWSE.scrollLeft,
  BROWSE.toggleWrap,
  BROWSE.startSelect,
  BROWSE.nextAnnotation,
  BROWSE.search,
  BROWSE.annotate,
  BROWSE.annotateFile,
  BROWSE.gotoLine,
  BROWSE.finish,
]);

/** Browse mode with active search matches. */
export const BROWSE_SEARCH_HELP = helpBar([
  BROWSE.moveUp,
  BROWSE.nextMatch,
  { ...BROWSE.search, description: 'new search' },
  { ...BROWSE.clearSearch, description: 'clear' },
  BROWSE.annotate,
  BROWSE.finish,
]);

/** Browse mode with expanded annotation on cursor line. */
export const BROWSE_EXPANDED_HELP = helpBar([
  BROWSE.moveUp,
  { ...BROWSE.nextAnnotation, description: 'next/prev' },
  BROWSE.cycleStatus,
  BROWSE.reply,
  BROWSE.editAnnotation,
  BROWSE.deleteAnnotation,
  BROWSE.toggleAnnotation,
  BROWSE.toggleAllAnnotations,
  { ...BROWSE.annotate, description: 'new' },
  BROWSE.annotateFile,
  BROWSE.finish,
]);

/** Browse mode when diff data is available (shows toggle hint). */
export const BROWSE_DIFF_HELP = helpBar([
  BROWSE.moveUp,
  { ...BROWSE.toggleDiff, description: 'raw view' },
  BROWSE.expandDown,
  BROWSE.toggleAllRegions,
  BROWSE.startSelect,
  BROWSE.nextAnnotation,
  BROWSE.search,
  BROWSE.annotate,
  BROWSE.gotoLine,
  BROWSE.finish,
]);

/** Browse mode when in raw view but diff data exists (shows toggle hint). */
export const BROWSE_RAW_WITH_DIFF_HELP = helpBar([
  BROWSE.moveUp,
  BROWSE.scrollLeft,
  BROWSE.toggleWrap,
  { ...BROWSE.toggleDiff, description: 'diff view' },
  BROWSE.startSelect,
  BROWSE.nextAnnotation,
  BROWSE.search,
  BROWSE.annotate,
  BROWSE.gotoLine,
  BROWSE.finish,
]);

/** Select mode help. */
export const SELECT_HELP = helpBar([
  SELECT.extendUp,
  SELECT.confirm,
  SELECT.cancel,
]);
