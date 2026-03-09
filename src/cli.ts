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
import {
  type BundledTheme,
  DEFAULT_THEME,
  HIGHLIGHT_LINE_LIMIT,
  highlightCode,
} from './highlight.js';

// ---------------------------------------------------------------------------
// Edge-case helpers
// ---------------------------------------------------------------------------

/** Max characters per source line — prevents OOM on minified / generated files. */
const MAX_LINE_LENGTH = 10_000;

/**
 * Detect binary content by checking for NUL bytes in the first 8 KB.
 * Returns `true` if the buffer likely contains binary data.
 */
const isBinary = (buf: Buffer): boolean => {
  const check = Math.min(buf.length, 8192);
  for (let i = 0; i < check; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
};
import { getViewportHeight } from './render.js';
import {
  normalizeInputAnnotations,
  tryParseInputEnvelope,
} from './schema.js';
import { runSession } from './session.js';
import {
  clampLine,
  clampCursor,
  computeRawViewportOffset,
  type DiffMeta,
  type SessionState,
} from './state.js';
import {
  ALT_SCREEN_OFF,
  CURSOR_SHOW,
  MOUSE_OFF,
  readStdinIfPiped,
} from './terminal.js';

// ---------------------------------------------------------------------------
// Help text — serves as the authoritative contract reference for both
// humans and agents consuming quill programmatically.
// ---------------------------------------------------------------------------

const HELP_TEXT = `\
Terminal file reviewer with structured annotations — JSON in, JSON out.

Opens a syntax-highlighted, read-only viewer. Accepts annotations as JSON
(stdin or --annotations file) and emits a JSON envelope to stdout on finish.

EXAMPLES
  quill src/app.ts                            View a file
  quill src/app.ts --diff-ref main            Diff against main branch
  quill src/app.ts --staged                   Review staged changes
  quill src/app.ts --annotations review.json  Load annotations from file
  cat input.json | quill src/app.ts           Pipe annotations via stdin

DIFF MODES
  --diff-ref <ref>   Side-by-side diff against any git ref (branch, tag, SHA).
                     Old file content is retrieved via git show <ref>:<path>.
  --staged           Diff the index (staged) vs HEAD.
  --unstaged         Diff the working tree vs the index.
  Only one diff flag may be used at a time. If no differences are found,
  quill falls back to raw mode with a notice on stderr.

INPUT CONTRACT (stdin or --annotations file)
  JSON object with an "annotations" array. Extra top-level keys are ignored.
  Malformed individual annotations are silently dropped.

  {
    "annotations": [
      {
        "id":        "<string>",          // optional — UUID generated if omitted
        "startLine": <number>,            // required, 0-indexed (0 = file-level) or 1-indexed
        "endLine":   <number>,            // required, >= startLine (0 = file-level)
        "intent":    "<string>",          // required (known: instruct, question, comment, praise)
        "category":  "<string>",          // optional (known: bug, security, performance, design, style, nitpick)
        "comment":   "<string>",          // required
        "source":    "<string>",          // optional — defaults to "agent"
        "status":    "approved"|"dismissed", // optional
        "replies": [                      // optional
          { "comment": "<string>", "source": "<string>" }
        ]
      }
    ]
  }

  Lenient parsing: startLine/endLine accept string numbers (coerced).
  source defaults to "agent". id defaults to a random UUID.
  replies[].source defaults to "user".
  File-level comments: set startLine: 0, endLine: 0. They are anchored to
  line 1 for display and emitted back with 0/0 in the output.

OUTPUT CONTRACT (stdout on finish)
  Emitted as a single JSON object when the user approves or denies.

  {
    "file":       "<string>",           // file path as provided
    "mode":       "raw"|"diff",         // which view mode was active
    "decision":   "approve"|"deny",     // user's final decision
    "diffRef":    "<string>",           // present only in diff mode
    "annotations": [                    // all annotations (created, modified, or passed through)
      {
        "id":        "<string>",
        "startLine": <number>,          // 0 for file-level comments
        "endLine":   <number>,          // 0 for file-level comments
        "intent":    "<string>",
        "category":  "<string>",        // omitted if not set
        "comment":   "<string>",
        "source":    "<string>",
        "status":    "approved"|"dismissed",  // omitted if not set
        "fileLevel": true,              // present only for file-level comments
        "replies":   [...]              // omitted if empty
      }
    ]
  }

  File-level comments (startLine: 0, endLine: 0) are emitted back with 0/0
  so consumers can distinguish them from line-anchored annotations.

ANNOTATION STATUS
  Individual annotations can be approved or dismissed inline:
    [s]  Cycle status on the focused annotation: none → approved → dismissed → none.
  The status is included in the output JSON "status" field.

EXIT CODES
  0   Normal exit (approve or deny). Output JSON written to stdout.
  1   Abort (Ctrl+C) or error. Nothing written to stdout.
      Errors are written to stderr.

EDGE CASES
  Binary files (NUL in first 8 KB)   → exit 1 with error on stderr.
  Lines > 10,000 chars               → truncated silently.
  Files > 50,000 lines               → syntax highlighting disabled (warning on stderr).
  Empty files / no trailing newline   → handled normally.
  No diff differences found           → falls back to raw mode (notice on stderr).

ENVIRONMENT
  QUILL_DEBUG   Set to any value to emit debug info to stderr on startup.`;

const command = defineCommand({
  meta: {
    name: 'quill',
    version: '0.0.1',
    description: HELP_TEXT,
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'File to review (path)',
    },
    line: {
      type: 'string',
      description: 'Start with cursor at line N (1-indexed)',
    },
    'focus-annotation': {
      type: 'string',
      description:
        'Start focused on annotation by id (falls back to --line / top)',
    },
    annotations: {
      type: 'string',
      description: 'Read annotations JSON from file path instead of stdin',
    },
    theme: {
      type: 'string',
      description:
        'Shiki theme name for syntax highlighting (default: one-dark-pro)',
    },
    'diff-ref': {
      type: 'string',
      description:
        'Diff against a git ref — branch, tag, or commit (e.g. main, HEAD~1, v1.0.0)',
    },
    staged: {
      type: 'boolean',
      description: 'Diff staged changes (index vs HEAD)',
    },
    unstaged: {
      type: 'boolean',
      description: 'Diff unstaged changes (working tree vs index)',
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

      // --- Binary detection ---
      const rawBuf = readFileSync(filePath);
      if (isBinary(rawBuf)) {
        stderr.write(`Error: ${filePath} appears to be a binary file\n`);
        process.exit(1);
      }

      const rawContent = rawBuf.toString('utf-8');
      const sourceLines = rawContent.split('\n').map((l) =>
        l.length > MAX_LINE_LENGTH ? l.slice(0, MAX_LINE_LENGTH) : l
      );

      const lineCount = sourceLines.length;

      if (lineCount > HIGHLIGHT_LINE_LIMIT) {
        stderr.write(
          `File has ${lineCount.toLocaleString()} lines — syntax highlighting disabled (limit: ${HIGHLIGHT_LINE_LIMIT.toLocaleString()})\n`
        );
      }

      const lines = await highlightCode({
        code: sourceLines.join('\n'),
        filePath,
        theme,
      });
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

      // Initial estimate — session.ts corrects on first paint via its own /dev/tty stream.
      const terminalRows = stderr.rows ?? 24;
      const initialViewportHeight = getViewportHeight(terminalRows);

      const initialExpandedAnnotations = focusedAnnotation
        ? new Set([focusedAnnotation.id])
        : new Set<string>();

      const initialViewMode = diffData ? 'diff' : 'raw';
      const initialStatePreOffset: SessionState = {
        lineCount,
        maxLineWidth,
        viewportHeight: initialViewportHeight,
        cursorLine: initialCursorLine,
        viewportOffset: 0,
        horizontalOffset: 0,
        mode: 'browse',
        annotations: initialAnnotations,
        expandedAnnotations: initialExpandedAnnotations,
        focusedAnnotationId: focusedAnnotation?.id ?? null,
        viewMode: initialViewMode,
        diffMeta,
      };
      const initialStateBase: SessionState = {
        ...initialStatePreOffset,
        viewportOffset: computeRawViewportOffset(initialStatePreOffset, initialCursorLine),
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
        diffRef: diffData?.label,
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
