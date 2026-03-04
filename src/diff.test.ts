import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DiffSource } from './diff.js';

// Mock child_process before importing the module under test
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

import { resolveDiff, execGitDiff, execGitShow } from './diff.js';
import { execFileSync } from 'child_process';

const mockedExecFileSync = vi.mocked(execFileSync);

// --- Fixtures ---

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 22;
+const c = 3;
 const d = 4;
`;

// --- Tests ---

describe('diff', () => {
  describe('resolveDiff — file source', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'quill-diff-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads a .patch file and returns its content', () => {
      const patchPath = join(tmpDir, 'test.patch');
      writeFileSync(patchPath, SAMPLE_DIFF);

      const source: DiffSource = { type: 'file', path: patchPath };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBeNull();
      expect(result.label).toBe('test.patch');
    });

    it('throws when the file does not exist', () => {
      const source: DiffSource = { type: 'file', path: join(tmpDir, 'nope.patch') };
      expect(() => resolveDiff(source, 'src/foo.ts')).toThrow();
    });
  });

  describe('resolveDiff — stdin source', () => {
    it('returns the content string as-is', () => {
      const source: DiffSource = { type: 'stdin', content: SAMPLE_DIFF };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBeNull();
      expect(result.label).toBe('stdin');
    });

    it('handles empty stdin content', () => {
      const source: DiffSource = { type: 'stdin', content: '' };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe('');
      expect(result.label).toBe('stdin');
    });
  });

  describe('resolveDiff — git sources (mocked)', () => {
    afterEach(() => {
      mockedExecFileSync.mockReset();
    });

    it('ref: calls git diff <ref> and git show <ref>:<file>', () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === 'rev-parse') return '/repo\n';
        if (a[0] === 'diff') return SAMPLE_DIFF;
        if (a[0] === 'show') return 'const a = 1;\nconst b = 2;\nconst d = 4;\n';
        return '';
      });

      const source: DiffSource = { type: 'ref', ref: 'main' };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBe('const a = 1;\nconst b = 2;\nconst d = 4;\n');
      expect(result.label).toBe('main');
    });

    it('staged: calls git diff --staged and git show HEAD:<file>', () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === 'rev-parse') return '/repo\n';
        if (a[0] === 'diff' && a[1] === '--staged') return SAMPLE_DIFF;
        if (a[0] === 'show' && a[1] === 'HEAD:src/foo.ts') return 'old content';
        return '';
      });

      const source: DiffSource = { type: 'staged' };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBe('old content');
      expect(result.label).toBe('staged');
    });

    it('unstaged: calls git diff and git show :<file>', () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === 'rev-parse') return '/repo\n';
        if (a[0] === 'diff' && a[1] === '--') return SAMPLE_DIFF;
        if (a[0] === 'show' && a[1] === ':src/foo.ts') return 'index content';
        return '';
      });

      const source: DiffSource = { type: 'unstaged' };
      const result = resolveDiff(source, 'src/foo.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBe('index content');
      expect(result.label).toBe('unstaged');
    });

    it('returns null oldContent when git show fails (new file)', () => {
      mockedExecFileSync.mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === 'rev-parse') return '/repo\n';
        if (a[0] === 'diff') return SAMPLE_DIFF;
        if (a[0] === 'show') throw new Error('fatal: path not found');
        return '';
      });

      const source: DiffSource = { type: 'ref', ref: 'main' };
      const result = resolveDiff(source, 'src/new-file.ts');

      expect(result.rawDiff).toBe(SAMPLE_DIFF);
      expect(result.oldContent).toBeNull();
    });
  });

  describe('execGitDiff', () => {
    afterEach(() => {
      mockedExecFileSync.mockReset();
    });

    it('returns stdout on exit code 0 (no diff)', () => {
      mockedExecFileSync.mockReturnValue('');
      expect(execGitDiff(['diff', '--', 'file.ts'])).toBe('');
    });

    it('returns stdout on exit code 1 (has diff)', () => {
      const err = Object.assign(new Error('exit 1'), {
        status: 1,
        stdout: SAMPLE_DIFF,
        stderr: '',
      });
      mockedExecFileSync.mockImplementation(() => {
        throw err;
      });

      expect(execGitDiff(['diff', '--', 'file.ts'])).toBe(SAMPLE_DIFF);
    });

    it('throws on exit code > 1 (actual error)', () => {
      const err = Object.assign(new Error('exit 128'), {
        status: 128,
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
      mockedExecFileSync.mockImplementation(() => {
        throw err;
      });

      expect(() => execGitDiff(['diff', '--', 'file.ts'])).toThrow(
        'fatal: not a git repository'
      );
    });

    it('throws generic message when stderr is non-string', () => {
      const err = Object.assign(new Error('exit 128'), {
        status: 128,
        stdout: '',
        stderr: 42,
      });
      mockedExecFileSync.mockImplementation(() => {
        throw err;
      });

      expect(() => execGitDiff(['diff', '--', 'file.ts'])).toThrow(
        'git diff failed'
      );
    });
  });

  describe('execGitShow', () => {
    afterEach(() => {
      mockedExecFileSync.mockReset();
    });

    it('returns file content on success', () => {
      mockedExecFileSync.mockReturnValue('file content here');
      expect(execGitShow('main:src/foo.ts')).toBe('file content here');
    });

    it('returns null when the file does not exist at the ref', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('fatal: path not found');
      });
      expect(execGitShow('main:src/nonexistent.ts')).toBeNull();
    });
  });
});
