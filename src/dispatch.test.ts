import { describe, expect, it } from 'vitest';
import {
  handleAnnotateKey,
  handleBrowseKey,
  handleConfirmKey,
  handleDecideKey,
  handleEditKey,
  handleGotoKey,
  handleReplyKey,
  handleSearchKey,
  handleSelectKey,
} from './dispatch.js';
import type { Key } from './keypress.js';
import type {
  AnnotationFlowState,
  DiffMeta,
  SessionState,
  ConfirmFlowState,
  DecideFlowState,
  EditFlowState,
  GotoFlowState,
  ReplyFlowState,
  SearchFlowState,
} from './state.js';
import {
  INITIAL_ANNOTATION_FLOW,
  INITIAL_CONFIRM_FLOW,
  INITIAL_DECIDE_FLOW,
  INITIAL_SEARCH_FLOW,
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
  scrollUp: false,
  scrollDown: false,
  scrollLeft: false,
  scrollRight: false,
  mouseRow: 0,
  mouseCol: 0,
};

const key = (overrides: Partial<Key>): Key => ({ ...EMPTY_KEY, ...overrides });

const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
  lineCount: 100,
  maxLineWidth: 120,
  viewportHeight: 20,
  cursorLine: 10,
  viewportOffset: 0,
  horizontalOffset: 0,
  mode: 'browse',
  annotations: [],
  expandedAnnotations: new Set(),
  focusedAnnotationId: null,
  viewMode: 'raw',
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

  it('scrollUp scrolls viewport up without moving cursor', () => {
    const state = makeState({ cursorLine: 15, viewportOffset: 10 });
    const result = handleBrowseKey(key({ scrollUp: true }), state, false);
    expect(result.state.viewportOffset).toBe(7);
    expect(result.state.cursorLine).toBe(15); // cursor stays
  });

  it('scrollDown scrolls viewport down without moving cursor', () => {
    const state = makeState({ cursorLine: 15, viewportOffset: 10 });
    const result = handleBrowseKey(key({ scrollDown: true }), state, false);
    expect(result.state.viewportOffset).toBe(13);
    expect(result.state.cursorLine).toBe(15); // cursor stays
  });

  it('scrollUp clamps cursor into viewport when it falls off-screen', () => {
    const state = makeState({ cursorLine: 20, viewportOffset: 15 });
    const result = handleBrowseKey(key({ scrollUp: true }), state, false);
    // viewport moves to 12, visible range 13..32 (1-based), cursor 20 stays
    expect(result.state.viewportOffset).toBe(12);
    expect(result.state.cursorLine).toBe(20);
  });

  it('scrollDown clamps cursor into viewport when it falls off-screen', () => {
    // viewport at 5, viewportHeight=20, visible 6..25. Cursor at 6.
    // Scroll down 3 → viewport at 8, visible 9..28. Cursor 6 < 9 → clamped to 9.
    const state = makeState({ cursorLine: 6, viewportOffset: 5 });
    const result = handleBrowseKey(key({ scrollDown: true }), state, false);
    expect(result.state.viewportOffset).toBe(8);
    expect(result.state.cursorLine).toBe(9);
  });

  it('h scrolls left (decreases horizontal offset)', () => {
    const state = makeState({ horizontalOffset: 8 });
    const result = handleBrowseKey(key({ char: 'h' }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
  });

  it('l scrolls right (increases horizontal offset)', () => {
    const state = makeState({ horizontalOffset: 0 });
    const result = handleBrowseKey(key({ char: 'l' }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
  });

  it('left arrow scrolls left', () => {
    const state = makeState({ horizontalOffset: 8 });
    const result = handleBrowseKey(key({ leftArrow: true }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
  });

  it('right arrow scrolls right', () => {
    const state = makeState({ horizontalOffset: 0 });
    const result = handleBrowseKey(key({ rightArrow: true }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
  });

  it('0 resets horizontal offset to 0', () => {
    const state = makeState({ horizontalOffset: 12 });
    const result = handleBrowseKey(key({ char: '0' }), state, false);
    expect(result.state.horizontalOffset).toBe(0);
  });

  it('horizontal scroll clamps at 0', () => {
    const state = makeState({ horizontalOffset: 2 });
    const result = handleBrowseKey(key({ char: 'h' }), state, false);
    expect(result.state.horizontalOffset).toBe(0);
  });

  it('scrollLeft (trackpad) scrolls left', () => {
    const state = makeState({ horizontalOffset: 8 });
    const result = handleBrowseKey(key({ scrollLeft: true }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
  });

  it('scrollRight (trackpad) scrolls right', () => {
    const state = makeState({ horizontalOffset: 0 });
    const result = handleBrowseKey(key({ scrollRight: true }), state, false);
    expect(result.state.horizontalOffset).toBe(4);
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

  it('a enters annotate mode with flow', () => {
    const result = handleBrowseKey(key({ char: 'a' }), makeState(), false);
    expect(result.state.mode).toBe('annotate');
    expect(result.state.annotationFlow?.step).toBe('intent');
  });

  it('q enters decide mode with flow', () => {
    const result = handleBrowseKey(key({ char: 'q' }), makeState(), false);
    expect(result.state.mode).toBe('decide');
    expect(result.state.decideFlow).toBeDefined();
  });

  it(': enters goto mode with flow', () => {
    const result = handleBrowseKey(key({ char: ':' }), makeState(), false);
    expect(result.state.mode).toBe('goto');
    expect(result.state.gotoFlow?.input).toBe('');
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
    expect(result.state.annotationFlow?.step).toBe('intent');
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

  it('a confirms selection and enters annotate mode', () => {
    const result = handleSelectKey(key({ char: 'a' }), selectState);
    expect(result.state.mode).toBe('annotate');
    expect(result.state.annotationFlow?.step).toBe('intent');
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
    expect(result.state.gotoFlow?.input).toBe('5');
  });

  it('multiple digits accumulate', () => {
    const result = handleGotoKey(key({ char: '2' }), state, { input: '4' });
    expect(result.state.gotoFlow?.input).toBe('42');
  });

  it('backspace removes last digit', () => {
    const result = handleGotoKey(key({ backspace: true }), state, { input: '42' });
    expect(result.state.gotoFlow?.input).toBe('4');
  });

  it('Enter jumps to line and clears flow', () => {
    const result = handleGotoKey(key({ return: true }), state, { input: '50' });
    expect(result.state.cursorLine).toBe(50);
    expect(result.state.mode).toBe('browse');
    expect(result.state.gotoFlow).toBeUndefined();
  });

  it('Enter with empty input returns to browse without moving', () => {
    const result = handleGotoKey(key({ return: true }), state, { input: '' });
    expect(result.state.mode).toBe('browse');
    expect(result.state.cursorLine).toBe(10);
  });

  it('Escape cancels and clears flow', () => {
    const result = handleGotoKey(key({ escape: true }), state, { input: '42' });
    expect(result.state.mode).toBe('browse');
    expect(result.state.gotoFlow).toBeUndefined();
  });

  it('non-digit char is ignored', () => {
    const result = handleGotoKey(key({ char: 'a' }), state, { input: '4' });
    expect(result.state.gotoFlow?.input).toBe('4');
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
      expect(result.state.annotationFlow?.intent).toBe('instruct');
      expect(result.state.annotationFlow?.step).toBe('category');
    });

    it('q selects question', () => {
      const result = handleAnnotateKey(key({ char: 'q' }), state, flow);
      expect(result.state.annotationFlow?.intent).toBe('question');
    });

    it('c selects comment', () => {
      const result = handleAnnotateKey(key({ char: 'c' }), state, flow);
      expect(result.state.annotationFlow?.intent).toBe('comment');
    });

    it('p selects praise', () => {
      const result = handleAnnotateKey(key({ char: 'p' }), state, flow);
      expect(result.state.annotationFlow?.intent).toBe('praise');
    });

    it('arrow down moves picker highlight', () => {
      const result = handleAnnotateKey(key({ downArrow: true }), state, flow);
      expect(result.state.annotationFlow?.picker.highlighted).toBe(1);
    });

    it('Enter confirms highlighted intent', () => {
      const result = handleAnnotateKey(key({ return: true }), state, flow);
      expect(result.state.annotationFlow?.intent).toBe('instruct'); // default highlight = 0
      expect(result.state.annotationFlow?.step).toBe('category');
    });

    it('unknown char is no-op', () => {
      const result = handleAnnotateKey(key({ char: 'z' }), state, flow);
      expect(result.state.annotationFlow?.step).toBe('intent');
    });

    it('Escape cancels → browse', () => {
      const result = handleAnnotateKey(key({ escape: true }), state, flow);
      expect(result.state.mode).toBe('browse');
      expect(result.state.annotationFlow).toBeUndefined();
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
      expect(result.state.annotationFlow?.category).toBe('bug');
      expect(result.state.annotationFlow?.step).toBe('comment');
    });

    it('Enter on default (none) skips category → advances to comment', () => {
      const result = handleAnnotateKey(key({ return: true }), state, flow);
      expect(result.state.annotationFlow?.step).toBe('comment');
      // Default highlight is (none) at index 0 — category should be undefined
      expect(result.state.annotationFlow?.category).toBeUndefined();
    });

    it('s selects security', () => {
      const result = handleAnnotateKey(key({ char: 's' }), state, flow);
      expect(result.state.annotationFlow?.category).toBe('security');
    });

    it('unknown char is no-op', () => {
      const result = handleAnnotateKey(key({ char: 'z' }), state, flow);
      expect(result.state.annotationFlow?.step).toBe('category');
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
      expect(commentText(result.state.annotationFlow)).toBe('h');
    });

    it('backspace removes last char', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ backspace: true }), state, f);
      expect(commentText(result.state.annotationFlow)).toBe('hell');
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
      expect(result.state.annotationFlow).toBeUndefined();
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
      expect(commentText(result.state.annotationFlow)).toBe('line1\n');
    });

    it('Alt+Enter inserts newline', () => {
      const f = { ...flow, comment: createBuffer('line1') };
      const result = handleAnnotateKey(key({ return: true, alt: true }), state, f);
      expect(commentText(result.state.annotationFlow)).toBe('line1\n');
    });

    it('arrow keys move cursor in textbox', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ leftArrow: true }), state, f);
      expect(result.state.annotationFlow?.comment.cursor.col).toBe(4);
    });

    it('Ctrl+A moves to line start', () => {
      const f = { ...flow, comment: createBuffer('hello') };
      const result = handleAnnotateKey(key({ ctrl: true, char: 'a' }), state, f);
      expect(result.state.annotationFlow?.comment.cursor.col).toBe(0);
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
    expect(moved.state.decideFlow?.picker.highlighted).toBe(1);
    const result = handleDecideKey(key({ return: true }), state, moved.state.decideFlow!);
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
    focusedAnnotationId: 'ann-1',
  });

  it('Tab jumps to annotation line and expands', () => {
    const state = makeState({ cursorLine: 5, annotations: [annotation] });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(10);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
  });

  it('Tab on annotation line wraps to same annotation if only one', () => {
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), stateWithExpanded, false);
    // Only one annotation — wraps to itself. Stays expanded and focused.
    expect(result.state.cursorLine).toBe(10);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
    expect(result.state.focusedAnnotationId).toBe('ann-1');
  });

  it('Tab cycles through multiple annotations without collapsing previous', () => {
    const ann2 = { ...annotation, id: 'ann-2', startLine: 20, endLine: 20 };
    const state = makeState({
      cursorLine: 10,
      annotations: [annotation, ann2],
      expandedAnnotations: new Set(['ann-1']),
      focusedAnnotationId: 'ann-1',
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(20);
    // New behavior: Tab does not collapse previously focused annotation
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
    expect(result.state.expandedAnnotations.has('ann-2')).toBe(true);
    expect(result.state.focusedAnnotationId).toBe('ann-2');
  });

  it('Tab with no annotations is no-op', () => {
    const state = makeState({ cursorLine: 5, annotations: [] });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state).toEqual(state);
  });

  it('c toggles: collapses expanded annotation on cursor line', () => {
    const result = handleBrowseKey(key({ char: 'c' }), stateWithExpanded, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(false);
  });

  it('c toggles: expands collapsed annotation on cursor line', () => {
    const result = handleBrowseKey(key({ char: 'c' }), stateWithAnn, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
  });

  it('c on unannotated line is no-op', () => {
    const state = makeState({ cursorLine: 5, annotations: [annotation] });
    const result = handleBrowseKey(key({ char: 'c' }), state, false);
    expect(result.state.expandedAnnotations.size).toBe(0);
  });

  it('C toggles all: collapses when any expanded', () => {
    const ann2 = { ...annotation, id: 'ann-2', startLine: 20, endLine: 20 };
    const state = makeState({
      cursorLine: 10,
      annotations: [annotation, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
    });
    const result = handleBrowseKey(key({ char: 'C' }), state, false);
    expect(result.state.expandedAnnotations.size).toBe(0);
  });

  it('C toggles all: expands all when none expanded', () => {
    const ann2 = { ...annotation, id: 'ann-2', startLine: 20, endLine: 20 };
    const state = makeState({
      cursorLine: 10,
      annotations: [annotation, ann2],
      expandedAnnotations: new Set(),
    });
    const result = handleBrowseKey(key({ char: 'C' }), state, false);
    expect(result.state.expandedAnnotations.size).toBe(2);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
    expect(result.state.expandedAnnotations.has('ann-2')).toBe(true);
  });

  it('r on expanded annotation enters reply mode', () => {
    const result = handleBrowseKey(key({ char: 'r' }), stateWithExpanded, false);
    expect(result.state.mode).toBe('reply');
    expect(result.state.replyFlow).toBeDefined();
    expect(result.state.replyFlow?.annotationId).toBe('ann-1');
  });

  it('r on collapsed annotation does not enter reply mode', () => {
    const result = handleBrowseKey(key({ char: 'r' }), stateWithAnn, false);
    expect(result.state.mode).toBe('browse');
    expect(result.state.replyFlow).toBeUndefined();
  });

  it('w on expanded annotation enters edit mode', () => {
    const result = handleBrowseKey(key({ char: 'w' }), stateWithExpanded, false);
    expect(result.state.mode).toBe('edit');
    expect(result.state.editFlow).toBeDefined();
    expect(result.state.editFlow?.annotationId).toBe('ann-1');
    expect(getText(result.state.editFlow!.comment)).toBe('test comment');
  });

  it('x on expanded annotation enters confirm mode', () => {
    const result = handleBrowseKey(key({ char: 'x' }), stateWithExpanded, false);
    expect(result.state.mode).toBe('confirm');
    expect(result.state.confirmFlow).toBeDefined();
    expect(result.state.confirmFlow?.annotationId).toBe('ann-1');
    // Annotation is NOT deleted yet
    expect(result.state.annotations).toHaveLength(1);
  });

  it('x on collapsed annotation does not enter confirm', () => {
    const result = handleBrowseKey(key({ char: 'x' }), stateWithAnn, false);
    expect(result.state.mode).toBe('browse');
    expect(result.state.confirmFlow).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-annotation focus scenarios
// ---------------------------------------------------------------------------

describe('handleBrowseKey — multi-annotation focus', () => {
  const ann1 = {
    id: 'ann-1',
    startLine: 5,
    endLine: 5,
    intent: 'comment',
    comment: 'first',
    source: 'user',
  } as const;
  const ann2 = {
    id: 'ann-2',
    startLine: 5,
    endLine: 5,
    intent: 'question',
    comment: 'second',
    source: 'agent',
  } as const;
  const ann3 = {
    id: 'ann-3',
    startLine: 15,
    endLine: 15,
    intent: 'instruct',
    comment: 'third',
    source: 'user',
  } as const;

  it('Tab cycles through individual annotations on the same line', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2, ann3],
      expandedAnnotations: new Set(['ann-1']),
      focusedAnnotationId: 'ann-1',
    });
    // First Tab: advances from ann-1 to ann-2 (same line)
    const result1 = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result1.state.focusedAnnotationId).toBe('ann-2');
    expect(result1.state.cursorLine).toBe(5);
    expect(result1.state.expandedAnnotations.has('ann-2')).toBe(true);

    // Second Tab: advances from ann-2 to ann-3 (different line)
    const result2 = handleBrowseKey(key({ tab: true, char: '\t' }), result1.state, false);
    expect(result2.state.focusedAnnotationId).toBe('ann-3');
    expect(result2.state.cursorLine).toBe(15);
    expect(result2.state.expandedAnnotations.has('ann-3')).toBe(true);

    // Third Tab: wraps back to ann-1
    const result3 = handleBrowseKey(key({ tab: true, char: '\t' }), result2.state, false);
    expect(result3.state.focusedAnnotationId).toBe('ann-1');
    expect(result3.state.cursorLine).toBe(5);
  });

  it('Shift+Tab cycles backward through annotations', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2, ann3],
      expandedAnnotations: new Set(['ann-1']),
      focusedAnnotationId: 'ann-1',
    });
    // Shift+Tab from ann-1 wraps to ann-3
    const result = handleBrowseKey(key({ tab: true, shift: true, char: '\t' }), state, false);
    expect(result.state.focusedAnnotationId).toBe('ann-3');
    expect(result.state.cursorLine).toBe(15);
  });

  it('r targets focused annotation, not first expanded', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
      focusedAnnotationId: 'ann-2',
    });
    const result = handleBrowseKey(key({ char: 'r' }), state, false);
    expect(result.state.mode).toBe('reply');
    expect(result.state.replyFlow?.annotationId).toBe('ann-2');
  });

  it('w targets focused annotation', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
      focusedAnnotationId: 'ann-2',
    });
    const result = handleBrowseKey(key({ char: 'w' }), state, false);
    expect(result.state.mode).toBe('edit');
    expect(result.state.editFlow?.annotationId).toBe('ann-2');
  });

  it('x targets focused annotation', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
      focusedAnnotationId: 'ann-2',
    });
    const result = handleBrowseKey(key({ char: 'x' }), state, false);
    expect(result.state.mode).toBe('confirm');
    expect(result.state.confirmFlow?.annotationId).toBe('ann-2');
  });

  it('r/w/x no-op when focusedAnnotationId is null', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
      focusedAnnotationId: null,
    });
    expect(handleBrowseKey(key({ char: 'r' }), state, false).state.mode).toBe('browse');
    expect(handleBrowseKey(key({ char: 'w' }), state, false).state.mode).toBe('browse');
    expect(handleBrowseKey(key({ char: 'x' }), state, false).state.mode).toBe('browse');
  });

  it('c toggles all on cursor line and auto-focuses first expanded', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(),
      focusedAnnotationId: null,
    });
    const result = handleBrowseKey(key({ char: 'c' }), state, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(true);
    expect(result.state.expandedAnnotations.has('ann-2')).toBe(true);
    expect(result.state.focusedAnnotationId).toBe('ann-1');
  });

  it('c collapse clears focus', () => {
    const state = makeState({
      cursorLine: 5,
      annotations: [ann1, ann2],
      expandedAnnotations: new Set(['ann-1', 'ann-2']),
      focusedAnnotationId: 'ann-1',
    });
    const result = handleBrowseKey(key({ char: 'c' }), state, false);
    expect(result.state.expandedAnnotations.has('ann-1')).toBe(false);
    expect(result.state.expandedAnnotations.has('ann-2')).toBe(false);
    expect(result.state.focusedAnnotationId).toBeNull();
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
    expect(commentText(result.state.replyFlow)).toBe('h');
  });

  it('backspace removes last char', () => {
    const result = handleReplyKey(
      key({ backspace: true }),
      state,
      { ...flow, comment: createBuffer('hi') }
    );
    expect(commentText(result.state.replyFlow)).toBe('h');
  });

  it('Enter with text adds reply and returns to browse', () => {
    const result = handleReplyKey(
      key({ return: true }),
      state,
      { ...flow, comment: createBuffer('my reply') }
    );
    expect(result.state.mode).toBe('browse');
    expect(result.state.replyFlow).toBeUndefined();
    const ann = result.state.annotations.find((a) => a.id === 'ann-1');
    expect(ann?.replies).toEqual([{ comment: 'my reply', source: 'user' }]);
  });

  it('Enter with empty text is no-op', () => {
    const result = handleReplyKey(key({ return: true }), state, flow);
    expect(result.state.mode).toBe('reply');
    expect(result.state.replyFlow).toBeDefined();
  });

  it('Escape cancels reply', () => {
    const result = handleReplyKey(key({ escape: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.state.replyFlow).toBeUndefined();
  });

  it('Shift+Enter inserts newline', () => {
    const f = { ...flow, comment: createBuffer('line1') };
    const result = handleReplyKey(key({ return: true, shift: true }), state, f);
    expect(commentText(result.state.replyFlow)).toBe('line1\n');
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
    expect(commentText(result.state.editFlow)).toBe('original comment!');
  });

  it('backspace removes last char', () => {
    const result = handleEditKey(key({ backspace: true }), state, flow);
    expect(commentText(result.state.editFlow)).toBe('original commen');
  });

  it('Enter saves edited comment and returns to browse', () => {
    const result = handleEditKey(
      key({ return: true }),
      state,
      { ...flow, comment: createBuffer('updated comment') }
    );
    expect(result.state.mode).toBe('browse');
    expect(result.state.editFlow).toBeUndefined();
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
    expect(result.state.editFlow).toBeUndefined();
    const ann = result.state.annotations.find((a) => a.id === 'ann-1');
    expect(ann?.comment).toBe('original comment');
  });
});

// ---------------------------------------------------------------------------
// handleConfirmKey
// ---------------------------------------------------------------------------

describe('handleConfirmKey', () => {
  const annotation = {
    id: 'ann-1',
    startLine: 10,
    endLine: 10,
    intent: 'comment',
    comment: 'test comment',
    source: 'agent',
  };
  const state = makeState({
    mode: 'confirm',
    annotations: [annotation],
    expandedAnnotations: new Set(['ann-1']),
  });
  const flow: ConfirmFlowState = INITIAL_CONFIRM_FLOW('ann-1');

  it('y shortcut confirms delete', () => {
    const result = handleConfirmKey(key({ char: 'y' }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.state.annotations).toEqual([]);
    expect(result.state.confirmFlow).toBeUndefined();
  });

  it('n shortcut cancels delete', () => {
    const result = handleConfirmKey(key({ char: 'n' }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.state.annotations).toHaveLength(1);
    expect(result.state.confirmFlow).toBeUndefined();
  });

  it('Enter on default (no) cancels delete', () => {
    const result = handleConfirmKey(key({ return: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.state.annotations).toHaveLength(1);
  });

  it('arrow down + Enter on yes deletes', () => {
    const moved = handleConfirmKey(key({ downArrow: true }), state, flow);
    const result = handleConfirmKey(key({ return: true }), state, moved.state.confirmFlow!);
    expect(result.state.annotations).toEqual([]);
  });

  it('Escape cancels without deleting', () => {
    const result = handleConfirmKey(key({ escape: true }), state, flow);
    expect(result.state.mode).toBe('browse');
    expect(result.state.annotations).toHaveLength(1);
    expect(result.state.confirmFlow).toBeUndefined();
  });

  it('unknown key is no-op', () => {
    const result = handleConfirmKey(key({ char: 'z' }), state, flow);
    expect(result.state.mode).toBe('confirm');
    expect(result.state.confirmFlow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleBrowseKey — search interaction
// ---------------------------------------------------------------------------

describe('handleBrowseKey — search', () => {
  it('/ enters search mode with flow', () => {
    const result = handleBrowseKey(key({ char: '/' }), makeState(), false);
    expect(result.state.mode).toBe('search');
    expect(result.state.searchFlow).toBeDefined();
  });

  it('n navigates to next match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15, 25], currentMatchIndex: 0 },
    });
    const result = handleBrowseKey(key({ char: 'n' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(1);
    expect(result.state.cursorLine).toBe(15);
  });

  it('N navigates to previous match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15, 25], currentMatchIndex: 1 },
    });
    const result = handleBrowseKey(key({ char: 'N' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(0);
    expect(result.state.cursorLine).toBe(5);
  });

  it('n wraps around from last to first match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15, 25], currentMatchIndex: 2 },
    });
    const result = handleBrowseKey(key({ char: 'n' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(0);
    expect(result.state.cursorLine).toBe(5);
  });

  it('N wraps around from first to last match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15, 25], currentMatchIndex: 0 },
    });
    const result = handleBrowseKey(key({ char: 'N' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(2);
    expect(result.state.cursorLine).toBe(25);
  });

  it('n with no active search is no-op', () => {
    const state = makeState();
    const result = handleBrowseKey(key({ char: 'n' }), state, false);
    expect(result.state).toEqual(state);
  });

  it('n with zero matches is no-op', () => {
    const state = makeState({
      search: { pattern: 'notfound', matchLines: [], currentMatchIndex: -1 },
    });
    const result = handleBrowseKey(key({ char: 'n' }), state, false);
    expect(result.state).toEqual(state);
  });

  it('Ctrl+N navigates to next match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15], currentMatchIndex: 0 },
    });
    const result = handleBrowseKey(key({ ctrl: true, char: 'n' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(1);
  });

  it('Ctrl+P navigates to previous match', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15], currentMatchIndex: 1 },
    });
    const result = handleBrowseKey(key({ ctrl: true, char: 'p' }), state, false);
    expect(result.state.search?.currentMatchIndex).toBe(0);
  });

  it('Escape clears search', () => {
    const state = makeState({
      search: { pattern: 'foo', matchLines: [5, 15], currentMatchIndex: 0 },
    });
    const result = handleBrowseKey(key({ escape: true }), state, false);
    expect(result.state.search).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleSearchKey
// ---------------------------------------------------------------------------

describe('handleSearchKey', () => {
  const sourceLines = [
    'import foo from "bar"',
    'const x = 1',
    'function foo() {}',
    'export default foo',
    'const y = 2',
  ];
  const state = makeState({ mode: 'search', lineCount: 5, cursorLine: 1 });
  const flow: SearchFlowState = { ...INITIAL_SEARCH_FLOW };

  it('typing updates input and live-previews matches', () => {
    const result = handleSearchKey(key({ char: 'f' }), state, flow, sourceLines);
    expect(getText(result.state.searchFlow!.input)).toBe('f');
    // 'f' matches lines 1, 3, 4 (foo, function, foo)
    expect(result.state.search?.matchLines).toEqual([1, 3, 4]);
  });

  it('Enter commits search and returns to browse', () => {
    const f: SearchFlowState = { input: createBuffer('foo') };
    const result = handleSearchKey(key({ return: true }), state, f, sourceLines);
    expect(result.state.mode).toBe('browse');
    expect(result.state.searchFlow).toBeUndefined();
    expect(result.state.search?.pattern).toBe('foo');
    expect(result.state.search?.matchLines).toEqual([1, 3, 4]);
  });

  it('Enter jumps cursor to first match at or after cursor', () => {
    const s = makeState({ mode: 'search', lineCount: 5, cursorLine: 2 });
    const f: SearchFlowState = { input: createBuffer('foo') };
    const result = handleSearchKey(key({ return: true }), s, f, sourceLines);
    expect(result.state.cursorLine).toBe(3); // first match at/after line 2
  });

  it('Enter with empty pattern clears search and returns to browse', () => {
    const result = handleSearchKey(key({ return: true }), state, flow, sourceLines);
    expect(result.state.mode).toBe('browse');
    expect(result.state.search).toBeUndefined();
  });

  it('Escape clears search and returns to browse', () => {
    const f: SearchFlowState = { input: createBuffer('foo') };
    const result = handleSearchKey(key({ escape: true }), state, f, sourceLines);
    expect(result.state.mode).toBe('browse');
    expect(result.state.search).toBeUndefined();
    expect(result.state.searchFlow).toBeUndefined();
  });

  it('search is case-insensitive', () => {
    const f: SearchFlowState = { input: createBuffer('FOO') };
    const result = handleSearchKey(key({ return: true }), state, f, sourceLines);
    expect(result.state.search?.matchLines).toEqual([1, 3, 4]);
  });

  it('backspace updates input and recomputes matches', () => {
    const f: SearchFlowState = { input: createBuffer('foo') };
    const result = handleSearchKey(key({ backspace: true }), state, f, sourceLines);
    expect(getText(result.state.searchFlow!.input)).toBe('fo');
    // 'fo' matches same lines: 1, 3, 4
    expect(result.state.search?.matchLines).toEqual([1, 3, 4]);
  });

  it('clearing input via backspace removes search state', () => {
    const f: SearchFlowState = { input: createBuffer('f') };
    const result = handleSearchKey(key({ backspace: true }), state, f, sourceLines);
    expect(getText(result.state.searchFlow!.input)).toBe('');
    expect(result.state.search).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleBrowseKey — diff toggle (d key)
// ---------------------------------------------------------------------------

describe('handleBrowseKey — diff toggle', () => {
  const makeDiffMeta = (visibleLines: number[]): DiffMeta => {
    const newLineToRow = new Map<number, number>();
    visibleLines.forEach((ln, i) => newLineToRow.set(ln, i));
    return { rowCount: visibleLines.length + 2, visibleLines, newLineToRow };
  };

  it('d toggles to diff mode when diffMeta exists', () => {
    const state = makeState({
      viewMode: 'raw',
      diffMeta: makeDiffMeta([3, 7, 10, 15, 20]),
    });
    const result = handleBrowseKey(key({ char: 'd' }), state, false);
    expect(result.state.viewMode).toBe('diff');
  });

  it('d toggles back to raw from diff mode', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta: makeDiffMeta([3, 7, 10, 15, 20]),
      cursorLine: 10,
    });
    const result = handleBrowseKey(key({ char: 'd' }), state, false);
    expect(result.state.viewMode).toBe('raw');
  });

  it('d is no-op without diffMeta', () => {
    const state = makeState({ viewMode: 'raw' });
    const result = handleBrowseKey(key({ char: 'd' }), state, false);
    expect(result.state.viewMode).toBe('raw');
    expect(result.state).toEqual(state);
  });

  it('d snaps cursor to nearest visible line when toggling to diff', () => {
    const state = makeState({
      viewMode: 'raw',
      diffMeta: makeDiffMeta([3, 7, 10, 15, 20]),
      cursorLine: 12,
    });
    const result = handleBrowseKey(key({ char: 'd' }), state, false);
    expect(result.state.viewMode).toBe('diff');
    expect(result.state.cursorLine).toBe(10); // nearest to 12
  });

  it('horizontal scroll keys work in diff mode', () => {
    const state = makeState({
      viewMode: 'diff',
      diffMeta: makeDiffMeta([3, 7, 10]),
      horizontalOffset: 0,
      maxLineWidth: 200,
    });
    const resultL = handleBrowseKey(key({ char: 'l' }), state, false);
    expect(resultL.state.horizontalOffset).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tab annotation navigation — edge cases (file-level, diff mode, scroll)
// ---------------------------------------------------------------------------

describe('Tab annotation navigation — edge cases', () => {
  const makeDiffMeta = (visibleLines: number[]): DiffMeta => {
    const newLineToRow = new Map<number, number>();
    visibleLines.forEach((ln, i) => newLineToRow.set(ln, i));
    return { rowCount: visibleLines.length + 2, visibleLines, newLineToRow };
  };

  const fileLevelAnn = {
    id: 'file-ann',
    startLine: 1,
    endLine: 1,
    fileLevel: true,
    intent: 'issue' as const,
    category: undefined,
    comment: 'file-level comment',
    source: 'agent' as const,
  };

  it('Tab to file-level annotation at line 1 keeps cursor visible (raw mode)', () => {
    const state = makeState({
      cursorLine: 50,
      viewportOffset: 40,
      viewportHeight: 20,
      lineCount: 100,
      annotations: [fileLevelAnn],
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(1);
    expect(result.state.focusedAnnotationId).toBe('file-ann');
    expect(result.state.expandedAnnotations.has('file-ann')).toBe(true);
    // Cursor must be within viewport
    expect(result.state.viewportOffset).toBe(0);
  });

  it('Tab to file-level annotation in diff mode where line 1 is visible', () => {
    const state = makeState({
      cursorLine: 10,
      viewportOffset: 0,
      viewportHeight: 20,
      lineCount: 100,
      viewMode: 'diff',
      diffMeta: makeDiffMeta([1, 5, 10, 15, 20]),
      annotations: [fileLevelAnn],
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(1);
    expect(result.state.focusedAnnotationId).toBe('file-ann');
    expect(result.state.expandedAnnotations.has('file-ann')).toBe(true);
  });

  it('Tab to file-level annotation in diff mode where line 1 is NOT visible snaps to nearest', () => {
    const state = makeState({
      cursorLine: 310,
      viewportOffset: 5,
      viewportHeight: 20,
      lineCount: 500,
      viewMode: 'diff',
      diffMeta: makeDiffMeta([300, 305, 310, 315, 320]),
      annotations: [fileLevelAnn],
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    // Line 1 not in diff — cursor clamps to nearest visible (300)
    expect(result.state.cursorLine).toBe(300);
    expect(result.state.focusedAnnotationId).toBe('file-ann');
    expect(result.state.expandedAnnotations.has('file-ann')).toBe(true);
    // Viewport should show the cursor
    const rowOfCursor = state.diffMeta!.newLineToRow.get(300)!;
    expect(result.state.viewportOffset).toBeLessThanOrEqual(rowOfCursor);
    expect(result.state.viewportOffset + result.state.viewportHeight).toBeGreaterThan(rowOfCursor);
  });

  it('Tab scrolls viewport to show annotation box when near bottom', () => {
    // Annotation at line 95, viewport shows 80-100, but box doesn't fit
    const ann = {
      id: 'bottom-ann',
      startLine: 90,
      endLine: 95,
      intent: 'issue' as const,
      category: undefined,
      comment: 'A comment that takes some space\nline2\nline3\nline4',
      source: 'agent' as const,
    };
    const state = makeState({
      cursorLine: 80,
      viewportOffset: 75,
      viewportHeight: 20,
      lineCount: 100,
      annotations: [ann],
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(95);
    expect(result.state.focusedAnnotationId).toBe('bottom-ann');
    // The annotation box should be within viewport bounds
    expect(result.state.viewportOffset).toBeGreaterThanOrEqual(0);
  });

  it('Tab in diff mode scrolls correctly to annotation box', () => {
    const ann = {
      id: 'diff-ann',
      startLine: 18,
      endLine: 20,
      intent: 'issue' as const,
      category: undefined,
      comment: 'diff annotation',
      source: 'agent' as const,
    };
    const diffMeta = makeDiffMeta([3, 7, 10, 15, 18, 20, 25, 30]);
    const state = makeState({
      cursorLine: 3,
      viewportOffset: 0,
      viewportHeight: 20,
      lineCount: 100,
      viewMode: 'diff',
      diffMeta,
      annotations: [ann],
    });
    const result = handleBrowseKey(key({ tab: true, char: '\t' }), state, false);
    expect(result.state.cursorLine).toBe(20);
    expect(result.state.focusedAnnotationId).toBe('diff-ann');
    expect(result.state.expandedAnnotations.has('diff-ann')).toBe(true);
  });
});
