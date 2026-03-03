import { describe, expect, it } from 'vitest';
import {
  handleAnnotateKey,
  handleBrowseKey,
  handleDecideKey,
  handleGotoKey,
  handleSelectKey,
} from './dispatch.js';
import type { Key } from './keypress.js';
import type { AnnotationFlowState, BrowseState, GotoFlowState } from './state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_KEY: Key = {
  char: '',
  ctrl: false,
  shift: false,
  escape: false,
  return: false,
  backspace: false,
  upArrow: false,
  downArrow: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
};

const key = (overrides: Partial<Key>): Key => ({ ...EMPTY_KEY, ...overrides });

const makeState = (overrides: Partial<BrowseState> = {}): BrowseState => ({
  lineCount: 100,
  viewportHeight: 20,
  cursorLine: 10,
  viewportOffset: 0,
  mode: 'browse',
  annotations: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// handleBrowseKey
// ---------------------------------------------------------------------------

describe('handleBrowseKey', () => {
  it('j moves cursor down', () => {
    const result = handleBrowseKey(key({ char: 'j' }), makeState(), false);
    expect(result.state.cursorLine).toBe(11);
  });

  it('k moves cursor up', () => {
    const result = handleBrowseKey(key({ char: 'k' }), makeState(), false);
    expect(result.state.cursorLine).toBe(9);
  });

  it('up arrow moves cursor up', () => {
    const result = handleBrowseKey(
      key({ upArrow: true }),
      makeState(),
      false
    );
    expect(result.state.cursorLine).toBe(9);
  });

  it('down arrow moves cursor down', () => {
    const result = handleBrowseKey(
      key({ downArrow: true }),
      makeState(),
      false
    );
    expect(result.state.cursorLine).toBe(11);
  });

  it('PgUp moves by half page', () => {
    const state = makeState({ cursorLine: 20 });
    const result = handleBrowseKey(key({ pageUp: true }), state, false);
    expect(result.state.cursorLine).toBe(10); // 20 - floor(20/2) = 10
  });

  it('PgDn moves by half page', () => {
    const result = handleBrowseKey(key({ pageDown: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(20); // 10 + floor(20/2) = 20
  });

  it('Ctrl+U moves by half page up', () => {
    const state = makeState({ cursorLine: 20 });
    const result = handleBrowseKey(
      key({ ctrl: true, char: 'u' }),
      state,
      false
    );
    expect(result.state.cursorLine).toBe(10);
  });

  it('Ctrl+D moves by half page down', () => {
    const result = handleBrowseKey(
      key({ ctrl: true, char: 'd' }),
      makeState(),
      false
    );
    expect(result.state.cursorLine).toBe(20);
  });

  it('Home jumps to line 1', () => {
    const result = handleBrowseKey(key({ home: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(1);
  });

  it('End jumps to last line', () => {
    const result = handleBrowseKey(key({ end: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(100);
  });

  it('G jumps to last line', () => {
    const result = handleBrowseKey(key({ char: 'G' }), makeState(), false);
    expect(result.state.cursorLine).toBe(100);
  });

  it('first g sets gg pending', () => {
    const result = handleBrowseKey(key({ char: 'g' }), makeState(), false);
    expect(result.gg?.pending).toBe(true);
    expect(result.state.cursorLine).toBe(10); // no move yet
  });

  it('second g (gg) jumps to top', () => {
    const result = handleBrowseKey(key({ char: 'g' }), makeState(), true);
    expect(result.gg?.pending).toBe(false);
    expect(result.state.cursorLine).toBe(1);
  });

  it('v enters select mode', () => {
    const result = handleBrowseKey(key({ char: 'v' }), makeState(), false);
    expect(result.state.mode).toBe('select');
    expect(result.state.selection).toEqual({ anchor: 10, active: 10 });
  });

  it('n enters annotate mode with flow', () => {
    const result = handleBrowseKey(key({ char: 'n' }), makeState(), false);
    expect(result.state.mode).toBe('annotate');
    expect(result.annotationFlow?.step).toBe('intent');
  });

  it('q enters decide mode', () => {
    const result = handleBrowseKey(key({ char: 'q' }), makeState(), false);
    expect(result.state.mode).toBe('decide');
  });

  it(': enters goto mode with flow', () => {
    const result = handleBrowseKey(key({ char: ':' }), makeState(), false);
    expect(result.state.mode).toBe('goto');
    expect(result.gotoFlow?.input).toBe('');
  });

  it('Ctrl+G enters goto mode', () => {
    const result = handleBrowseKey(
      key({ ctrl: true, char: 'g' }),
      makeState(),
      false
    );
    expect(result.state.mode).toBe('goto');
  });

  it('Shift+Up starts selection and extends up', () => {
    const result = handleBrowseKey(
      key({ shift: true, upArrow: true }),
      makeState(),
      false
    );
    expect(result.state.mode).toBe('select');
    expect(result.state.selection?.anchor).toBe(10);
    expect(result.state.selection?.active).toBe(9);
  });

  it('Shift+Down starts selection and extends down', () => {
    const result = handleBrowseKey(
      key({ shift: true, downArrow: true }),
      makeState(),
      false
    );
    expect(result.state.mode).toBe('select');
    expect(result.state.selection?.anchor).toBe(10);
    expect(result.state.selection?.active).toBe(11);
  });

  it('unknown key is a no-op', () => {
    const state = makeState();
    const result = handleBrowseKey(key({ char: 'z' }), state, false);
    expect(result.state).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// handleSelectKey
// ---------------------------------------------------------------------------

describe('handleSelectKey', () => {
  const selectState = makeState({
    mode: 'select',
    selection: { anchor: 10, active: 10 },
  });

  it('j extends selection down', () => {
    const result = handleSelectKey(key({ char: 'j' }), selectState);
    expect(result.state.selection?.active).toBe(11);
  });

  it('k extends selection up', () => {
    const result = handleSelectKey(key({ char: 'k' }), selectState);
    expect(result.state.selection?.active).toBe(9);
  });

  it('Enter confirms → annotate with flow', () => {
    const result = handleSelectKey(key({ return: true }), selectState);
    expect(result.state.mode).toBe('annotate');
    expect(result.annotationFlow?.step).toBe('intent');
  });

  it('Escape cancels → browse, clears selection', () => {
    const result = handleSelectKey(key({ escape: true }), selectState);
    expect(result.state.mode).toBe('browse');
    expect(result.state.selection).toBeUndefined();
  });

  it('PgUp extends by half page', () => {
    const state = makeState({
      mode: 'select',
      cursorLine: 20,
      selection: { anchor: 15, active: 20 },
    });
    const result = handleSelectKey(key({ pageUp: true }), state);
    expect(result.state.selection?.active).toBe(10); // 20 - 10
  });

  it('PgDn extends by half page', () => {
    const result = handleSelectKey(key({ pageDown: true }), selectState);
    expect(result.state.selection?.active).toBe(20); // 10 + 10
  });

  it('unknown key is a no-op', () => {
    const result = handleSelectKey(key({ char: 'z' }), selectState);
    expect(result.state).toEqual(selectState);
  });
});

// ---------------------------------------------------------------------------
// handleGotoKey
// ---------------------------------------------------------------------------

describe('handleGotoKey', () => {
  const state = makeState({ mode: 'goto' });
  const flow: GotoFlowState = { input: '' };

  it('digit appends to input', () => {
    const result = handleGotoKey(key({ char: '5' }), state, flow);
    expect(result.gotoFlow?.input).toBe('5');
  });

  it('multiple digits accumulate', () => {
    const result = handleGotoKey(key({ char: '2' }), state, { input: '4' });
    expect(result.gotoFlow?.input).toBe('42');
  });

  it('backspace removes last digit', () => {
    const result = handleGotoKey(key({ backspace: true }), state, {
      input: '42',
    });
    expect(result.gotoFlow?.input).toBe('4');
  });

  it('Enter jumps to line and clears flow', () => {
    const result = handleGotoKey(key({ return: true }), state, { input: '50' });
    expect(result.state.cursorLine).toBe(50);
    expect(result.state.mode).toBe('browse');
    expect(result.gotoFlow).toBeUndefined();
  });

  it('Enter with empty input returns to browse without moving', () => {
    const result = handleGotoKey(key({ return: true }), state, { input: '' });
    expect(result.state.mode).toBe('browse');
    expect(result.state.cursorLine).toBe(10); // unchanged
  });

  it('Escape cancels and clears flow', () => {
    const result = handleGotoKey(key({ escape: true }), state, {
      input: '42',
    });
    expect(result.state.mode).toBe('browse');
    expect(result.gotoFlow).toBeUndefined();
  });

  it('non-digit char is ignored', () => {
    const result = handleGotoKey(key({ char: 'a' }), state, { input: '4' });
    expect(result.gotoFlow?.input).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// handleAnnotateKey
// ---------------------------------------------------------------------------

describe('handleAnnotateKey', () => {
  const state = makeState({ mode: 'annotate', cursorLine: 5 });

  describe('intent step', () => {
    const flow: AnnotationFlowState = { step: 'intent', comment: '' };

    it('i selects instruct → advances to category', () => {
      const result = handleAnnotateKey(key({ char: 'i' }), state, flow);
      expect(result.annotationFlow?.intent).toBe('instruct');
      expect(result.annotationFlow?.step).toBe('category');
    });

    it('q selects question', () => {
      const result = handleAnnotateKey(key({ char: 'q' }), state, flow);
      expect(result.annotationFlow?.intent).toBe('question');
    });

    it('c selects comment', () => {
      const result = handleAnnotateKey(key({ char: 'c' }), state, flow);
      expect(result.annotationFlow?.intent).toBe('comment');
    });

    it('p selects praise', () => {
      const result = handleAnnotateKey(key({ char: 'p' }), state, flow);
      expect(result.annotationFlow?.intent).toBe('praise');
    });

    it('unknown char is no-op', () => {
      const result = handleAnnotateKey(key({ char: 'z' }), state, flow);
      expect(result.annotationFlow?.step).toBe('intent');
    });

    it('Escape cancels → browse', () => {
      const result = handleAnnotateKey(key({ escape: true }), state, flow);
      expect(result.state.mode).toBe('browse');
      expect(result.annotationFlow).toBeUndefined();
    });
  });

  describe('category step', () => {
    const flow: AnnotationFlowState = {
      step: 'category',
      intent: 'comment',
      comment: '',
    };

    it('b selects bug → advances to comment', () => {
      const result = handleAnnotateKey(key({ char: 'b' }), state, flow);
      expect(result.annotationFlow?.category).toBe('bug');
      expect(result.annotationFlow?.step).toBe('comment');
    });

    it('Enter skips category → advances to comment', () => {
      const result = handleAnnotateKey(key({ return: true }), state, flow);
      expect(result.annotationFlow?.step).toBe('comment');
      expect(result.annotationFlow?.category).toBeUndefined();
    });

    it('s selects security', () => {
      const result = handleAnnotateKey(key({ char: 's' }), state, flow);
      expect(result.annotationFlow?.category).toBe('security');
    });

    it('unknown char is no-op', () => {
      const result = handleAnnotateKey(key({ char: 'z' }), state, flow);
      expect(result.annotationFlow?.step).toBe('category');
    });
  });

  describe('comment step', () => {
    const flow: AnnotationFlowState = {
      step: 'comment',
      intent: 'instruct',
      comment: '',
    };

    it('typing appends to comment', () => {
      const result = handleAnnotateKey(key({ char: 'h' }), state, flow);
      expect(result.annotationFlow?.comment).toBe('h');
    });

    it('backspace removes last char', () => {
      const f = { ...flow, comment: 'hello' };
      const result = handleAnnotateKey(key({ backspace: true }), state, f);
      expect(result.annotationFlow?.comment).toBe('hell');
    });

    it('Enter with text submits annotation', () => {
      const f = { ...flow, comment: 'fix this' };
      const result = handleAnnotateKey(key({ return: true }), state, f);
      expect(result.state.mode).toBe('browse');
      expect(result.state.annotations).toHaveLength(1);
      expect(result.state.annotations[0]?.comment).toBe('fix this');
      expect(result.state.annotations[0]?.intent).toBe('instruct');
      expect(result.state.annotations[0]?.startLine).toBe(5);
      expect(result.state.annotations[0]?.endLine).toBe(5);
      expect(result.annotationFlow).toBeUndefined();
    });

    it('Enter with selection range uses selection', () => {
      const selState = makeState({
        mode: 'annotate',
        cursorLine: 7,
        selection: { anchor: 3, active: 7 },
      });
      const f = { ...flow, comment: 'range issue' };
      const result = handleAnnotateKey(key({ return: true }), selState, f);
      expect(result.state.annotations[0]?.startLine).toBe(3);
      expect(result.state.annotations[0]?.endLine).toBe(7);
    });

    it('Enter with empty/whitespace comment is no-op', () => {
      const f = { ...flow, comment: '   ' };
      const result = handleAnnotateKey(key({ return: true }), state, f);
      expect(result.state.annotations).toHaveLength(0);
      expect(result.annotationFlow).toEqual(f);
    });

    it('Ctrl+char is ignored (no append)', () => {
      const result = handleAnnotateKey(
        key({ ctrl: true, char: 'a' }),
        state,
        flow
      );
      expect(result.annotationFlow?.comment).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// handleDecideKey
// ---------------------------------------------------------------------------

describe('handleDecideKey', () => {
  const state = makeState({ mode: 'decide' });

  it('a finishes with approve', () => {
    const result = handleDecideKey(key({ char: 'a' }), state);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('approve');
    }
  });

  it('d finishes with deny', () => {
    const result = handleDecideKey(key({ char: 'd' }), state);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('deny');
    }
  });

  it('Escape returns to browse', () => {
    const result = handleDecideKey(key({ escape: true }), state);
    expect(result.state.mode).toBe('browse');
    expect(result.exit).toBeUndefined();
  });

  it('unknown key is no-op', () => {
    const result = handleDecideKey(key({ char: 'x' }), state);
    expect(result.state.mode).toBe('decide');
    expect(result.exit).toBeUndefined();
  });
});
