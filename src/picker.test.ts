import { describe, it, expect } from 'vitest';
import {
  createPicker,
  moveHighlight,
  getHighlighted,
  findByShortcut,
  renderPicker,
  INTENT_OPTIONS,
  CATEGORY_OPTIONS,
  DECISION_OPTIONS,
} from './picker.js';
import { stripAnsi } from './ansi.js';

describe('createPicker', () => {
  it('creates picker with default highlight at 0', () => {
    const p = createPicker(INTENT_OPTIONS);
    expect(p.highlighted).toBe(0);
    expect(p.options).toBe(INTENT_OPTIONS);
  });

  it('clamps initial highlight to range', () => {
    expect(createPicker(INTENT_OPTIONS, 99).highlighted).toBe(3);
    expect(createPicker(INTENT_OPTIONS, -1).highlighted).toBe(0);
  });
});

describe('moveHighlight', () => {
  it('moves down', () => {
    const p = createPicker(INTENT_OPTIONS);
    expect(moveHighlight(p, 1).highlighted).toBe(1);
  });

  it('wraps around forward', () => {
    const p = createPicker(INTENT_OPTIONS, 3);
    expect(moveHighlight(p, 1).highlighted).toBe(0);
  });

  it('wraps around backward', () => {
    const p = createPicker(INTENT_OPTIONS, 0);
    expect(moveHighlight(p, -1).highlighted).toBe(3);
  });
});

describe('getHighlighted', () => {
  it('returns highlighted option', () => {
    const p = createPicker(INTENT_OPTIONS, 2);
    expect(getHighlighted(p)?.id).toBe('comment');
  });
});

describe('findByShortcut', () => {
  it('finds option by shortcut key', () => {
    const p = createPicker(INTENT_OPTIONS);
    expect(findByShortcut(p, 'q')?.id).toBe('question');
  });

  it('returns undefined for unknown shortcut', () => {
    const p = createPicker(INTENT_OPTIONS);
    expect(findByShortcut(p, 'z')).toBeUndefined();
  });
});

describe('renderPicker', () => {
  const cols = 80;

  it('renders intent picker with correct structure', () => {
    const p = createPicker(INTENT_OPTIONS);
    const rows = renderPicker(p, { label: 'Intent', cols });

    // Top border, 4 options, hints, bottom border = 7 rows
    expect(rows).toHaveLength(7);

    const plain = rows.map(stripAnsi);
    expect(plain[0]).toContain('Intent');
    expect(plain[0]).toContain('┌');
    expect(plain[1]).toContain('▸');
    expect(plain[1]).toContain('[i]');
    expect(plain[1]).toContain('instruct');
    // Non-highlighted option
    expect(plain[2]).toContain('[q]');
    expect(plain[2]).not.toContain('▸');
    // Hints
    expect(plain[5]).toContain('move');
    // Bottom border
    expect(plain[6]).toContain('└');
  });

  it('renders category picker with label hint', () => {
    const p = createPicker(CATEGORY_OPTIONS);
    const rows = renderPicker(p, {
      label: 'Category',
      labelHint: 'Enter to skip',
      cols,
    });
    const plain = rows.map(stripAnsi);
    expect(plain[0]).toContain('Enter to skip');
    expect(rows).toHaveLength(10); // border + 7 options + hints + border
  });

  it('renders decision picker', () => {
    const p = createPicker(DECISION_OPTIONS);
    const rows = renderPicker(p, { label: 'Decision', cols });
    expect(rows).toHaveLength(5); // border + 2 options + hints + border
  });

  it('shows highlight on correct option when moved', () => {
    const p = moveHighlight(createPicker(INTENT_OPTIONS), 2);
    const rows = renderPicker(p, { label: 'Intent', cols });
    const plain = rows.map(stripAnsi);
    // Option index 2 (comment) should have marker
    expect(plain[3]).toContain('▸');
    expect(plain[3]).toContain('comment');
    // Option index 0 should not
    expect(plain[1]).not.toContain('▸');
  });
});
