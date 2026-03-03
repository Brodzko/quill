import { describe, expect, it } from 'vitest';
import {
  handleAnnotateKey,
  handleBrowseKey,
  handleDecideKey,
  handleEditKey,
  handleGotoKey,
  handleReplyKey,
  handleSelectKey,
} from './dispatch.js';
import type { Key } from './keypress.js';
import type {
  AnnotationFlowState,
  BrowseState,
  DecideFlowState,
  EditFlowState,
  GotoFlowState,
  ReplyFlowState,
} from './state.js';
import {
  INITIAL_ANNOTATION_FLOW,
  INITIAL_DECIDE_FLOW,
} from './state.js';
import { createBuffer, getText } from './text-buffer.js';
import { createPicker, CATEGORY_OPTIONS } from './picker.js';

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
};

const key = (overrides: Partial<Key>): Key => ({ ...EMPTY_KEY, ...overrides });

const makeState = (overrides: Partial<BrowseState> = {}): BrowseState => ({
  lineCount: 100,
  viewportHeight: 20,
  cursorLine: 10,
  viewportOffset: 0,
  mode: 'browse',
  annotations: [],
  expandedAnnotations: new Set(),
  ...overrides,
});

/** Helper to get text from a flow's comment TextBuffer */
const commentText = (flow: { comment: { lines: readonly string[] } } | undefined): string =>
  flow ? flow.comment.lines.join('\n') : '';

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
    const result = handleBrowseKey(key({ upArrow: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(9);
  });

  it('down arrow moves cursor down', () => {
    const result = handleBrowseKey(key({ downArrow: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(11);
  });

  it('PgUp moves by half page', () => {
    const state = makeState({ cursorLine: 20 });
    const result = handleBrowseKey(key({ pageUp: true }), state, false);
    expect(result.state.cursorLine).toBe(10);
  });

  it('PgDn moves by half page', () => {
    const result = handleBrowseKey(key({ pageDown: true }), makeState(), false);
    expect(result.state.cursorLine).toBe(20);
  });

  it('Ctrl+U moves by half page up', () => {
    const state = makeState({ cursorLine: 20 });
    const result = handleBrowseKey(key({ ctrl: true, char: 'u' }), state, false);
    expect(result.state.cursorLine).toBe(10);
  });

  it('Ctrl+D moves by half page down', () => {
    const result = handleBrowseKey(key({ ctrl: true, char: 'd' }), makeState(), false);
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
    expect(result.state.cursorLine).toBe(10);
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

  it('q enters decide mode with flow', () => {
    const result = handleBrowseKey(key({ char: 'q' }), makeState(), false);
    expect(result.state.mode).toBe('decide');
    expect(result.decideFlow).toBeDefined();
  });

  it(': enters goto mode with flow', () => {
    const result = handleBrowseKey(key({ char: ':' }), makeState(), false);
    expect(result.state.mode).toBe('goto');
    expect(result.gotoFlow?.input).toBe('');
  });

  it('Ctrl+G enters goto mode', () => {
    const result = handleBrowseKey(key({ ctrl: true, char: 'g' }), makeState(), false);
    expect(result.state.mode).toBe('goto');
  });

  it('Shift+Up starts selection and extends up', () => {
    const result = handleBrowseKey(key({ shift: true, upArrow: true }), makeState(), false);
    expect(result.state.mode).toBe('select');
    expect(result.state.selection?.anchor).toBe(10);
    expect(result.state.selection?.active).toBe(9);
  });

  it('Shift+Down starts selection and extends down', () => {
    const result = handleBrowseKey(key({ shift: true, downArrow: true }), makeState(), false);
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
    expect(result.state.selection?.active).toBe(10);
  });

  it('PgDn extends by half page', () => {
    const result = handleSelectKey(key({ pageDown: true }), selectState);
    expect(result.state.selection?.active).toBe(20);
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
    const result = handleGotoKey(key({ backspace: true }), state, { input: '42' });
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
    expect(result.state.cursorLine).toBe(10);
  });

  it('Escape cancels and clears flow', () => {
    const result = handleGotoKey(key({ escape: true }), state, { input: '42' });
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
    const flow = { ...INITIAL_ANNOTATION_FLOW };

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

    it('arrow down moves picker highlight', () => {
      const result = handleAnnotateKey(key({ downArrow: true }), state, flow);
      expect(result.annotationFlow?.picker.highlighted).toBe(1);
    });

    it('Enter confirms highlighted intent', () => {
      const result = handleAnnotateKey(key({ return: true }), state, flow);
      expect(result.annotationFlow?.intent).toBe('instruct'); // default highlight = 0
      expect(result.annotationFlow?.step).toBe('category');
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
      comment: createBuffer(),
      picker: createPicker(CATEGORY_OPTIONS),
    };

    it('b selects bug → advances to comment', () => {
      const result = handleAnnotateKey(key({ char: 'b' }), state, flow);
      expect(result.annotationFlow?.category).toBe('bug');
      expect(result.annotationFlow?.step).toBe('comment');
    });

    it('Enter confirms highlighted or skips → advances to comment', () => {
      const result = handleAnnotateKey(key({ return: true }), state, flow);
      expect(result.annotationFlow?.step).toBe('comment');
      // Default highlight is bug (index 0)
      expect(result.annotationFlow?.category).toBe('bug');
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
      comment: createBuffer(),
      picker: createPicker([]),
    };

    it('typing appends to comment', () => {
      const result = handleAnnotateKey(key({ char: 'h' }), state, flow);
      expect(commentText(result.annotationFlow)).toBe('h');
    });

    it('backspace removes last char', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ backspace: true }), state, f);
      expect(commentText(result.annotationFlow)).toBe('hell');
    });

    it('Enter with text submits annotation', () => {
      const f = { ...flow, comment: createBuffer('fix this') };
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
      const f = { ...flow, comment: createBuffer('range issue') };
      const result = handleAnnotateKey(key({ return: true }), selState, f);
      expect(result.state.annotations[0]?.startLine).toBe(3);
      expect(result.state.annotations[0]?.endLine).toBe(7);
    });

    it('Enter with empty/whitespace comment is no-op', () => {
      const f = { ...flow, comment: createBuffer('   ') };
      const result = handleAnnotateKey(key({ return: true }), state, f);
      expect(result.state.annotations).toHaveLength(0);
    });

    it('Shift+Enter inserts newline', () => {
      const f = { ...flow, comment: createBuffer('line1') };
      const result = handleAnnotateKey(key({ return: true, shift: true }), state, f);
      expect(commentText(result.annotationFlow)).toBe('line1\n');
    });

    it('Alt+Enter inserts newline', () => {
      const f = { ...flow, comment: createBuffer('line1') };
      const result = handleAnnotateKey(key({ return: true, alt: true }), state, f);
      expect(commentText(result.annotationFlow)).toBe('line1\n');
    });

    it('arrow keys move cursor in textbox', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ leftArrow: true }), state, f);
      expect(result.annotationFlow?.comment.cursor.col).toBe(4);
    });

    it('Ctrl+A moves to line start', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ ctrl: true, char: 'a' }), state, f);
      expect(result.annotationFlow?.comment.cursor.col).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// handleDecideKey
// ---------------------------------------------------------------------------

describe('handleDecideKey', () => {
  const state = makeState({ mode: 'decide' });
  const flow: DecideFlowState = { ...INITIAL_DECIDE_FLOW };

  it('a finishes with approve', () => {
    const result = handleDecideKey(key({ char: 'a' }), state, flow);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('approve');
    }
  });

  it('d finishes with deny', () => {
    const result = handleDecideKey(key({ char: 'd' }), state, flow);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('deny');
    }
  });

  it('Enter confirms highlighted option', () => {
    const result = handleDecideKey(key({ return: true }), state, flow);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('approve'); // default highlight = 0
    }
  });

  it('arrow down + Enter selects deny', () => {
    const moved = handleDecideKey(key({ downArrow: true }), state, flow);
    expect(moved.decideFlow?.picker.highlighted).toBe(1);
    const result = handleDecideKey(key({ return: true }), state, moved.decideFlow!);
    expect(result.exit?.type).toBe('finish');
    if (result.exit?.type === 'finish') {
      expect(result.exit.decision).toBe('deny');
    }
  });

  it('Escape returns to browse', () => {
    const result = handleDecideKey(key({ escape: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.exit).toBeUndefined();
  });

  it('unknown key is no-op', () => {
    const result = handleDecideKey(key({ char: 'x' }), state, flow);
    expect(result.state.mode).toBe('decide');
    expect(result.exit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleBrowseKey — annotation interaction (Tab, r, e, x)
// ---------------------------------------------------------------------------

describe('handleBrowseKey — annotation interaction', () => {
  const annotation = {
    id: 'ann-1',
    startLine: 10,
    endLine: 10,
    intent: 'comment',
    comment: 'test comment',
    source: 'agent',
  };

  const stateWithAnn = makeState({
    cursorLine: 10,
    annotations: [annotation],
    expandedAnnotations: new Set<string>(),
  });

  const stateWithExpanded = makeState({
    cursorLine: 10,
    annotations: [annotation],
    expandedAnnotations: new Set(['ann-1']),
  });

  it('Tab toggles annotation expansion on cursor line', () => {
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), stateWithAnn, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
  });

  it('Tab collapses already-expanded annotation', () => {
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), stateWithExpanded, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(false);
  });

  it('Tab on unannotated line is no-op', () => {
    const state = makeState({ cursorLine: 5, annotations: [annotation] });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state).toEqual(state);
  });

  it('r on expanded annotation enters reply mode', () => {
    const result = handleBrowseKey(key({ char: 'r' }), stateWithExpanded, false);
    expect(result.state.mode).toBe('reply');
    expect(result.replyFlow).toBeDefined();
    expect(result.replyFlow?.annotationId).toBe('ann-1');
  });

  it('r on collapsed annotation does not enter reply mode', () => {
    const result = handleBrowseKey(key({ char: 'r' }), stateWithAnn, false);
    expect(result.state.mode).toBe('browse');
    expect(result.replyFlow).toBeUndefined();
  });

  it('e on expanded annotation enters edit mode', () => {
    const result = handleBrowseKey(key({ char: 'e' }), stateWithExpanded, false);
    expect(result.state.mode).toBe('edit');
    expect(result.editFlow).toBeDefined();
    expect(result.editFlow?.annotationId).toBe('ann-1');
    expect(getText(result.editFlow!.comment)).toBe('test comment');
  });

  it('x on expanded annotation deletes it', () => {
    const result = handleBrowseKey(key({ char: 'x' }), stateWithExpanded, false);
    expect(result.state.annotations).toEqual([]);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(false);
  });

  it('x on collapsed annotation does not delete', () => {
    const result = handleBrowseKey(key({ char: 'x' }), stateWithAnn, false);
    expect(result.state.annotations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// handleReplyKey
// ---------------------------------------------------------------------------

describe('handleReplyKey', () => {
  const annotation = {
    id: 'ann-1',
    startLine: 10,
    endLine: 10,
    intent: 'comment',
    comment: 'test',
    source: 'agent',
  };
  const state = makeState({
    mode: 'reply',
    annotations: [annotation],
    expandedAnnotations: new Set(['ann-1']),
  });
  const flow: ReplyFlowState = { annotationId: 'ann-1', comment: createBuffer() };

  it('typing appends to comment', () => {
    const result = handleReplyKey(key({ char: 'h' }), state, flow);
    expect(commentText(result.replyFlow)).toBe('h');
  });

  it('backspace removes last char', () => {
    const result = handleReplyKey(
      key({ backspace: true }),
      state,
      { ...flow, comment: createBuffer('hi') }
    );
    expect(commentText(result.replyFlow)).toBe('h');
  });

  it('Enter with text adds reply and returns to browse', () => {
    const result = handleReplyKey(
      key({ return: true }),
      state,
      { ...flow, comment: createBuffer('my reply') }
    );
    expect(result.state.mode).toBe('browse');
    expect(result.replyFlow).toBeUndefined();
    const ann = result.state.annotations.find((a) => a.id === 'ann-1');
    expect(ann?.replies).toEqual([{ comment: 'my reply', source: 'user' }]);
  });

  it('Enter with empty text is no-op', () => {
    const result = handleReplyKey(key({ return: true }), state, flow);
    expect(result.state.mode).toBe('reply');
    expect(result.replyFlow).toBeDefined();
  });

  it('Escape cancels reply', () => {
    const result = handleReplyKey(key({ escape: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.replyFlow).toBeUndefined();
  });

  it('Shift+Enter inserts newline', () => {
    const f = { ...flow, comment: createBuffer('line1') };
    const result = handleReplyKey(key({ return: true, shift: true }), state, f);
    expect(commentText(result.replyFlow)).toBe('line1\n');
  });
});

// ---------------------------------------------------------------------------
// handleEditKey
// ---------------------------------------------------------------------------

describe('handleEditKey', () => {
  const annotation = {
    id: 'ann-1',
    startLine: 10,
    endLine: 10,
    intent: 'comment',
    comment: 'original comment',
    source: 'user',
  };
  const state = makeState({
    mode: 'edit',
    annotations: [annotation],
    expandedAnnotations: new Set(['ann-1']),
  });
  const flow: EditFlowState = { annotationId: 'ann-1', comment: createBuffer('original comment') };

  it('typing appends at cursor', () => {
    const result = handleEditKey(key({ char: '!' }), state, flow);
    expect(commentText(result.editFlow)).toBe('original comment!');
  });

  it('backspace removes last char', () => {
    const result = handleEditKey(key({ backspace: true }), state, flow);
    expect(commentText(result.editFlow)).toBe('original commen');
  });

  it('Enter saves edited comment and returns to browse', () => {
    const result = handleEditKey(
      key({ return: true }),
      state,
      { ...flow, comment: createBuffer('updated comment') }
    );
    expect(result.state.mode).toBe('browse');
    expect(result.editFlow).toBeUndefined();
    const ann = result.state.annotations.find((a) => a.id === 'ann-1');
    expect(ann?.comment).toBe('updated comment');
  });

  it('Enter with empty text is no-op', () => {
    const result = handleEditKey(
      key({ return: true }),
      state,
      { ...flow, comment: createBuffer('   ') }
    );
    expect(result.state.mode).toBe('edit');
  });

  it('Escape cancels edit', () => {
    const result = handleEditKey(key({ escape: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.editFlow).toBeUndefined();
    const ann = result.state.annotations.find((a) => a.id === 'ann-1');
    expect(ann?.comment).toBe('original comment');
  });
});
