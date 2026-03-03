#!/usr/bin/env node
import { readFileSync } from 'fs';
import { createElement } from 'react';
import { render as renderInk } from 'ink';
import { defineCommand, runMain } from 'citty';
import * as R from 'remeda';
import { stderr, stdout } from 'process';
import {
  createOutput,
  normalizeInputAnnotations,
  tryParseInputEnvelope,
  type SessionResult,
} from './schema.js';
import {
  type BrowseState,
  clampLine,
  computeViewportOffset,
} from './state.js';
import {
  cleanupTerminal,
  readStdinIfPiped,
  resolveInteractiveInput,
} from './terminal.js';

// Ink manages stdin directly via its render config.
// We still resolve interactive input here for the piped-stdin → /dev/tty fallback.
import { App } from './components/App.js';

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
  },
  async run({ args }) {
    const filePath = args.file;
    const lineArg =
      args.line !== undefined ? Number.parseInt(args.line, 10) : undefined;
    const focusAnnotationArg = args['focus-annotation'] ?? undefined;
    const annotationsPath = args.annotations ?? undefined;

    try {
      // --- Input resolution ---
      const pipedInput = annotationsPath ? null : await readStdinIfPiped();
      const annotationsJsonFromFile = annotationsPath
        ? readFileSync(annotationsPath, 'utf-8')
        : null;
      const envelope = tryParseInputEnvelope(
        annotationsJsonFromFile ?? pipedInput
      );

      const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
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

      const initialViewportHeight = Math.max(
        3,
        (stderr.rows ?? 24) - 4
      );

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

      // --- Interactive input ---
      const input = resolveInteractiveInput();
      process.on('exit', () => cleanupTerminal(input));

      if ('setEncoding' in input) {
        input.setEncoding('utf-8');
      }
      input.resume();

      // --- Ink render ---
      const result = await new Promise<SessionResult>((resolve) => {
        let resolved = false;

        const app = renderInk(
          createElement(App, {
            filePath,
            lines,
            initialState,
            focusAnnotation: focusAnnotationArg,
            onResult: (r: SessionResult) => {
              resolved = true;
              resolve(r);
            },
          }),
          {
            stdin: input,
            stdout: stderr,
            stderr,
            exitOnCtrlC: false,
          }
        );

        void app.waitUntilExit().then(() => {
          if (!resolved) {
            resolve({ type: 'abort' });
          }
        });
      });

      // --- Output ---
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stderr.write(`${message}\n`);
      process.exit(1);
    }
  },
});

runMain(command);
