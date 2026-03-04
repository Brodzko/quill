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
  type SessionState,
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
  initialState: SessionState;
  /** Immutable diff data — undefined in raw-only sessions. */
  diffData?: import('./diff-align.js').DiffData;
  /** Old-file highlighted lines — undefined when old content unavailable. */
  oldHighlightedLines?: readonly string[];
  /** Diff reference label (e.g. 'main', 'staged') — used in output JSON. */
  diffRef?: string;
};

// --- gg two-key sequence timer ---

type GgTimer = {
  readonly isPending: () => boolean;
  readonly start: () => void;
  readonly cancel: () => void;
  readonly dispose: () => void;
};

const createGgTimer = (timeoutMs = 300): GgTimer => {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    clearTimeout(timer);
    pending = false;
    timer = undefined;
  };

  return {
    isPending: () => pending,
    start: () => {
      pending = true;
      timer = setTimeout(() => {
        pending = false;
        timer = undefined;
      }, timeoutMs);
    },
    cancel,
    dispose: cancel,
  };
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
  const { filePath, lines, sourceLines, initialState, diffData, oldHighlightedLines, diffRef } = config;

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
  let state: SessionState = initialState;

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
      diffData,
      oldHighlightedLines,
    };

    const result = buildFrame(ctx);
    lastRowToLine = result.rowToLine;
    lastViewportStartRow = result.viewportStartRow;
    stderr.write(`${CURSOR_HOME}${result.frame}`);
  };

  // --- Session exit ---
  const finish = (result: SessionResult): void => {
    gg.dispose();
    input.setRawMode(false);
    input.pause();
    stderr.write(`${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
    cleanupTerminal(input);

    if (result.type === 'abort') {
      process.exit(1);
    }

    const output = createOutput({
      filePath,
      mode: state.viewMode,
      decision: result.decision,
      annotations: result.annotations,
      diffRef,
    });
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  };

  // --- gg two-key sequence ---
  const gg = createGgTimer();

  // --- Dispatch result application ---
  const applyResult = (result: DispatchResult): void => {
    state = result.state;

    // Handle gg timer state from browse handler
    if (result.gg) {
      if (result.gg.pending) {
        gg.start();
      } else {
        gg.cancel();
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
    if (state.mode === 'search' && state.searchFlow) {
      applyResult(handleSearchKey(key, state, state.searchFlow, sourceLines));
    } else if (state.mode === 'confirm' && state.confirmFlow) {
      applyResult(handleConfirmKey(key, state, state.confirmFlow));
    } else if (state.mode === 'annotate' && state.annotationFlow) {
      applyResult(handleAnnotateKey(key, state, state.annotationFlow));
    } else if (state.mode === 'goto' && state.gotoFlow) {
      applyResult(handleGotoKey(key, state, state.gotoFlow));
    } else if (state.mode === 'reply' && state.replyFlow) {
      applyResult(handleReplyKey(key, state, state.replyFlow));
    } else if (state.mode === 'edit' && state.editFlow) {
      applyResult(handleEditKey(key, state, state.editFlow));
    } else if (state.mode === 'select') {
      applyResult(handleSelectKey(key, state));
    } else if (state.mode === 'browse') {
      applyResult(handleBrowseKey(key, state, gg.isPending()));
    } else if (state.mode === 'decide' && state.decideFlow) {
      applyResult(handleDecideKey(key, state, state.decideFlow));
    }
  };

  // --- Event wiring ---
  stderr.on('resize', schedulePaint);
  input.on('data', handleKeypress);

  // --- Initial paint ---
  paint();
};
