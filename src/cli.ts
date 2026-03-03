#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { openSync, readFileSync } from 'fs';
import { createInterface, type Interface } from 'readline';
import { stderr, stdin, stdout } from 'process';
import * as R from 'remeda';
import { ReadStream as TtyReadStream } from 'tty';
import { defineCommand, runMain } from 'citty';
import { z } from 'zod';

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Decision = 'approve' | 'deny';
type Mode = 'browse' | 'decide';

type BrowseState = {
  cursorLine: number;
  viewportOffset: number;
  mode: Mode;
  annotations: Annotation[];
};

// Discriminated union of every valid state transition.
// Shape is intentionally useReducer-compatible for the Ink migration.
type BrowseAction =
  | { type: 'move_cursor'; delta: number }
  | { type: 'set_mode'; mode: Mode }
  | { type: 'add_annotation'; annotation: Annotation };
type KnownIntent = 'instruct' | 'question' | 'comment' | 'praise';
type KnownCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'design'
  | 'style'
  | 'nitpick';

type Annotation = {
  id: string;
  startLine: number;
  endLine: number;
  intent: string;
  category?: string;
  comment: string;
  source: string;
};

const annotationInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    startLine: z.coerce.number().int(),
    endLine: z.coerce.number().int(),
    intent: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    comment: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
  })
  .passthrough();

const inputEnvelopeSchema = z
  .object({
    annotations: z.array(z.unknown()).optional(),
  })
  .passthrough();

type InputEnvelope = Prettify<z.output<typeof inputEnvelopeSchema>>;

type OutputEnvelope = {
  file: string;
  mode: 'raw';
  decision: Decision;
  annotations: Annotation[];
};

type AnnotationDraft = {
  intent: KnownIntent;
  category?: KnownCategory;
  comment: string;
};

const INTENT_BY_KEY = {
  i: 'instruct',
  q: 'question',
  c: 'comment',
  p: 'praise',
} as const satisfies Record<string, KnownIntent>;

const CATEGORY_BY_KEY = {
  b: 'bug',
  s: 'security',
  f: 'performance',
  d: 'design',
  t: 'style',
  k: 'nitpick',
} as const satisfies Record<string, KnownCategory>;

const clampLine = (value: number, lineCount: number): number =>
  R.clamp(value, { min: 1, max: Math.max(1, lineCount) });

const readStdinIfPiped = async (): Promise<string | null> => {
  if (stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const payload = Buffer.concat(chunks).toString('utf-8').trim();
  return payload.length > 0 ? payload : null;
};

const normalizeCandidate = (candidate: unknown): Annotation | null => {
  const parsedCandidate = annotationInputSchema.safeParse(candidate);

  if (!parsedCandidate.success) {
    return null;
  }

  const { startLine, endLine, intent, category, comment, id, source } =
    parsedCandidate.data;

  if (startLine < 1 || endLine < startLine) {
    return null;
  }

  return {
    id: id ?? randomUUID(),
    startLine,
    endLine,
    intent,
    category,
    comment,
    source: source ?? 'agent',
  };
};

const normalizeInputAnnotations = (
  envelope: InputEnvelope | null
): Annotation[] => {
  return R.pipe(
    envelope?.annotations ?? [],
    R.map(normalizeCandidate),
    R.filter(R.isNonNullish)
  );
};

const resolveInteractiveInput = (): NodeJS.ReadStream | TtyReadStream => {
  if (stdin.isTTY) {
    return stdin;
  }

  const ttyFd = openSync('/dev/tty', 'r');
  return new TtyReadStream(ttyFd);
};

const hasRawMode = (
  input: NodeJS.ReadStream | TtyReadStream
): input is (NodeJS.ReadStream | TtyReadStream) & {
  setRawMode: (mode: boolean) => void;
} => {
  return 'setRawMode' in input && typeof input.setRawMode === 'function';
};

const SCROLL_OFF = 3;
// Fixed lines consumed by the header (title + mode/cursor + instructions + blank before body).
// Add 1 more in decide mode for the decision hint line.
const HEADER_LINES = 4;

const getViewportHeight = (mode: Mode): number => {
  const extraForDecideHint = mode === 'decide' ? 1 : 0;
  const rows = process.stderr.rows ?? 24;
  return Math.max(3, rows - HEADER_LINES - extraForDecideHint);
};

const computeViewportOffset = (params: {
  cursorLine: number;
  currentOffset: number;
  viewportHeight: number;
  lineCount: number;
}): number => {
  const { cursorLine, currentOffset, viewportHeight, lineCount } = params;
  const cursorIndex = cursorLine - 1; // 0-indexed
  const maxOffset = Math.max(0, lineCount - viewportHeight);

  if (cursorIndex < currentOffset + SCROLL_OFF) {
    return R.clamp(cursorIndex - SCROLL_OFF, { min: 0, max: maxOffset });
  }

  if (cursorIndex >= currentOffset + viewportHeight - SCROLL_OFF) {
    return R.clamp(cursorIndex - viewportHeight + SCROLL_OFF + 1, { min: 0, max: maxOffset });
  }

  return currentOffset;
};

// lineCount is passed explicitly rather than closed over so the reducer stays a
// pure function — mirrors the useReducer(reducer, init) signature for Ink migration.
const reduce = (state: BrowseState, action: BrowseAction, lineCount: number): BrowseState => {
  switch (action.type) {
    case 'move_cursor': {
      const cursorLine = clampLine(state.cursorLine + action.delta, lineCount);
      const viewportOffset = computeViewportOffset({
        cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: getViewportHeight(state.mode),
        lineCount,
      });
      return { ...state, cursorLine, viewportOffset };
    }
    case 'set_mode': {
      // Recompute viewportOffset because header height changes between modes
      // (decide mode adds the decision hint line).
      const viewportOffset = computeViewportOffset({
        cursorLine: state.cursorLine,
        currentOffset: state.viewportOffset,
        viewportHeight: getViewportHeight(action.mode),
        lineCount,
      });
      return { ...state, mode: action.mode, viewportOffset };
    }
    case 'add_annotation':
      return { ...state, annotations: [...state.annotations, action.annotation] };
  }
};

const clearScreen = (): void => {
  stderr.write('\u001B[2J\u001B[0f');
};

const cleanupTerminal = (input: NodeJS.ReadStream | TtyReadStream): void => {
  if (hasRawMode(input)) {
    input.setRawMode(false);
  }
};

const lineMarker = (params: {
  lineNumber: number;
  focusAnnotation?: string;
  annotations: Annotation[];
}): '◎' | '●' | ' ' => {
  const { lineNumber, focusAnnotation, annotations } = params;

  const hasFocus =
    typeof focusAnnotation === 'string'
      ? annotations.some(
          annotation =>
            annotation.id === focusAnnotation &&
            lineNumber >= annotation.startLine &&
            lineNumber <= annotation.endLine
        )
      : false;

  if (hasFocus) {
    return '◎';
  }

  const hasAnyAnnotation = annotations.some(
    annotation =>
      lineNumber >= annotation.startLine && lineNumber <= annotation.endLine
  );

  return hasAnyAnnotation ? '●' : ' ';
};

const render = (params: {
  filePath: string;
  lines: string[];
  cursorLine: number;
  viewportOffset: number;
  mode: Mode;
  annotations: Annotation[];
  focusAnnotation?: string;
}): void => {
  const {
    filePath,
    lines,
    cursorLine,
    viewportOffset,
    mode,
    annotations,
    focusAnnotation,
  } = params;

  const viewportHeight = getViewportHeight(mode);
  const visibleLines = lines.slice(
    viewportOffset,
    viewportOffset + viewportHeight
  );

  const body = visibleLines
    .map((line, visibleIndex) => {
      const lineNumber = viewportOffset + visibleIndex + 1;
      const pointer = lineNumber === cursorLine ? '>' : ' ';
      const marker = lineMarker({ lineNumber, focusAnnotation, annotations });
      const paddedLineNumber = String(lineNumber).padStart(4, ' ');
      return `${pointer}${paddedLineNumber} ${marker} ${line}`;
    })
    .join('\n');

  const instructionsByMode: Record<Mode, string> = {
    browse:
      '[j/k or arrows] move  [n] new annotation  [q] finish  [Ctrl+C] abort',
    decide: '[a] approve  [d] deny  [Esc] back',
  };

  const decisionHint =
    mode === 'decide' ? 'Decision required: approve (a) or deny (d).\n' : '';

  clearScreen();
  stderr.write(`Quill v0 Slice 1 — ${filePath}\n`);
  stderr.write(
    `Mode: ${mode.toUpperCase()}  Cursor: ${cursorLine}/${lines.length}  Annotations: ${annotations.length}\n`
  );
  stderr.write(`${instructionsByMode[mode]}\n`);
  stderr.write(decisionHint);
  stderr.write(`\n${body}\n`);
};

const readSingleKey = (
  input: NodeJS.ReadStream | TtyReadStream
): Promise<string> => {
  return new Promise(resolve => {
    const handleData = (chunk: string | Buffer): void => {
      input.off('data', handleData);
      resolve(chunk.toString('utf-8'));
    };

    input.on('data', handleData);
  });
};

const askQuestion = (rl: Interface, prompt: string): Promise<string> => {
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer);
    });
  });
};

const runCommentPrompt = async (
  input: NodeJS.ReadStream | TtyReadStream
): Promise<AnnotationDraft | null> => {
  if (hasRawMode(input)) {
    input.setRawMode(false);
  }

  const rl = createInterface({ input, output: stderr });

  const onSigint = (): void => {
    rl.close();
    cleanupTerminal(input);
    process.exit(1);
  };

  rl.on('SIGINT', onSigint);

  try {
    const intentKey = (await askQuestion(rl, 'Intent [i/q/c/p]: '))
      .trim()
      .toLowerCase();
    const intent = INTENT_BY_KEY[intentKey as keyof typeof INTENT_BY_KEY];
    if (!intent) {
      return null;
    }

    const categoryKey = (
      await askQuestion(rl, 'Category [b/s/f/d/t/k, Enter skip]: ')
    )
      .trim()
      .toLowerCase();
    const comment = (await askQuestion(rl, 'Comment: ')).trim();

    if (comment.length === 0) {
      return null;
    }

    return {
      intent,
      category: categoryKey
        ? CATEGORY_BY_KEY[categoryKey as keyof typeof CATEGORY_BY_KEY]
        : undefined,
      comment,
    };
  } finally {
    rl.off('SIGINT', onSigint);
    rl.close();
    if (hasRawMode(input)) {
      input.setRawMode(true);
    }
    input.resume();
  }
};

const createOutput = (params: {
  filePath: string;
  decision: Decision;
  annotations: Annotation[];
}): OutputEnvelope => {
  return {
    file: params.filePath,
    mode: 'raw',
    decision: params.decision,
    annotations: params.annotations,
  };
};

const tryParseInputEnvelope = (
  rawJson: string | null
): InputEnvelope | null => {
  if (!rawJson) {
    return null;
  }

  try {
    const parsedJson = JSON.parse(rawJson) as unknown;
    const parsedEnvelope = inputEnvelopeSchema.safeParse(parsedJson);
    return parsedEnvelope.success ? parsedEnvelope.data : null;
  } catch {
    return null;
  }
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
  },
  async run({ args }) {
    const filePath = args.file;
    const lineArg =
      args.line !== undefined ? Number.parseInt(args.line, 10) : undefined;
    const focusAnnotationArg = args['focus-annotation'] ?? undefined;
    const annotationsPath = args.annotations ?? undefined;

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
        ? R.find(initialAnnotations, annotation => annotation.id === focusAnnotationArg)
        : undefined;

      const initialCursorLine = focusedAnnotation
        ? clampLine(focusedAnnotation.startLine, lines.length)
        : clampLine(lineArg ?? 1, lines.length);

      let state: BrowseState = {
        cursorLine: initialCursorLine,
        viewportOffset: computeViewportOffset({
          cursorLine: initialCursorLine,
          currentOffset: 0,
          viewportHeight: getViewportHeight('browse'),
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

      if (hasRawMode(input)) {
        input.setRawMode(true);
      }

      input.resume();

      const dispatch = (action: BrowseAction): void => {
        state = reduce(state, action, lines.length);
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
        a: () => {
          const output = createOutput({
            filePath,
            decision: 'approve',
            annotations: state.annotations,
          });

          clearScreen();
          stdout.write(`${JSON.stringify(output, null, 2)}\n`);
          process.exit(0);
        },
        d: () => {
          const output = createOutput({
            filePath,
            decision: 'deny',
            annotations: state.annotations,
          });

          clearScreen();
          stdout.write(`${JSON.stringify(output, null, 2)}\n`);
          process.exit(0);
        },
        '\u001B': () => dispatch({ type: 'set_mode', mode: 'browse' }),
      };

      const handlersByMode: Record<Mode, Record<string, KeyHandler>> = {
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
