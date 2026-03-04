import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi.js';
import type { Annotation } from './schema.js';
import type { SessionState } from './state.js';
import { INITIAL_ANNOTATION_FLOW, INITIAL_DECIDE_FLOW } from './state.js';
import { createBuffer } from './text-buffer.js';
import { createPicker, CATEGORY_OPTIONS } from './picker.js';
import {
  type RenderContext,
  buildFrame,
  getViewportHeight,
} from './render.js';

const makeCtx = (overrides: Partial<RenderContext> = {}): RenderContext => {
  const lines = overrides.lines ?? Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const state: SessionState = overrides.state ?? {
    lineCount: lines.length,
      maxLineWidth: 120,
    viewportHeight: 10,
    cursorLine: 1,
    viewportOffset: 0,
      horizontalOffset: 0,
    mode: 'browse',
    annotations: [],
    expandedAnnotations: new Set(),
  };
  return {
    filePath: 'test.ts',
    lines,
    state,
    terminalRows: 15,
    terminalCols: 80,
    ...overrides,
  };
};

// ---------------------------------------------------------------------------
// getViewportHeight
// ---------------------------------------------------------------------------

describe('getViewportHeight', () => {
  it('computes viewport height from terminal rows', () => {
    // FIXED_CHROME = 2 (title + status), help bar = 1 → 3 total
    const vh = getViewportHeight(24);
    expect(vh).toBe(24 - 2 - 1); // 21
  });

  it('enforces minimum of 3', () => {
    expect(getViewportHeight(1)).toBe(3);
    expect(getViewportHeight(5)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildFrame — basic structure
// ---------------------------------------------------------------------------

describe('buildFrame', () => {
  it('returns a string', () => {
    const frame = buildFrame(makeCtx()).frame;
    expect(typeof frame).toBe('string');
  });

  it('contains the file path in the title', () => {
    const frame = buildFrame(makeCtx({ filePath: 'src/foo.ts' })).frame;
    expect(frame).toContain('src/foo.ts');
  });

  it('contains the cursor line content', () => {
    const frame = buildFrame(makeCtx({ lines: ['hello world', 'second'] })).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('hello world');
  });

  it('shows mode in status bar', () => {
    const frame = buildFrame(makeCtx()).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('BROWSE');
  });

  it('shows line position in status bar', () => {
    const ctx = makeCtx();
    const frame = buildFrame(ctx).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('ln 1/20');
  });

  it('shows cursor pointer on current line', () => {
    const frame = buildFrame(makeCtx()).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('>');
  });

  it('pads frame to terminal rows', () => {
    const ctx = makeCtx({ terminalRows: 30 });
    const frame = buildFrame(ctx).frame;
    const lineCount = frame.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(30);
  });

  it('returns viewportStartRow = 2 for standard layout (1 title row)', () => {
    const result = buildFrame(makeCtx());
    expect(result.viewportStartRow).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildFrame — decide mode
// ---------------------------------------------------------------------------

describe('buildFrame — decide mode', () => {
  it('shows decision picker in decide mode', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'decide',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(makeCtx({
      state: { ...state, decideFlow: { ...INITIAL_DECIDE_FLOW } },
    })).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Decision');
    expect(plain).toContain('approve');
    expect(plain).toContain('deny');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — goto mode
// ---------------------------------------------------------------------------

describe('buildFrame — goto mode', () => {
  it('shows goto prompt when in goto mode', () => {
    const state: SessionState = {
      lineCount: 100,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'goto',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({ state: { ...state, gotoFlow: { input: '42' } } })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Go to line');
    expect(plain).toContain('42');
    expect(plain).toContain('1–100');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — annotation flow
// ---------------------------------------------------------------------------

describe('buildFrame — annotation flow', () => {
  it('shows intent picker in annotate mode', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'annotate',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state: { ...state, annotationFlow: { ...INITIAL_ANNOTATION_FLOW } },
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Intent');
    expect(plain).toContain('instruct');
    expect(plain).toContain('question');
    expect(plain).toContain('comment');
    expect(plain).toContain('praise');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — select mode
// ---------------------------------------------------------------------------

describe('buildFrame — select mode', () => {
  it('shows SELECT in status bar', () => {
    const state: SessionState = {
      lineCount: 20,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'select',
      annotations: [],
      expandedAnnotations: new Set(),
      selection: { anchor: 3, active: 5 },
    };
    const frame = buildFrame(makeCtx({ state })).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('SELECT');
  });

  it('shows selection range in status bar', () => {
    const state: SessionState = {
      lineCount: 20,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 7,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'select',
      annotations: [],
      expandedAnnotations: new Set(),
      selection: { anchor: 3, active: 7 },
    };
    const frame = buildFrame(makeCtx({ state })).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('sel 3–7');
    expect(plain).toContain('5 lns');
  });

  it('shows select help hints', () => {
    const state: SessionState = {
      lineCount: 20,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'select',
      annotations: [],
      expandedAnnotations: new Set(),
      selection: { anchor: 5, active: 5 },
    };
    const frame = buildFrame(makeCtx({ state })).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('extend');
    expect(plain).toContain('Enter');
    expect(plain).toContain('Esc');
  });

  it('applies selection background to selected lines', () => {
    const state: SessionState = {
      lineCount: 20,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'select',
      annotations: [],
      expandedAnnotations: new Set(),
      selection: { anchor: 3, active: 5 },
    };
    const frame = buildFrame(makeCtx({ state })).frame;
    expect(frame).toContain('\x1b[48;2;38;50;70m');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — annotation markers
// ---------------------------------------------------------------------------

describe('buildFrame — annotation markers', () => {
  it('shows ● on annotated lines', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 3,
      endLine: 3,
      intent: 'comment',
      comment: 'test',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    const lines = plain.split('\n');
    const line3 = lines.find((l) => l.includes('line 3'));
    expect(line3).toContain('●');
  });

  it('shows ◎ for focused annotation', () => {
    const annotation: Annotation = {
      id: 'focus-ann',
      startLine: 2,
      endLine: 4,
      intent: 'question',
      comment: 'why?',
      source: 'agent',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state,
        focusAnnotation: 'focus-ann',
        lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`),
      })
    ).frame;
    const plain = stripAnsi(frame);
    const line3 = plain.split('\n').find((l) => l.includes('line 3'));
    expect(line3).toContain('◎');
  });

  it('shows space marker on unannotated lines', () => {
    const state: SessionState = {
      lineCount: 5,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 5 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).not.toContain('●');
    expect(plain).not.toContain('◎');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — viewport overflow
// ---------------------------------------------------------------------------

describe('buildFrame — viewport overflow', () => {
  it('shows ~ for lines past end of file', () => {
    const state: SessionState = {
      lineCount: 3,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state,
        lines: ['a', 'b', 'c'],
        terminalRows: 15,
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('~');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — expanded annotation box
// ---------------------------------------------------------------------------

describe('buildFrame — expanded annotation box', () => {
  it('shows annotation box when expanded', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 3,
      endLine: 3,
      intent: 'comment',
      comment: 'This is a test comment.',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 3,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(['a1']),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('┌');
    expect(plain).toContain('This is a test comment.');
    expect(plain).toContain('└');
  });

  it('shows ▼ marker on line with expanded annotation', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 3,
      endLine: 3,
      intent: 'comment',
      comment: 'test',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(['a1']),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    const line3 = plain.split('\n').find((l) => l.includes('line 3'));
    expect(line3).toContain('▼');
  });

  it('shows action hints when cursor is on annotation line', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 3,
      endLine: 3,
      intent: 'comment',
      comment: 'test',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 15,
      cursorLine: 3,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(['a1']),
    };
    const frame = buildFrame(
      makeCtx({
        state,
        lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`),
        terminalRows: 20,
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('[r]eply');
    expect(plain).toContain('[w] edit');
  });

  it('does not show annotation box when collapsed', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 3,
      endLine: 3,
      intent: 'comment',
      comment: 'This should not appear expanded.',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).not.toContain('This should not appear expanded.');
  });

  it('annotation box reduces visible source lines', () => {
    const annotation: Annotation = {
      id: 'a1',
      startLine: 2,
      endLine: 2,
      intent: 'comment',
      comment: 'A comment that takes space.',
      source: 'user',
    };
    const state: SessionState = {
      lineCount: 20,
      maxLineWidth: 120,
      viewportHeight: 10,
      cursorLine: 2,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(['a1']),
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    const visibleLines = plain.split('\n').filter((l) => l.match(/line \d+/));
    expect(visibleLines.length).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// buildFrame — reply/edit modes
// ---------------------------------------------------------------------------

describe('buildFrame — reply mode', () => {
  it('shows reply textbox', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'reply',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state: { ...state, replyFlow: { annotationId: 'a1', comment: createBuffer('hello') } },
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Reply');
    expect(plain).toContain('hello');
  });
});

describe('buildFrame — edit mode', () => {
  it('shows edit textbox', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'edit',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state: { ...state, editFlow: { annotationId: 'a1', comment: createBuffer('editing') } },
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Edit comment');
    expect(plain).toContain('editing');
  });
});

describe('buildFrame — annotation flow category step', () => {
  it('shows category picker with intent', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'annotate',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state: {
          ...state,
          annotationFlow: {
            step: 'category',
            intent: 'instruct',
            comment: createBuffer(),
            picker: createPicker(CATEGORY_OPTIONS),
          },
        },
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('Category');
    expect(plain).toContain('bug');
  });
});

describe('buildFrame — annotation flow comment step', () => {
  it('shows comment textbox with intent and category context', () => {
    const state: SessionState = {
      lineCount: 10,
      maxLineWidth: 120,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'annotate',
      annotations: [],
      expandedAnnotations: new Set(),
    };
    const frame = buildFrame(
      makeCtx({
        state: {
          ...state,
          annotationFlow: {
            step: 'comment',
            intent: 'question',
            category: 'bug',
            comment: createBuffer('hello'),
            picker: createPicker([]),
          },
        },
      })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).toContain('question');
    expect(plain).toContain('bug');
    expect(plain).toContain('hello');
  });
});
