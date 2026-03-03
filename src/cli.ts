#!/usr/bin/env node
import { readFileSync } from 'fs';
import { stderr, stdout } from 'process';
import * as R from 'remeda';
import { defineCommand, runMain } from 'citty';
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
import { type BundledTheme, DEFAULT_THEME, highlightCode } from './highlight.js';
import { parseKeypress } from './keypress.js';
import { type RenderContext, buildFrame, getViewportHeight } from './render.js';
import {
  type SessionResult,
  createOutput,
  normalizeInputAnnotations,
  tryParseInputEnvelope,
} from './schema.js';
import {
  type AnnotationFlowState,
  type BrowseState,
  type ConfirmFlowState,
  type DecideFlowState,
  type EditFlowState,
  type GotoFlowState,
  type ReplyFlowState,
  type SearchFlowState,
  clampLine,
  computeViewportOffset,
  reduce,
} from './state.js';
import {
  cleanupTerminal,
  readStdinIfPiped,
  resolveInteractiveInput,
} from './terminal.js';

// --- Terminal escape sequences ---

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CURSOR_HOME = '\x1b[H';
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';

const command = defineCommand({
  meta: {
    name: 'quill',
    version: '0.0.1',
    description: 'File review with structured annotations — JSON in, JSON out',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'File to review',
    },
    line: {
      type: 'string',
      description: 'Start with cursor at line N',
    },
    'focus-annotation': {
      type: 'string',
      description:
        'Start focused on annotation id (falls back to --line / top)',
    },
    annotations: {
      type: 'string',
      description: 'Read annotations JSON from file instead of stdin',
    },
    theme: {
      type: 'string',
      description:
        'Shiki theme name for syntax highlighting (default: one-dark-pro)',
    },
  },
  async run({ args }) {
    const filePath = args.file;
    const lineArg =
      args.line !== undefined ? Number.parseInt(args.line, 10) : undefined;
    const focusAnnotationArg = args['focus-annotation'] ?? undefined;
    const annotationsPath = args.annotations ?? undefined;
    const theme = (args.theme as BundledTheme | undefined) ?? DEFAULT_THEME;

    try {
      // --- Input resolution ---
      const pipedInput = annotationsPath ? null : await readStdinIfPiped();
      const annotationsJsonFromFile = annotationsPath
        ? readFileSync(annotationsPath, 'utf-8')
        : null;
      const envelope = tryParseInputEnvelope(
        annotationsJsonFromFile ?? pipedInput
      );

      const rawContent = readFileSync(filePath, 'utf-8');
      const sourceLines = rawContent.split('\n');
      const lines = await highlightCode({
        code: rawContent,
        filePath,
        theme,
      });
      const lineCount = lines.length;
      const initialAnnotations = normalizeInputAnnotations(envelope);

      const focusedAnnotation = focusAnnotationArg
        ? R.find(
            initialAnnotations,
            (annotation) => annotation.id === focusAnnotationArg
          )
        : undefined;

      const initialCursorLine = focusedAnnotation
        ? clampLine(focusedAnnotation.startLine, lineCount)
        : clampLine(lineArg ?? 1, lineCount);

      // DEBUG — remove after parity verification
      if (process.env['QUILL_DEBUG']) {
        stderr.write(
          [
            `DEBUG raw args: ${JSON.stringify(args)}`,
            `DEBUG lineArg=${lineArg} focusAnnotation=${focusAnnotationArg} annotationsPath=${annotationsPath}`,
            `DEBUG lineCount=${lineCount} initialAnnotations=${initialAnnotations.length}`,
            `DEBUG focusedAnnotation=${focusedAnnotation?.id ?? 'none'}`,
            `DEBUG initialCursorLine=${initialCursorLine}`,
            '',
          ].join('\n')
        );
      }

      const terminalRows = stderr.rows ?? 24;
      const initialViewportHeight = getViewportHeight(terminalRows);

      const initialState: BrowseState = {
        lineCount,
        viewportHeight: initialViewportHeight,
        cursorLine: initialCursorLine,
        viewportOffset: computeViewportOffset({
          cursorLine: initialCursorLine,
          currentOffset: 0,
          viewportHeight: initialViewportHeight,
          lineCount,
        }),
        mode: 'browse',
        annotations: initialAnnotations,
        expandedAnnotations: new Set(),
      };

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

      // --- State + render loop ---
      let state = initialState;
      let annotationFlow: AnnotationFlowState | undefined;
      let gotoFlow: GotoFlowState | undefined;
      let replyFlow: ReplyFlowState | undefined;
      let editFlow: EditFlowState | undefined;
      let decideFlow: DecideFlowState | undefined;
      let confirmFlow: ConfirmFlowState | undefined;
      let searchFlow: SearchFlowState | undefined;

      // Row→line mapping from last render, used for mouse click → cursor
      let lastRowToLine: (number | undefined)[] = [];

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
          focusAnnotation: focusAnnotationArg,
          annotationFlow,
          gotoFlow,
          replyFlow,
          editFlow,
          decideFlow,
          confirmFlow,
          searchFlow,
        };

        const result = buildFrame(ctx);
        lastRowToLine = result.rowToLine;
        stderr.write(`${CURSOR_HOME}${result.frame}`);
      };

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

      // Handle terminal resize
      stderr.on('resize', paint);

      // Initial paint
      paint();

      // --- Keypress dispatch ---

      // gg detection: first `g` sets a 300ms timer; second `g` within window
      // triggers jump-to-top. Timer expiry is a no-op (no single-g action).
      let gPending = false;
      let gTimer: ReturnType<typeof setTimeout> | undefined;

      const applyResult = (result: DispatchResult): void => {
        state = result.state;
        if ('annotationFlow' in result) annotationFlow = result.annotationFlow;
        if ('gotoFlow' in result) gotoFlow = result.gotoFlow;
        if ('replyFlow' in result) replyFlow = result.replyFlow;
        if ('editFlow' in result) editFlow = result.editFlow;
        if ('decideFlow' in result) decideFlow = result.decideFlow;
        if ('confirmFlow' in result) confirmFlow = result.confirmFlow;
        if ('searchFlow' in result) searchFlow = result.searchFlow;

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

        paint();
      };

      input.on('data', (data: string | Buffer) => {
        const key = parseKeypress(data);

        // Global: Ctrl+C
        if (key.ctrl && key.char === 'c') {
          finish({ type: 'abort' });
          return;
        }

        // Mouse click → set cursor to clicked line (browse/select only)
        if (key.mouseRow > 0 && (state.mode === 'browse' || state.mode === 'select')) {
          // Terminal row 1 = title, row 2+ = viewport
          const vpRow = key.mouseRow - 2; // 0-based viewport row index
          if (vpRow >= 0 && vpRow < lastRowToLine.length) {
            const targetLine = lastRowToLine[vpRow];
            if (targetLine !== undefined) {
              state = reduce(state, { type: 'set_cursor', line: targetLine });
              paint();
            }
          }
          return;
        }

        // Dispatch to mode-specific handler
        if (state.mode === 'search' && searchFlow) {
          applyResult(handleSearchKey(key, state, searchFlow, sourceLines));
        } else if (state.mode === 'confirm' && confirmFlow) {
          applyResult(handleConfirmKey(key, state, confirmFlow));
        } else if (state.mode === 'annotate' && annotationFlow) {
          applyResult(handleAnnotateKey(key, state, annotationFlow));
        } else if (state.mode === 'goto' && gotoFlow) {
          applyResult(handleGotoKey(key, state, gotoFlow));
        } else if (state.mode === 'reply' && replyFlow) {
          applyResult(handleReplyKey(key, state, replyFlow));
        } else if (state.mode === 'edit' && editFlow) {
          applyResult(handleEditKey(key, state, editFlow));
        } else if (state.mode === 'select') {
          applyResult(handleSelectKey(key, state));
        } else if (state.mode === 'browse') {
          applyResult(handleBrowseKey(key, state, gPending));
        } else if (state.mode === 'decide' && decideFlow) {
          applyResult(handleDecideKey(key, state, decideFlow));
        }
      });
    } catch (error) {
      // Ensure we leave alt screen on crash
      stderr.write(`${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
      const message = error instanceof Error ? error.message : 'Unknown error';
      stderr.write(`${message}\n`);
      process.exit(1);
    }
  },
});

runMain(command);
