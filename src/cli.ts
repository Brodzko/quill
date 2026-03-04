#!/usr/bin/env node
/**
 * CLI entry point — arg parsing, input resolution, and session launch.
 *
 * Reads the file, resolves annotations (stdin or file), highlights code,
 * computes initial state, then hands off to `runSession()` for the
 * interactive terminal session.
 */

import { readFileSync } from 'fs';
import { stderr } from 'process';
import * as R from 'remeda';
import { defineCommand, runMain } from 'citty';
import { visibleLength } from './ansi.js';
import { alignDiff, type DiffData } from './diff-align.js';
import { resolveDiff } from './diff.js';
import { type BundledTheme, DEFAULT_THEME, highlightCode } from './highlight.js';
import { getViewportHeight } from './render.js';
import {
  normalizeInputAnnotations,
  tryParseInputEnvelope,
} from './schema.js';
import { runSession } from './session.js';
import {
  clampLine,
  clampCursor,
  computeViewportOffset,
  type DiffMeta,
  type SessionState,
} from './state.js';
import {
  ALT_SCREEN_OFF,
  CURSOR_SHOW,
  MOUSE_OFF,
  readStdinIfPiped,
} from './terminal.js';

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
    'diff-ref': {
      type: 'string',
      description: 'Diff against a git ref (e.g. main, HEAD~1)',
    },
    staged: {
      type: 'boolean',
      description: 'Diff staged changes',
    },
    unstaged: {
      type: 'boolean',
      description: 'Diff unstaged changes',
    },
  },
  async run({ args }) {
    const filePath = args.file;
    const lineArg =
      args.line !== undefined ? Number.parseInt(args.line, 10) : undefined;
    const focusAnnotationArg = args['focus-annotation'] ?? undefined;
    const annotationsPath = args.annotations ?? undefined;
    const theme = (args.theme as BundledTheme | undefined) ?? DEFAULT_THEME;
    const diffRef = args['diff-ref'] ?? undefined;
    const staged = args.staged ?? false;
    const unstaged = args.unstaged ?? false;

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
      const maxLineWidth = lines.reduce(
        (max, l) => Math.max(max, visibleLength(l)),
        0
      );
      const initialAnnotations = normalizeInputAnnotations(envelope);

      // --- Diff resolution ---
      let diffData: DiffData | undefined;
      let diffMeta: DiffMeta | undefined;
      let oldHighlightedLines: string[] | undefined;

      const diffFlagCount = [diffRef, staged, unstaged].filter(Boolean).length;
      if (diffFlagCount > 1) {
        throw new Error('Only one diff source allowed: --diff-ref, --staged, or --unstaged');
      }

      if (diffRef || staged || unstaged) {
        const source = diffRef
          ? { type: 'ref' as const, ref: diffRef }
          : staged
            ? { type: 'staged' as const }
            : { type: 'unstaged' as const };
        const diffInput = resolveDiff(source, filePath);
        if (diffInput.rawDiff.trim().length === 0) {
          stderr.write('No differences found — opening in raw mode\n');
        } else {
          diffData = alignDiff(diffInput.rawDiff, diffInput.label);
          diffMeta = {
            rowCount: diffData.rows.length,
            visibleLines: diffData.visibleNewLines,
            newLineToRow: diffData.newLineToRowIndex,
          };

          // Highlight old file content if available
          if (diffInput.oldContent) {
            try {
              oldHighlightedLines = await highlightCode({
                code: diffInput.oldContent,
                filePath,
                theme,
              });
            } catch {
              // Old file highlighting failed — old side renders without color
            }
          }
        }
      }

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

      const initialExpandedAnnotations = focusedAnnotation
        ? new Set([focusedAnnotation.id])
        : new Set<string>();

      const initialViewMode = diffData ? 'diff' : 'raw';
      const initialStateBase: SessionState = {
        lineCount,
        maxLineWidth,
        viewportHeight: initialViewportHeight,
        cursorLine: initialCursorLine,
        viewportOffset: computeViewportOffset({
          cursorLine: initialCursorLine,
          currentOffset: 0,
          viewportHeight: initialViewportHeight,
          lineCount,
        }),
        horizontalOffset: 0,
        mode: 'browse',
        annotations: initialAnnotations,
        expandedAnnotations: initialExpandedAnnotations,
        focusedAnnotationId: focusedAnnotation?.id ?? null,
        viewMode: initialViewMode,
        diffMeta,
      };

      // In diff mode, clamp cursor to nearest visible diff line
      const initialState: SessionState = diffMeta
        ? {
            ...initialStateBase,
            cursorLine: clampCursor(initialStateBase, initialCursorLine),
          }
        : initialStateBase;

      // --- Launch interactive session ---
      runSession({
        filePath,
        lines,
        sourceLines,
        initialState,
        diffData,
        oldHighlightedLines,
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
