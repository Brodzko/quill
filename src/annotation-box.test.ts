import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi.js';
import type { Annotation } from './schema.js';
import {
  annotationsOnLine,
  renderAnnotationBox,
  wordWrap,
} from './annotation-box.js';

// ---------------------------------------------------------------------------
// wordWrap
// ---------------------------------------------------------------------------

describe('wordWrap', () => {
  it('returns single line when text fits', () => {
    expect(wordWrap('hello world', 80)).toEqual(['hello world']);
  });

  it('wraps long text at word boundaries', () => {
    const result = wordWrap('one two three four five', 10);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it('handles empty string', () => {
    expect(wordWrap('', 80)).toEqual(['']);
  });

  it('handles single word longer than maxWidth', () => {
    const result = wordWrap('superlongword', 5);
    expect(result).toEqual(['superlongword']);
  });

  it('returns text as-is when maxWidth <= 0', () => {
    expect(wordWrap('hello', 0)).toEqual(['hello']);
  });

  it('preserves explicit newlines', () => {
    expect(wordWrap('line one\nline two', 80)).toEqual(['line one', 'line two']);
  });

  it('preserves empty lines from consecutive newlines', () => {
    expect(wordWrap('first\n\nthird', 80)).toEqual(['first', '', 'third']);
  });

  it('wraps within paragraphs while preserving newlines', () => {
    const result = wordWrap('short\nthis is a longer paragraph that should wrap', 20);
    expect(result[0]).toBe('short');
    expect(result.length).toBeGreaterThan(2);
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// annotationsOnLine
// ---------------------------------------------------------------------------

describe('annotationsOnLine', () => {
  const ann1: Annotation = {
    id: 'a1',
    startLine: 3,
    endLine: 5,
    intent: 'comment',
    comment: 'test',
    source: 'user',
  };
  const ann2: Annotation = {
    id: 'a2',
    startLine: 5,
    endLine: 7,
    intent: 'question',
    comment: 'why?',
    source: 'agent',
  };

  it('returns annotations that cover the line', () => {
    expect(annotationsOnLine([ann1, ann2], 5)).toEqual([ann1, ann2]);
  });

  it('returns empty for uncovered line', () => {
    expect(annotationsOnLine([ann1, ann2], 1)).toEqual([]);
  });

  it('returns only matching annotations', () => {
    expect(annotationsOnLine([ann1, ann2], 3)).toEqual([ann1]);
  });
});

// ---------------------------------------------------------------------------
// renderAnnotationBox
// ---------------------------------------------------------------------------

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'ann-1',
  startLine: 1,
  endLine: 1,
  intent: 'comment',
  comment: 'This is a test comment.',
  source: 'user',
  ...overrides,
});

describe('renderAnnotationBox', () => {
  const opts = {
    maxWidth: 60,
    gutterPrefix: '     ',
    isFocused: false,
  };

  it('returns array of strings', () => {
    const rows = renderAnnotationBox(makeAnnotation(), opts);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('includes header with source and intent', () => {
    const rows = renderAnnotationBox(makeAnnotation(), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('you');
    expect(plain).toContain('comment');
  });

  it('includes the comment text', () => {
    const rows = renderAnnotationBox(makeAnnotation({ comment: 'Fix this bug' }), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('Fix this bug');
  });

  it('shows category in header when present', () => {
    const rows = renderAnnotationBox(makeAnnotation({ category: 'bug' }), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('bug');
  });

  it('shows agent label for agent source', () => {
    const rows = renderAnnotationBox(makeAnnotation({ source: 'agent' }), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('agent');
  });

  it('shows approved status', () => {
    const rows = renderAnnotationBox(makeAnnotation({ status: 'approved' }), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('👍 approved');
  });

  it('shows dismissed status', () => {
    const rows = renderAnnotationBox(makeAnnotation({ status: 'dismissed' }), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('👎 dismissed');
  });

  it('shows action hints when isFocused', () => {
    const rows = renderAnnotationBox(makeAnnotation(), {
      ...opts,
      isFocused: true,
    });
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('[r]eply');
    expect(plain).toContain('[w] edit');
    expect(plain).toContain('[x] delete');
  });

  it('does not show action hints when not focused', () => {
    const rows = renderAnnotationBox(makeAnnotation(), {
      ...opts,
      isFocused: false,
    });
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).not.toContain('[r]eply');
  });

  it('renders replies', () => {
    const ann = makeAnnotation({
      source: 'agent',
      replies: [{ comment: 'Agreed, will fix.', source: 'user' }],
    });
    const rows = renderAnnotationBox(ann, opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('↳');
    expect(plain).toContain('you');
    expect(plain).toContain('Agreed, will fix.');
  });

  it('renders multiple replies', () => {
    const ann = makeAnnotation({
      replies: [
        { comment: 'First reply', source: 'user' },
        { comment: 'Second reply', source: 'agent' },
      ],
    });
    const rows = renderAnnotationBox(ann, opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('First reply');
    expect(plain).toContain('Second reply');
  });

  it('has box drawing border characters', () => {
    const rows = renderAnnotationBox(makeAnnotation(), opts);
    const plain = rows.map(stripAnsi).join('\n');
    expect(plain).toContain('┌');
    expect(plain).toContain('┐');
    expect(plain).toContain('└');
    expect(plain).toContain('┘');
    expect(plain).toContain('│');
  });

  it('aligns top/bottom borders with content row widths', () => {
    const rows = renderAnnotationBox(makeAnnotation(), opts);
    const stripped = rows.map((r) => stripAnsi(r));
    const widths = stripped.map((r) => r.length);
    // All rows should have the same visible width
    const first = widths[0];
    for (const w of widths) {
      expect(w).toBe(first);
    }
  });

  it('preserves newlines in comment text', () => {
    const ann = makeAnnotation({ comment: 'Line one\nLine two\n\nLine four' });
    const rows = renderAnnotationBox(ann, opts);
    const plain = rows.map(stripAnsi);
    // Should have separate rows for each line, including the empty one
    const contentRows = plain.filter((r) => r.includes('│')).map((r) => r.trim());
    expect(contentRows.some((r) => r.includes('Line one'))).toBe(true);
    expect(contentRows.some((r) => r.includes('Line two'))).toBe(true);
    expect(contentRows.some((r) => r.includes('Line four'))).toBe(true);
    // The empty line between "Line two" and "Line four"
    const lineOneIdx = contentRows.findIndex((r) => r.includes('Line two'));
    const lineFourIdx = contentRows.findIndex((r) => r.includes('Line four'));
    expect(lineFourIdx - lineOneIdx).toBe(2); // one empty row in between
  });
});
