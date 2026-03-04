/**
 * Diff ingestion — resolve diff input from various sources into a raw
 * unified diff string plus optional old-file content for highlighting.
 *
 * Pure I/O module. No state, no rendering concerns.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { basename } from 'path';

/**
 * Describes where to obtain a unified diff.
 *
 * - `ref`: git diff against a named ref (branch, commit, tag)
 * - `staged`: git diff --staged (index vs HEAD)
 * - `unstaged`: git diff (working tree vs index)
 * - `file`: read a .patch / .diff file from disk
 * - `stdin`: diff content already read from stdin
 */
export type DiffSource =
  | { readonly type: 'ref'; readonly ref: string }
  | { readonly type: 'staged' }
  | { readonly type: 'unstaged' }
  | { readonly type: 'file'; readonly path: string }
  | { readonly type: 'stdin'; readonly content: string };

/**
 * Result of resolving a DiffSource — everything needed to build DiffData.
 */
export type DiffInput = {
  /** Raw unified diff string. May be empty (no differences). */
  readonly rawDiff: string;
  /** Old file content (for syntax highlighting). Null when unavailable. */
  readonly oldContent: string | null;
  /** Human-readable label for the status bar (e.g. "main", "staged"). */
  readonly label: string;
};

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Resolve a DiffSource into a DiffInput for a given file path.
 * Throws on unrecoverable git errors.
 */
export const resolveDiff = (source: DiffSource, filePath: string): DiffInput => {
  switch (source.type) {
    case 'ref': {
      const rawDiff = execGitDiff(['diff', source.ref, '--', filePath]);
      const oldContent = execGitShow(`${source.ref}:${filePath}`);
      return { rawDiff, oldContent, label: source.ref };
    }
    case 'staged': {
      const rawDiff = execGitDiff(['diff', '--staged', '--', filePath]);
      const oldContent = execGitShow(`HEAD:${filePath}`);
      return { rawDiff, oldContent, label: 'staged' };
    }
    case 'unstaged': {
      const rawDiff = execGitDiff(['diff', '--', filePath]);
      const oldContent = execGitShow(`:${filePath}`);
      return { rawDiff, oldContent, label: 'unstaged' };
    }
    case 'file':
      return {
        rawDiff: readFileSync(source.path, 'utf-8'),
        oldContent: null,
        label: basename(source.path),
      };
    case 'stdin':
      return {
        rawDiff: source.content,
        oldContent: null,
        label: 'stdin',
      };
  }
};

// --- Git helpers ---

type ExecError = Error & {
  readonly status: number | null;
  readonly stdout: unknown;
  readonly stderr: unknown;
};

const isExecError = (e: unknown): e is ExecError =>
  e instanceof Error && 'status' in e;

/**
 * Run `git <args>` and return stdout.
 * Handles git diff's exit code 1 (= has differences) as success.
 * Throws on actual errors (exit code > 1 or missing git).
 */
export const execGitDiff = (args: readonly string[]): string => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    });
  } catch (error: unknown) {
    // git diff exits 1 when there ARE differences — that's normal
    if (isExecError(error) && error.status === 1 && typeof error.stdout === 'string') {
      return error.stdout;
    }
    const msg =
      isExecError(error) && typeof error.stderr === 'string'
        ? error.stderr.trim()
        : 'git diff failed';
    throw new Error(msg);
  }
};

/**
 * Run `git show <revPath>` to retrieve file content at a ref.
 * Returns null if the file doesn't exist at that ref (instead of throwing).
 */
export const execGitShow = (revPath: string): string | null => {
  try {
    return execFileSync('git', ['show', revPath], {
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    });
  } catch {
    return null;
  }
};
