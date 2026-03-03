import { describe, expect, it } from 'vitest';
import type { BrowseState } from './state.js';
import {
  type RenderContext,
  VIEWPORT_CHROME_LINES,
  buildFrame,
  getViewportHeight,
} from './render.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escapes for easier assertion on visible text. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const makeCtx = (overrides: Partial<RenderContext> = {}): RenderContext => {
  const lines = overrides.lines ?? Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const state: BrowseState = overrides.state ?? {
    lineCount: lines.length,
    viewportHeight: 10,
    cursorLine: 1,
    viewportOffset: 0,
    mode: 'browse',
    annotations: [],
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
    // terminalRows - CHROME_LINES - 1 (title row)
    const vh = getViewportHeight(24);
    expect(vh).toBe(24 - VIEWPORT_CHROME_LINES - 1);
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
    const frame = buildFrame(makeCtx());
    expect(typeof frame).toBe('string');
  });

  it('contains the file path in the title', () => {
    const frame = buildFrame(makeCtx({ filePath: 'src/foo.ts' }));
    expect(frame).toContain('src/foo.ts');
  });

  it('contains the cursor line content', () => {
    const frame = buildFrame(makeCtx({ lines: ['hello world', 'second'] }));
    const plain = stripAnsi(frame);
    expect(plain).toContain('hello world');
  });

  it('shows mode in status bar', () => {
    const frame = buildFrame(makeCtx());
    const plain = stripAnsi(frame);
    expect(plain).toContain('BROWSE');
  });

  it('shows line position in status bar', () => {
    const ctx = makeCtx();
    const frame = buildFrame(ctx);
    const plain = stripAnsi(frame);
    expect(plain).toContain('ln 1/20');
  });

  it('shows cursor pointer on current line', () => {
    const frame = buildFrame(makeCtx());
    const plain = stripAnsi(frame);
    // The cursor line (1) should have a '>' pointer
    expect(plain).toContain('>');
  });

  it('pads frame to terminal rows', () => {
    const ctx = makeCtx({ terminalRows: 30 });
    const frame = buildFrame(ctx);
    const lineCount = frame.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// buildFrame — decide mode
// ---------------------------------------------------------------------------

describe('buildFrame — decide mode', () => {
  it('shows decision picker in decide mode', () => {
    const state: BrowseState = {
      lineCount: 10,
      viewportHeight: 5,
      cursorLine: 1,
      viewportOffset: 0,
      mode: 'decide',
      annotations: [],
    };
    const frame = buildFrame(makeCtx({ state }));
    const plain = stripAnsi(frame);
    expect(plain).toContain('Decision required');
    expect(plain).toContain('approve');
    expect(plain).toContain('deny');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — goto mode
// ---------------------------------------------------------------------------

describe('buildFrame — goto mode', () => {
  it('shows goto prompt when in goto mode', () => {
    const state: BrowseState = {
      lineCount: 100,
      viewportHeight: 10,
      cursorLine: 1,
      viewportOffset: 0,
      mode: 'goto',
      annotations: [],
    };
    const frame = buildFrame(
      makeCtx({ state, gotoFlow: { input: '42' } })
    );
    const plain = stripAnsi(frame);
    expect(plain).toContain('Go to line:');
    expect(plain).toContain('42');
    expect(plain).toContain('1–100');
  });
});

// ---------------------------------------------------------------------------
// buildFrame — annotation flow
// ---------------------------------------------------------------------------

describe('buildFrame — annotation flow', () => {
  it('shows annotation prompt in annotate mode', () => {
    const state: BrowseState = {
      lineCount: 10,
      viewportHeight: 5,
      cursorLine: 5,
      viewportOffset: 0,
      mode: 'annotate',
      annotations: [],
    };
    const frame = buildFrame(
      makeCtx({
        state,
        annotationFlow: { step: 'intent', comment: '' },
      })
    );
    const plain = stripAnsi(frame);
    expect(plain).toContain('Annotate line 5');
    expect(plain).toContain('Intent');
  });
});
