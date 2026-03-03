#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { defineCommand, runMain } from 'citty';
import * as R from 'remeda';
import { stderr, stdout } from 'process';
import {
  createOutput,
  normalizeInputAnnotations,
  tryParseInputEnvelope,
  type Decision,
} from './schema.js';
import {
  type BrowseAction,
  type BrowseState,
  clampLine,
  computeViewportOffset,
  reduce,
} from './state.js';
import { buildFrame, getViewportHeight } from './render.js';
import {
  cleanupTerminal,
  clearScreen,
  hasRawMode,
  readSingleKey,
  readStdinIfPiped,
  resolveInteractiveInput,
  runCommentPrompt,
} from './terminal.js';
import { runInkShell } from './ink-shell.js';

const getTerminalRows = (): number => process.stderr.rows ?? 24;

const render = (params: {
  filePath: string;
  lines: string[];
  cursorLine: number;
  viewportOffset: number;
  mode: 'browse' | 'decide';
  annotations: Parameters<typeof buildFrame>[0]['annotations'];
  focusAnnotation?: string;
}): void => {
  clearScreen();
  stderr.write(
    `${buildFrame({ ...params, terminalRows: getTerminalRows() })}\n`
  );
};

const command = defineCommand({
  meta: {
    name: 'quill',
    version: '0.0.1',
    description:
      'Slice 1 — raw file review with annotation and decision output',
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
    'ink-shell': {
      type: 'boolean',
      description: 'Run experimental Ink shell for browse/decide loop',
    },
  },
  async run({ args }) {
    const filePath = args.file;
    const lineArg =
      args.line !== undefined ? Number.parseInt(args.line, 10) : undefined;
    const focusAnnotationArg = args['focus-annotation'] ?? undefined;
    const annotationsPath = args.annotations ?? undefined;
    const isInkShellEnabled = args['ink-shell'] === true;

    try {
      const pipedInput = annotationsPath ? null : await readStdinIfPiped();
      const annotationsJsonFromFile = annotationsPath
        ? readFileSync(annotationsPath, 'utf-8')
        : null;
      const envelope = tryParseInputEnvelope(
        annotationsJsonFromFile ?? pipedInput
      );

      const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);

      const initialAnnotations = normalizeInputAnnotations(envelope);

      const focusedAnnotation = focusAnnotationArg
        ? R.find(
            initialAnnotations,
            (annotation) => annotation.id === focusAnnotationArg
          )
        : undefined;

      const initialCursorLine = focusedAnnotation
        ? clampLine(focusedAnnotation.startLine, lines.length)
        : clampLine(lineArg ?? 1, lines.length);

      const initialState: BrowseState = {
        cursorLine: initialCursorLine,
        viewportOffset: computeViewportOffset({
          cursorLine: initialCursorLine,
          currentOffset: 0,
          viewportHeight: getViewportHeight('browse', getTerminalRows()),
          lineCount: lines.length,
        }),
        mode: 'browse',
        annotations: initialAnnotations,
      };

      const input = resolveInteractiveInput();

      process.on('exit', () => cleanupTerminal(input));

      if ('setEncoding' in input) {
        input.setEncoding('utf-8');
      }

      input.resume();

      // --- Ink shell path (experimental) ---
      if (isInkShellEnabled) {
        const result = await runInkShell({
          filePath,
          lines,
          initialState,
          focusAnnotation: focusAnnotationArg,
          interactiveInput: input,
        });

        clearScreen();

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
      }

      // --- Raw loop path (default) ---
      if (hasRawMode(input)) {
        input.setRawMode(true);
      }

      let state = initialState;

      const dispatch = (action: BrowseAction): void => {
        state = reduce(
          state,
          action,
          lines.length,
          getViewportHeight(state.mode, getTerminalRows())
        );
      };

      const finishWithDecision = (decision: Decision): void => {
        const output = createOutput({
          filePath,
          decision,
          annotations: state.annotations,
        });

        clearScreen();
        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        process.exit(0);
      };

      type KeyHandler = () => Promise<void> | void;

      const browseHandlers: Record<string, KeyHandler> = {
        k: () => dispatch({ type: 'move_cursor', delta: -1 }),
        '\u001B[A': () => dispatch({ type: 'move_cursor', delta: -1 }),
        j: () => dispatch({ type: 'move_cursor', delta: 1 }),
        '\u001B[B': () => dispatch({ type: 'move_cursor', delta: 1 }),
        n: async () => {
          const draft = await runCommentPrompt(input);
          if (!draft) {
            return;
          }

          dispatch({
            type: 'add_annotation',
            annotation: {
              id: randomUUID(),
              startLine: state.cursorLine,
              endLine: state.cursorLine,
              intent: draft.intent,
              category: draft.category,
              comment: draft.comment,
              source: 'user',
            },
          });
        },
        q: () => dispatch({ type: 'set_mode', mode: 'decide' }),
      };

      const decideHandlers: Record<string, KeyHandler> = {
        a: () => finishWithDecision('approve'),
        d: () => finishWithDecision('deny'),
        '\u001B': () => dispatch({ type: 'set_mode', mode: 'browse' }),
      };

      const handlersByMode: Record<string, Record<string, KeyHandler>> = {
        browse: browseHandlers,
        decide: decideHandlers,
      };

      while (true) {
        render({
          filePath,
          lines,
          focusAnnotation: focusAnnotationArg,
          ...state,
        });

        const key = await readSingleKey(input);

        if (key === '\u0003') {
          clearScreen();
          process.exit(1);
        }

        const modeHandlers = handlersByMode[state.mode];
        if (!modeHandlers) {
          continue;
        }

        const handleKey = modeHandlers[key];
        if (!handleKey) {
          continue;
        }

        await handleKey();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stderr.write(`${message}\n`);
      process.exit(1);
    }
  },
});

runMain(command);
