/**
 * Interactive review session — the core event loop.
 *
 * Owns mutable state, paint scheduling, keypress dispatch routing,
 * gg timer, mouse click handling, and terminal lifecycle (alt screen,
 * mouse reporting, cleanup). Receives resolved inputs from the CLI
 * layer — no arg parsing or file I/O here.
 */

import { stderr, stdout } from 'process';
import {
  type DispatchResult,
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
import { parseKeypress } from './keypress.js';
import { type RenderContext, buildFrame, getViewportHeight } from './render.js';
import { type SessionResult, createOutput } from './schema.js';
import {
  type AnnotationFlowState,
  type BrowseState,
  type ConfirmFlowState,
  type DecideFlowState,
  type EditFlowState,
  type GotoFlowState,
  type ReplyFlowState,
  type SearchFlowState,
  reduce,
} from './state.js';
import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  CURSOR_HIDE,
  CURSOR_HOME,
  CURSOR_SHOW,
  MOUSE_OFF,
  MOUSE_ON,
  cleanupTerminal,
  resolveInteractiveInput,
} from './terminal.js';

// --- Session config ---

export type SessionConfig = {
  /** File path as provided by the user (used in title bar and output). */
  filePath: string;
  /** Shiki-highlighted lines (one ANSI string per source line). */
  lines: string[];
  /** Raw (unhighlighted) source lines for search matching. */
  sourceLines: string[];
  /** Initial reducer state, fully resolved by the CLI layer. */
  initialState: BrowseState;
  /** Annotation id to visually focus (e.g. from --focus-annotation). */
  focusAnnotationId?: string;
};

// --- Flow state container ---

type FlowState = {
  annotationFlow?: AnnotationFlowState;
  gotoFlow?: GotoFlowState;
  replyFlow?: ReplyFlowState;
  editFlow?: EditFlowState;
  decideFlow?: DecideFlowState;
  confirmFlow?: ConfirmFlowState;
  searchFlow?: SearchFlowState;
};

// --- Session runner ---

/**
 * Run an interactive review session. Takes ownership of the terminal
 * (alt screen, raw mode, mouse reporting) until the user finishes or aborts.
 *
 * Resolves when the session ends — never throws (handles errors internally
 * with terminal cleanup).
 */
export const runSession = (config: SessionConfig): void => {
  const { filePath, lines, sourceLines, initialState, focusAnnotationId } =
    config;

  // --- Interactive input setup ---
  const input = resolveInteractiveInput();
  if (!('setRawMode' in input) || typeof input.setRawMode !== 'function') {
    throw new Error('Cannot enable raw mode — not a TTY');
  }
  input.setRawMode(true);
  input.setEncoding('utf-8');
  input.resume();

  // --- Alternate screen buffer ---
  stderr.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}${MOUSE_ON}`);

  // --- Mutable session state ---
  let state: BrowseState = initialState;
  let flows: FlowState = {};

  // Last render metadata, used for mouse click → cursor line mapping
  let lastRowToLine: (number | undefined)[] = [];
  let lastViewportStartRow = 2;

  // --- Paint coalescing ---
  // Rapid trackpad/mouse events collapse into one repaint per event-loop tick.
  let paintScheduled = false;
  const schedulePaint = (): void => {
    if (paintScheduled) return;
    paintScheduled = true;
    setImmediate(() => {
      paintScheduled = false;
      paint();
    });
  };

  const paint = (): void => {
    const rows = stderr.rows ?? 24;
    const cols = stderr.columns ?? 80;

    // Sync viewport height on resize
    const vh = getViewportHeight(rows);
    if (vh !== state.viewportHeight) {
      state = reduce(state, { type: 'update_viewport', viewportHeight: vh });
    }

    const ctx: RenderContext = {
      filePath,
      lines,
      state,
      terminalRows: rows,
      terminalCols: cols,
      focusAnnotation: focusAnnotationId,
      ...flows,
    };

    const result = buildFrame(ctx);
    lastRowToLine = result.rowToLine;
    lastViewportStartRow = result.viewportStartRow;
    stderr.write(`${CURSOR_HOME}${result.frame}`);
  };

  // --- Session exit ---
  const finish = (result: SessionResult): void => {
    input.setRawMode(false);
    input.pause();
    stderr.write(`${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
    cleanupTerminal(input);

    if (result.type === 'abort') {
      process.exit(1);
    }

    const output = createOutput({
      filePath,
      decision: result.decision,
      annotations: result.annotations,
    });
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  };

  // --- gg two-key sequence ---
  let gPending = false;
  let gTimer: ReturnType<typeof setTimeout> | undefined;

  // --- Dispatch result application ---
  const applyResult = (result: DispatchResult): void => {
    state = result.state;

    // Merge flow states — only update fields explicitly present in the result
    if ('annotationFlow' in result) flows = { ...flows, annotationFlow: result.annotationFlow };
    if ('gotoFlow' in result) flows = { ...flows, gotoFlow: result.gotoFlow };
    if ('replyFlow' in result) flows = { ...flows, replyFlow: result.replyFlow };
    if ('editFlow' in result) flows = { ...flows, editFlow: result.editFlow };
    if ('decideFlow' in result) flows = { ...flows, decideFlow: result.decideFlow };
    if ('confirmFlow' in result) flows = { ...flows, confirmFlow: result.confirmFlow };
    if ('searchFlow' in result) flows = { ...flows, searchFlow: result.searchFlow };

    // Handle gg timer state from browse handler
    if (result.gg) {
      if (result.gg.pending) {
        gPending = true;
        gTimer = setTimeout(() => {
          gPending = false;
          gTimer = undefined;
        }, 300);
      } else {
        clearTimeout(gTimer);
        gPending = false;
        gTimer = undefined;
      }
    }

    if (result.exit) {
      finish(result.exit);
      return;
    }

    schedulePaint();
  };

  // --- Keypress routing ---
  const handleKeypress = (data: string | Buffer): void => {
    const key = parseKeypress(data);

    // Global: Ctrl+C
    if (key.ctrl && key.char === 'c') {
      finish({ type: 'abort' });
      return;
    }

    // Mouse click → set cursor to clicked line (browse/select only)
    if (key.mouseRow > 0 && (state.mode === 'browse' || state.mode === 'select')) {
      const vpRow = key.mouseRow - lastViewportStartRow;
      if (vpRow >= 0 && vpRow < lastRowToLine.length) {
        const targetLine = lastRowToLine[vpRow];
        if (targetLine !== undefined) {
          state = reduce(state, { type: 'set_cursor', line: targetLine });
          schedulePaint();
        }
      }
      return;
    }

    // Dispatch to mode-specific handler
    if (state.mode === 'search' && flows.searchFlow) {
      applyResult(handleSearchKey(key, state, flows.searchFlow, sourceLines));
    } else if (state.mode === 'confirm' && flows.confirmFlow) {
      applyResult(handleConfirmKey(key, state, flows.confirmFlow));
    } else if (state.mode === 'annotate' && flows.annotationFlow) {
      applyResult(handleAnnotateKey(key, state, flows.annotationFlow));
    } else if (state.mode === 'goto' && flows.gotoFlow) {
      applyResult(handleGotoKey(key, state, flows.gotoFlow));
    } else if (state.mode === 'reply' && flows.replyFlow) {
      applyResult(handleReplyKey(key, state, flows.replyFlow));
    } else if (state.mode === 'edit' && flows.editFlow) {
      applyResult(handleEditKey(key, state, flows.editFlow));
    } else if (state.mode === 'select') {
      applyResult(handleSelectKey(key, state));
    } else if (state.mode === 'browse') {
      applyResult(handleBrowseKey(key, state, gPending));
    } else if (state.mode === 'decide' && flows.decideFlow) {
      applyResult(handleDecideKey(key, state, flows.decideFlow));
    }
  };

  // --- Event wiring ---
  stderr.on('resize', paint);
  input.on('data', handleKeypress);

  // --- Initial paint ---
  paint();
};
