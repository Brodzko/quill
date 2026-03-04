import { describe, expect, it } from 'vitest';
import {
  DIFF_ADDED_BG,
  DIFF_HUNK_BG,
  DIFF_MODIFIED_NEW_BG,
  DIFF_MODIFIED_OLD_BG,
  DIFF_PAD_BG,
  DIFF_REMOVED_BG,
  stripAnsi,
} from './ansi.js';
import type { DiffData, AlignedRow } from './diff-align.js';
import type { Annotation } from './schema.js';
import type { DiffMeta, SessionState } from './state.js';
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
    focusedAnnotationId: null,
    viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
  it('shows ● on collapsed annotated lines', () => {
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
      focusedAnnotationId: null,
      viewMode: 'raw',
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    const lines = plain.split('\n');
    const line3 = lines.find((l) => l.includes('line 3'));
    expect(line3).toContain('●');
  });

  it('shows focused marker with accent color for focusedAnnotationId', () => {
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
      cursorLine: 3,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [annotation],
      expandedAnnotations: new Set(['focus-ann']),
      focusedAnnotationId: 'focus-ann',
      viewMode: 'raw',
    };
    const frame = buildFrame(
      makeCtx({
        state,
        lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`),
      })
    ).frame;
    const plain = stripAnsi(frame);
    const line3 = plain.split('\n').find((l) => l.includes('line 3'));
    // Focused expanded annotation shows ▼
    expect(line3).toContain('▼');
    // The raw frame should contain the FOCUS_MARKER color escape
    expect(frame).toContain('\x1b[38;2;97;175;239m');
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
      focusedAnnotationId: null,
      viewMode: 'raw',
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 5 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    expect(plain).not.toContain('●');
    expect(plain).not.toContain('▼');
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
    };
    const frame = buildFrame(
      makeCtx({ state, lines: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`) })
    ).frame;
    const plain = stripAnsi(frame);
    const line3 = plain.split('\n').find((l) => l.includes('line 3'));
    expect(line3).toContain('▼');
  });

  it('shows action hints when annotation is focused', () => {
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
      focusedAnnotationId: 'a1',
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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
      focusedAnnotationId: null,
      viewMode: 'raw',
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

// ---------------------------------------------------------------------------
// Diff mode rendering
// ---------------------------------------------------------------------------

/** Helper: build a minimal DiffData from rows. */
const makeDiffData = (rows: AlignedRow[], label = 'test'): DiffData => {
  const rowToNewLine: (number | null)[] = [];
  const newLineToRowIndex = new Map<number, number>();
  const visibleNewLines: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const nl = rows[i]!.newLineNumber;
    rowToNewLine.push(nl);
    if (nl !== null) {
      newLineToRowIndex.set(nl, i);
      visibleNewLines.push(nl);
    }
  }

  return { rows, rowToNewLine, newLineToRowIndex, visibleNewLines, label };
};

/** Helper: build a DiffMeta from DiffData. */
const makeDiffMeta = (dd: DiffData): DiffMeta => ({
  rowCount: dd.rows.length,
  visibleLines: dd.visibleNewLines,
  newLineToRow: dd.newLineToRowIndex,
});

/** Minimal diff rows for a 3-line context + 2 added + 1 removed scenario. */
const sampleDiffRows: AlignedRow[] = [
  { type: 'context', oldLineNumber: 1, newLineNumber: 1, oldContent: 'const a = 1;', newContent: 'const a = 1;' },
  { type: 'removed', oldLineNumber: 2, newLineNumber: null, oldContent: 'const b = 2;', newContent: null },
  { type: 'added', oldLineNumber: null, newLineNumber: 2, oldContent: null, newContent: 'const b = 3;' },
  { type: 'modified', oldLineNumber: 3, newLineNumber: 3, oldContent: 'return a;', newContent: 'return a + b;' },
  { type: 'context', oldLineNumber: 4, newLineNumber: 4, oldContent: '}', newContent: '}' },
];

const sampleDiffData = makeDiffData(sampleDiffRows, 'main');

const makeDiffCtx = (overrides: {
  diffData?: DiffData;
  lines?: string[];
  state?: Partial<SessionState>;
  terminalRows?: number;
  terminalCols?: number;
  filePath?: string;
  oldHighlightedLines?: readonly string[];
} = {}): RenderContext => {
  const dd = overrides.diffData ?? sampleDiffData;
  const meta = makeDiffMeta(dd);
  const lines = overrides.lines ?? ['const a = 1;', 'const b = 3;', 'return a + b;', '}'];
  const state: SessionState = {
    lineCount: lines.length,
    maxLineWidth: 80,
    viewportHeight: 15,
    cursorLine: 1,
    viewportOffset: 0,
    horizontalOffset: 0,
    mode: 'browse',
    annotations: [],
    expandedAnnotations: new Set(),
    focusedAnnotationId: null,
    viewMode: 'diff',
    diffMeta: meta,
    ...(overrides.state ?? {}),
  };
  return {
    filePath: overrides.filePath ?? 'test.ts',
    lines,
    state,
    terminalRows: overrides.terminalRows ?? 20,
    terminalCols: overrides.terminalCols ?? 120,
    diffData: dd,
    oldHighlightedLines: overrides.oldHighlightedLines,
  };
};

describe('buildFrame — diff mode', () => {
  it('renders side-by-side panes with a separator', () => {
    const { frame } = buildFrame(makeDiffCtx());
    const plain = stripAnsi(frame);
    // The separator character │ should appear in each content row
    const contentLines = plain.split('\n').filter(l => l.includes('const'));
    expect(contentLines.length).toBeGreaterThan(0);
    for (const line of contentLines) {
      expect(line).toContain('│');
    }
  });

  it('shows diff label in title bar', () => {
    const { frame } = buildFrame(makeDiffCtx());
    const plain = stripAnsi(frame);
    expect(plain).toContain('(diff: main)');
  });

  it('shows diff label in status bar', () => {
    const { frame } = buildFrame(makeDiffCtx());
    const plain = stripAnsi(frame);
    expect(plain).toContain('diff: main');
  });

  it('contains DIFF_REMOVED_BG for removed rows', () => {
    const { frame } = buildFrame(makeDiffCtx());
    expect(frame).toContain(DIFF_REMOVED_BG);
  });

  it('contains DIFF_ADDED_BG for added rows', () => {
    const { frame } = buildFrame(makeDiffCtx());
    expect(frame).toContain(DIFF_ADDED_BG);
  });

  it('contains DIFF_MODIFIED_OLD_BG / DIFF_MODIFIED_NEW_BG for modified rows', () => {
    const { frame } = buildFrame(makeDiffCtx());
    expect(frame).toContain(DIFF_MODIFIED_OLD_BG);
    expect(frame).toContain(DIFF_MODIFIED_NEW_BG);
  });

  it('contains DIFF_PAD_BG for padding cells', () => {
    const { frame } = buildFrame(makeDiffCtx());
    // Added row → left side is padding
    expect(frame).toContain(DIFF_PAD_BG);
  });

  it('shows cursor pointer > only on the right (new) side', () => {
    const ctx = makeDiffCtx({ state: { cursorLine: 1 } });
    const { frame } = buildFrame(ctx);
    const plain = stripAnsi(frame);
    // Context row for line 1 should have > on the right pane
    const line1Rows = plain.split('\n').filter(l => l.includes('const a'));
    expect(line1Rows.length).toBeGreaterThan(0);
    // The > should appear once (right side only)
    const firstRow = line1Rows[0]!;
    const parts = firstRow.split('│');
    // Left pane should start with space (no pointer)
    expect(parts[0]!.trimStart().startsWith('>')).toBe(false);
  });

  it('maps rowToLine to new-file line numbers', () => {
    const { rowToLine } = buildFrame(makeDiffCtx());
    // Row 0 = context (newLine 1), Row 1 = removed (undefined), Row 2 = added (newLine 2),
    // Row 3 = modified (newLine 3), Row 4 = context (newLine 4)
    expect(rowToLine[0]).toBe(1);
    expect(rowToLine[1]).toBeUndefined(); // removed row
    expect(rowToLine[2]).toBe(2); // added row
    expect(rowToLine[3]).toBe(3); // modified row
    expect(rowToLine[4]).toBe(4); // context row
  });

  it('shows ~ for rows past the end of diff', () => {
    const dd = makeDiffData([
      { type: 'context', oldLineNumber: 1, newLineNumber: 1, oldContent: 'x', newContent: 'x' },
    ], 'short');
    const ctx = makeDiffCtx({
      diffData: dd,
      lines: ['x'],
      terminalRows: 20,
    });
    const { frame } = buildFrame(ctx);
    const plain = stripAnsi(frame);
    // Tilde rows appear for empty lines past end of diff
    const tildes = plain.split('\n').filter(l => l.includes('~'));
    expect(tildes.length).toBeGreaterThanOrEqual(3);
  });

  it('renders hunk headers with hunk background', () => {
    const rows: AlignedRow[] = [
      { type: 'context', oldLineNumber: 1, newLineNumber: 1, oldContent: 'a', newContent: 'a' },
      { type: 'hunk-header', oldLineNumber: null, newLineNumber: null, oldContent: null, newContent: null, header: '@@ -10,5 +10,7 @@' },
      { type: 'added', oldLineNumber: null, newLineNumber: 10, oldContent: null, newContent: 'new line' },
    ];
    const dd = makeDiffData(rows, 'hunk-test');
    const { frame } = buildFrame(makeDiffCtx({ diffData: dd, lines: Array(10).fill('x') }));
    expect(frame).toContain(DIFF_HUNK_BG);
    const plain = stripAnsi(frame);
    expect(plain).toContain('@@ -10,5 +10,7 @@');
  });

  it('hunk header rows map to undefined in rowToLine', () => {
    const rows: AlignedRow[] = [
      { type: 'hunk-header', oldLineNumber: null, newLineNumber: null, oldContent: null, newContent: null, header: '@@' },
      { type: 'added', oldLineNumber: null, newLineNumber: 1, oldContent: null, newContent: 'x' },
    ];
    const dd = makeDiffData(rows, 'h');
    const { rowToLine } = buildFrame(makeDiffCtx({ diffData: dd, lines: ['x'] }));
    expect(rowToLine[0]).toBeUndefined();
    expect(rowToLine[1]).toBe(1);
  });

  it('renders annotation box below annotated new-file line', () => {
    const ann: Annotation = {
      id: 'da1',
      startLine: 2,
      endLine: 2,
      intent: 'comment',
      comment: 'diff annotation test',
      source: 'user',
    };
    const ctx = makeDiffCtx({
      state: {
        cursorLine: 2,
        annotations: [ann],
        expandedAnnotations: new Set(['da1']),
        focusedAnnotationId: 'da1',
      },
    });
    const { frame } = buildFrame(ctx);
    const plain = stripAnsi(frame);
    expect(plain).toContain('diff annotation test');
    expect(plain).toContain('┌');
  });

  it('shows diff-specific help bar with d toggle hint', () => {
    const { frame } = buildFrame(makeDiffCtx());
    const plain = stripAnsi(frame);
    expect(plain).toContain('[d] raw view');
  });

  it('shows raw-with-diff help bar when in raw mode with diffMeta', () => {
    const dd = sampleDiffData;
    const meta = makeDiffMeta(dd);
    const lines = ['const a = 1;', 'const b = 3;', 'return a + b;', '}'];
    const state: SessionState = {
      lineCount: lines.length,
      maxLineWidth: 80,
      viewportHeight: 15,
      cursorLine: 1,
      viewportOffset: 0,
      horizontalOffset: 0,
      mode: 'browse',
      annotations: [],
      expandedAnnotations: new Set(),
      focusedAnnotationId: null,
      viewMode: 'raw',
      diffMeta: meta,
    };
    const { frame } = buildFrame({
      filePath: 'test.ts',
      lines,
      state,
      terminalRows: 20,
      terminalCols: 120,
      diffData: dd,
    });
    const plain = stripAnsi(frame);
    expect(plain).toContain('[d] diff view');
  });

  it('produces correct row count matching viewport height', () => {
    // terminalRows=12, FIXED_CHROME=2, help=1 → viewport=9
    const ctx = makeDiffCtx({ terminalRows: 12, state: { viewportHeight: 9 } });
    const { rowToLine } = buildFrame(ctx);
    expect(rowToLine.length).toBe(9);
  });

  it('works at narrow terminal width (80 cols)', () => {
    const { frame } = buildFrame(makeDiffCtx({ terminalCols: 80 }));
    const plain = stripAnsi(frame);
    const contentLines = plain.split('\n').filter(l => l.includes('│'));
    expect(contentLines.length).toBeGreaterThan(0);
  });

  it('works at wide terminal width (200 cols)', () => {
    const { frame } = buildFrame(makeDiffCtx({ terminalCols: 200 }));
    const plain = stripAnsi(frame);
    const contentLines = plain.split('\n').filter(l => l.includes('│'));
    expect(contentLines.length).toBeGreaterThan(0);
  });

  it('does not show diff title suffix when in raw mode', () => {
    const ctx = makeCtx();
    const { frame } = buildFrame(ctx);
    const plain = stripAnsi(frame);
    expect(plain).not.toContain('(diff:');
  });
});
