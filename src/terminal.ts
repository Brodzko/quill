import { openSync } from 'fs';
import { stdin } from 'process';
import { ReadStream as TtyReadStream } from 'tty';

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

const hasRawMode = (
  input: NodeJS.ReadStream | TtyReadStream
): input is (NodeJS.ReadStream | TtyReadStream) & {
  setRawMode: (mode: boolean) => void;
} => {
  return 'setRawMode' in input && typeof input.setRawMode === 'function';
};

export const cleanupTerminal = (
  input: NodeJS.ReadStream | TtyReadStream
): void => {
  if (hasRawMode(input)) {
    input.setRawMode(false);
  }
};
