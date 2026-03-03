import { openSync } from 'fs';
import { createInterface, type Interface } from 'readline';
import { stderr, stdin } from 'process';
import { ReadStream as TtyReadStream } from 'tty';
import type { AnnotationDraft, KnownCategory } from './schema.js';
import { CATEGORY_BY_KEY, INTENT_BY_KEY } from './schema.js';

export const readStdinIfPiped = async (): Promise<string | null> => {
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

export const resolveInteractiveInput = (): NodeJS.ReadStream | TtyReadStream => {
  if (stdin.isTTY) {
    return stdin;
  }

  const ttyFd = openSync('/dev/tty', 'r');
  return new TtyReadStream(ttyFd);
};

export const hasRawMode = (
  input: NodeJS.ReadStream | TtyReadStream
): input is (NodeJS.ReadStream | TtyReadStream) & {
  setRawMode: (mode: boolean) => void;
} => {
  return 'setRawMode' in input && typeof input.setRawMode === 'function';
};

export const clearScreen = (): void => {
  stderr.write('\u001B[2J\u001B[0f');
};

export const cleanupTerminal = (
  input: NodeJS.ReadStream | TtyReadStream
): void => {
  if (hasRawMode(input)) {
    input.setRawMode(false);
  }
};

export const readSingleKey = (
  input: NodeJS.ReadStream | TtyReadStream
): Promise<string> => {
  return new Promise((resolve) => {
    const handleData = (chunk: string | Buffer): void => {
      input.off('data', handleData);
      resolve(chunk.toString('utf-8'));
    };

    input.on('data', handleData);
  });
};

const askQuestion = (rl: Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
};

export const runCommentPrompt = async (
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
        ? (CATEGORY_BY_KEY[categoryKey as keyof typeof CATEGORY_BY_KEY] as
            | KnownCategory
            | undefined)
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
