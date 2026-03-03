#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { stderr, stdout } from 'process';
import * as R from 'remeda';
import { defineCommand, runMain } from 'citty';
import { type BundledTheme, DEFAULT_THEME, highlightCode } from './highlight.js';
import { parseKeypress } from './keypress.js';
import {
  type AnnotationFlowState,
  type GotoFlowState,
  type RenderContext,
  INITIAL_ANNOTATION_FLOW,
  INITIAL_GOTO_FLOW,
  buildFrame,
  getViewportHeight,
} from './render.js';
import {
  CATEGORY_BY_KEY,
  INTENT_BY_KEY,
  type KnownCategory,
  type KnownIntent,
  type SessionResult,
  createOutput,
  normalizeInputAnnotations,
  tryParseInputEnvelope,
} from './schema.js';
import {
  type BrowseState,
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
      stderr.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}`);

      // --- State + render loop ---
      let state = initialState;
      let annotationFlow: AnnotationFlowState | undefined;
      let gotoFlow: GotoFlowState | undefined;

      // gg detection: first `g` sets a 300ms timer; second `g` within window
      // triggers jump-to-top. Timer expiry is a no-op (no single-g action).
      let gPending = false;
      let gTimer: ReturnType<typeof setTimeout> | undefined;

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
        };

        stderr.write(`${CURSOR_HOME}${buildFrame(ctx)}`);
      };

      const finish = (result: SessionResult): void => {
        input.setRawMode(false);
        input.pause();
        stderr.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
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
      input.on('data', (data: string | Buffer) => {
        const key = parseKeypress(data);

        // --- Global: Ctrl+C ---
        if (key.ctrl && key.char === 'c') {
          finish({ type: 'abort' });
          return;
        }

        // --- Annotate mode ---
        if (state.mode === 'annotate' && annotationFlow) {
          if (key.escape) {
            annotationFlow = undefined;
            state = reduce(state, { type: 'set_mode', mode: 'browse' });
            paint();
            return;
          }

          if (annotationFlow.step === 'intent') {
            const matched =
              INTENT_BY_KEY[key.char as keyof typeof INTENT_BY_KEY];
            if (matched) {
              annotationFlow = {
                ...annotationFlow,
                step: 'category',
                intent: matched,
              };
            }
            paint();
            return;
          }

          if (annotationFlow.step === 'category') {
            if (key.return) {
              annotationFlow = { ...annotationFlow, step: 'comment' };
              paint();
              return;
            }
            const matched =
              CATEGORY_BY_KEY[key.char as keyof typeof CATEGORY_BY_KEY];
            if (matched) {
              annotationFlow = {
                ...annotationFlow,
                step: 'comment',
                category: matched,
              };
            }
            paint();
            return;
          }

          if (annotationFlow.step === 'comment') {
            if (key.return) {
              const trimmed = annotationFlow.comment.trim();
              if (
                trimmed.length > 0 &&
                annotationFlow.intent
              ) {
                state = reduce(state, {
                  type: 'add_annotation',
                  annotation: {
                    id: randomUUID(),
                    startLine: state.cursorLine,
                    endLine: state.cursorLine,
                    intent: annotationFlow.intent as KnownIntent,
                    category: annotationFlow.category as
                      | KnownCategory
                      | undefined,
                    comment: trimmed,
                    source: 'user',
                  },
                });
                annotationFlow = undefined;
                state = reduce(state, { type: 'set_mode', mode: 'browse' });
              }
              paint();
              return;
            }
            if (key.backspace) {
              annotationFlow = {
                ...annotationFlow,
                comment: annotationFlow.comment.slice(0, -1),
              };
              paint();
              return;
            }
            if (key.char && !key.ctrl) {
              annotationFlow = {
                ...annotationFlow,
                comment: annotationFlow.comment + key.char,
              };
            }
            paint();
            return;
          }

          return;
        }

        // --- Goto mode ---
        if (state.mode === 'goto' && gotoFlow) {
          if (key.escape) {
            gotoFlow = undefined;
            state = reduce(state, { type: 'set_mode', mode: 'browse' });
            paint();
            return;
          }
          if (key.return) {
            const target = parseInt(gotoFlow.input, 10);
            gotoFlow = undefined;
            state = reduce(state, { type: 'set_mode', mode: 'browse' });
            if (!Number.isNaN(target) && target > 0) {
              state = reduce(state, { type: 'set_cursor', line: target });
            }
            paint();
            return;
          }
          if (key.backspace) {
            gotoFlow = { input: gotoFlow.input.slice(0, -1) };
            paint();
            return;
          }
          // Accept digit characters only
          if (key.char >= '0' && key.char <= '9') {
            gotoFlow = { input: gotoFlow.input + key.char };
            paint();
            return;
          }
          // Ignore anything else in goto mode
          return;
        }

        // --- Browse mode ---
        if (state.mode === 'browse') {
          // Single-line movement
          if (key.char === 'k' || key.upArrow) {
            state = reduce(state, { type: 'move_cursor', delta: -1 });
            paint();
            return;
          }
          if (key.char === 'j' || key.downArrow) {
            state = reduce(state, { type: 'move_cursor', delta: 1 });
            paint();
            return;
          }

          // Half-page scroll: PgUp / Ctrl+U, PgDn / Ctrl+D
          if (key.pageUp || (key.ctrl && key.char === 'u')) {
            const halfPage = Math.max(1, Math.floor(state.viewportHeight / 2));
            state = reduce(state, { type: 'move_cursor', delta: -halfPage });
            paint();
            return;
          }
          if (key.pageDown || (key.ctrl && key.char === 'd')) {
            const halfPage = Math.max(1, Math.floor(state.viewportHeight / 2));
            state = reduce(state, { type: 'move_cursor', delta: halfPage });
            paint();
            return;
          }

          // Jump to top: Home key or gg (two-key sequence)
          if (key.home) {
            state = reduce(state, { type: 'set_cursor', line: 1 });
            paint();
            return;
          }

          // Jump to bottom: End key or G
          if (key.end) {
            state = reduce(state, {
              type: 'set_cursor',
              line: state.lineCount,
            });
            paint();
            return;
          }

          // gg — two-key sequence with 300ms timeout
          if (key.char === 'g') {
            if (gPending) {
              // Second g within window → jump to top
              clearTimeout(gTimer);
              gPending = false;
              gTimer = undefined;
              state = reduce(state, { type: 'set_cursor', line: 1 });
              paint();
            } else {
              // First g — start timer
              gPending = true;
              gTimer = setTimeout(() => {
                gPending = false;
                gTimer = undefined;
              }, 300);
            }
            return;
          }

          // G — jump to bottom
          if (key.char === 'G') {
            state = reduce(state, {
              type: 'set_cursor',
              line: state.lineCount,
            });
            paint();
            return;
          }

          // Goto line: `:` or Ctrl+G
          if (key.char === ':' || (key.ctrl && key.char === 'g')) {
            gotoFlow = { ...INITIAL_GOTO_FLOW };
            state = reduce(state, { type: 'set_mode', mode: 'goto' });
            paint();
            return;
          }

          // Annotate
          if (key.char === 'n') {
            annotationFlow = { ...INITIAL_ANNOTATION_FLOW };
            state = reduce(state, { type: 'set_mode', mode: 'annotate' });
            paint();
            return;
          }

          // Finish / decision picker
          if (key.char === 'q') {
            state = reduce(state, { type: 'set_mode', mode: 'decide' });
            paint();
            return;
          }
          return;
        }

        // --- Decide mode ---
        if (state.mode === 'decide') {
          if (key.char === 'a') {
            finish({
              type: 'finish',
              decision: 'approve',
              annotations: state.annotations,
            });
            return;
          }
          if (key.char === 'd') {
            finish({
              type: 'finish',
              decision: 'deny',
              annotations: state.annotations,
            });
            return;
          }
          if (key.escape) {
            state = reduce(state, { type: 'set_mode', mode: 'browse' });
            paint();
          }
        }
      });
    } catch (error) {
      // Ensure we leave alt screen on crash
      stderr.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
      const message = error instanceof Error ? error.message : 'Unknown error';
      stderr.write(`${message}\n`);
      process.exit(1);
    }
  },
});

runMain(command);
