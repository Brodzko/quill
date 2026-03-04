import { describe, expect, it } from 'vitest';
import type { Key } from './keypress.js';
import {
  BROWSE,
  SELECT,
  PICKER,
  helpBar,
  BROWSE_HELP,
  BROWSE_SEARCH_HELP,
  BROWSE_EXPANDED_HELP,
  SELECT_HELP,
} from './keymap.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  scrollUp: false,
  scrollDown: false,
  scrollLeft: false,
  scrollRight: false,
  mouseRow: 0,
  mouseCol: 0,
};

const key = (overrides: Partial<Key>): Key => ({ ...EMPTY_KEY, ...overrides });

// ---------------------------------------------------------------------------
// Browse predicates
// ---------------------------------------------------------------------------

describe('BROWSE keymap predicates', () => {
  it('moveUp matches k and upArrow', () => {
    expect(BROWSE.moveUp.match(key({ char: 'k' }))).toBe(true);
    expect(BROWSE.moveUp.match(key({ upArrow: true }))).toBe(true);
    expect(BROWSE.moveUp.match(key({ char: 'j' }))).toBe(false);
  });

  it('moveDown matches j and downArrow', () => {
    expect(BROWSE.moveDown.match(key({ char: 'j' }))).toBe(true);
    expect(BROWSE.moveDown.match(key({ downArrow: true }))).toBe(true);
  });

  it('halfPageUp matches pageUp and Ctrl+U', () => {
    expect(BROWSE.halfPageUp.match(key({ pageUp: true }))).toBe(true);
    expect(BROWSE.halfPageUp.match(key({ ctrl: true, char: 'u' }))).toBe(true);
    expect(BROWSE.halfPageUp.match(key({ char: 'u' }))).toBe(false);
  });

  it('scrollLeft matches h and leftArrow', () => {
    expect(BROWSE.scrollLeft.match(key({ char: 'h' }))).toBe(true);
    expect(BROWSE.scrollLeft.match(key({ leftArrow: true }))).toBe(true);
  });

  it('gotoLine matches : and Ctrl+G', () => {
    expect(BROWSE.gotoLine.match(key({ char: ':' }))).toBe(true);
    expect(BROWSE.gotoLine.match(key({ ctrl: true, char: 'g' }))).toBe(true);
    expect(BROWSE.gotoLine.match(key({ char: 'g' }))).toBe(false);
  });

  it('shiftSelectUp matches Shift+upArrow', () => {
    expect(BROWSE.shiftSelectUp.match(key({ shift: true, upArrow: true }))).toBe(true);
    expect(BROWSE.shiftSelectUp.match(key({ upArrow: true }))).toBe(false);
  });

  it('nextAnnotation matches Tab (no shift)', () => {
    expect(BROWSE.nextAnnotation.match(key({ tab: true }))).toBe(true);
    expect(BROWSE.nextAnnotation.match(key({ tab: true, shift: true }))).toBe(false);
  });

  it('prevAnnotation matches Shift+Tab', () => {
    expect(BROWSE.prevAnnotation.match(key({ tab: true, shift: true }))).toBe(true);
    expect(BROWSE.prevAnnotation.match(key({ tab: true }))).toBe(false);
  });

  it('finish matches q', () => {
    expect(BROWSE.finish.match(key({ char: 'q' }))).toBe(true);
    expect(BROWSE.finish.match(key({ char: 'Q' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Select predicates
// ---------------------------------------------------------------------------

describe('SELECT keymap predicates', () => {
  it('extendUp matches k and upArrow', () => {
    expect(SELECT.extendUp.match(key({ char: 'k' }))).toBe(true);
    expect(SELECT.extendUp.match(key({ upArrow: true }))).toBe(true);
  });

  it('confirm matches Enter', () => {
    expect(SELECT.confirm.match(key({ return: true }))).toBe(true);
  });

  it('cancel matches Escape', () => {
    expect(SELECT.cancel.match(key({ escape: true }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Picker predicates
// ---------------------------------------------------------------------------

describe('PICKER keymap predicates', () => {
  it('up/down match arrows and j/k', () => {
    expect(PICKER.up.match(key({ upArrow: true }))).toBe(true);
    expect(PICKER.up.match(key({ char: 'k' }))).toBe(true);
    expect(PICKER.down.match(key({ downArrow: true }))).toBe(true);
    expect(PICKER.down.match(key({ char: 'j' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Help bar generation
// ---------------------------------------------------------------------------

describe('helpBar', () => {
  it('deduplicates entries with same hint+description', () => {
    const result = helpBar([BROWSE.moveUp, BROWSE.moveDown]);
    // Both share hint "j/k ↑↓" + description "move" — should appear once
    expect(result).toBe('[j/k ↑↓] move');
  });

  it('joins multiple unique entries', () => {
    const result = helpBar([BROWSE.moveUp, BROWSE.finish]);
    expect(result).toBe('[j/k ↑↓] move  [q] finish');
  });

  it('allows overriding description via spread', () => {
    const result = helpBar([{ ...BROWSE.annotate, description: 'new' }]);
    expect(result).toBe('[a] new');
  });
});

// ---------------------------------------------------------------------------
// Pre-built help strings
// ---------------------------------------------------------------------------

describe('pre-built help bars', () => {
  it('BROWSE_HELP contains expected fragments', () => {
    expect(BROWSE_HELP).toContain('[j/k ↑↓] move');
    expect(BROWSE_HELP).toContain('[q] finish');
    expect(BROWSE_HELP).toContain('[a] annotate');
    expect(BROWSE_HELP).toContain('[/] search');
  });

  it('BROWSE_SEARCH_HELP contains search navigation', () => {
    expect(BROWSE_SEARCH_HELP).toContain('[n/N] next/prev match');
    expect(BROWSE_SEARCH_HELP).toContain('[/] new search');
    expect(BROWSE_SEARCH_HELP).toContain('[Esc] clear');
  });

  it('BROWSE_EXPANDED_HELP contains annotation actions', () => {
    expect(BROWSE_EXPANDED_HELP).toContain('[r] reply');
    expect(BROWSE_EXPANDED_HELP).toContain('[w] edit');
    expect(BROWSE_EXPANDED_HELP).toContain('[x] delete');
    expect(BROWSE_EXPANDED_HELP).toContain('[c] toggle');
    expect(BROWSE_EXPANDED_HELP).toContain('[C] toggle all');
  });

  it('SELECT_HELP contains extend/confirm/cancel', () => {
    expect(SELECT_HELP).toContain('extend');
    expect(SELECT_HELP).toContain('[Enter] annotate');
    expect(SELECT_HELP).toContain('[Esc] cancel');
  });
});
