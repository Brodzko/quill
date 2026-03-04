import { describe, expect, it } from 'vitest';
import { alignDiff, type DiffData, type DiffLineType } from './diff-align.js';

// --- Helpers ---

/** Extract just the type sequence from rows for concise assertions. */
const types = (data: DiffData): DiffLineType[] => data.rows.map((r) => r.type);

/** Extract [oldLineNumber, newLineNumber] pairs from rows. */
const lineNumbers = (data: DiffData): [number | null, number | null][] =>
  data.rows.map((r) => [r.oldLineNumber, r.newLineNumber]);

/** Extract [oldContent, newContent] pairs from rows. */
const contents = (data: DiffData): [string | null, string | null][] =>
  data.rows.map((r) => [r.oldContent, r.newContent]);

// --- Fixtures ---

const makeDiff = (hunks: string): string =>
  `diff --git a/foo.ts b/foo.ts
index abc1234..def5678 100644
--- a/foo.ts
+++ b/foo.ts
${hunks}`;

// --- Tests ---

describe('alignDiff', () => {
  describe('empty / missing diff', () => {
    it('returns empty DiffData for empty string', () => {
      const data = alignDiff('', 'test');
      expect(data.rows).toEqual([]);
      expect(data.visibleNewLines).toEqual([]);
      expect(data.label).toBe('test');
    });

    it('returns empty DiffData for whitespace-only string', () => {
      const data = alignDiff('   \n  \n', 'test');
      expect(data.rows).toEqual([]);
    });

    it('returns empty DiffData for diff with no hunks (rename/permission)', () => {
      const diff = `diff --git a/foo.ts b/bar.ts
similarity index 100%
rename from foo.ts
rename to bar.ts`;
      const data = alignDiff(diff, 'test');
      expect(data.rows).toEqual([]);
    });
  });

  describe('context-only hunk', () => {
    it('emits all context rows with paired line numbers', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
 const b = 2;
 const c = 3;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['context', 'context', 'context']);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
      ]);
      expect(contents(data)).toEqual([
        ['const a = 1;', 'const a = 1;'],
        ['const b = 2;', 'const b = 2;'],
        ['const c = 3;', 'const c = 3;'],
      ]);
    });
  });

  describe('simple addition', () => {
    it('emits context + added rows', () => {
      const diff = makeDiff(`@@ -1,2 +1,4 @@
 const a = 1;
+const b = 2;
+const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['context', 'added', 'added', 'context']);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [null, 2],
        [null, 3],
        [2, 4],
      ]);
      // Added rows have null oldContent
      expect(data.rows[1]!.oldContent).toBeNull();
      expect(data.rows[1]!.newContent).toBe('const b = 2;');
    });
  });

  describe('simple removal', () => {
    it('emits context + removed rows', () => {
      const diff = makeDiff(`@@ -1,4 +1,2 @@
 const a = 1;
-const b = 2;
-const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['context', 'removed', 'removed', 'context']);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [2, null],
        [3, null],
        [4, 2],
      ]);
      // Removed rows have null newContent
      expect(data.rows[1]!.newContent).toBeNull();
      expect(data.rows[1]!.oldContent).toBe('const b = 2;');
    });
  });

  describe('modification (paired del + add)', () => {
    it('pairs 1 del + 1 add as modified', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['context', 'modified', 'context']);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
      ]);
      expect(data.rows[1]!.oldContent).toBe('const b = 2;');
      expect(data.rows[1]!.newContent).toBe('const b = 22;');
    });

    it('pairs equal del/add counts as all modified', () => {
      const diff = makeDiff(`@@ -1,4 +1,4 @@
 const a = 1;
-const b = 2;
-const c = 3;
+const b = 22;
+const c = 33;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['context', 'modified', 'modified', 'context']);
    });
  });

  describe('asymmetric modification', () => {
    it('more dels than adds → modified + removed overflow', () => {
      const diff = makeDiff(`@@ -1,5 +1,3 @@
 const a = 1;
-const b = 2;
-const c = 3;
-const d = 4;
+const x = 99;
 const e = 5;`);
      const data = alignDiff(diff, 'main');

      // 1 add pairs with first del → modified
      // 2 remaining dels → removed
      expect(types(data)).toEqual([
        'context',
        'modified',
        'removed',
        'removed',
        'context',
      ]);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [2, 2],  // paired
        [3, null], // overflow del
        [4, null], // overflow del
        [5, 3],
      ]);
    });

    it('more adds than dels → modified + added overflow', () => {
      const diff = makeDiff(`@@ -1,3 +1,5 @@
 const a = 1;
-const b = 2;
+const x = 10;
+const y = 20;
+const z = 30;
 const c = 3;`);
      const data = alignDiff(diff, 'main');

      // 1 del pairs with first add → modified
      // 2 remaining adds → added
      expect(types(data)).toEqual([
        'context',
        'modified',
        'added',
        'added',
        'context',
      ]);
      expect(lineNumbers(data)).toEqual([
        [1, 1],
        [2, 2],    // paired
        [null, 3],  // overflow add
        [null, 4],  // overflow add
        [3, 5],
      ]);
    });
  });

  describe('multiple hunks', () => {
    it('emits hunk-header separator between hunks (not before first)', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;
@@ -10,3 +10,3 @@
 const x = 10;
-const y = 20;
+const y = 200;
 const z = 30;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual([
        'context', 'modified', 'context',
        'hunk-header',
        'context', 'modified', 'context',
      ]);

      // Hunk header row
      const header = data.rows[3]!;
      expect(header.oldLineNumber).toBeNull();
      expect(header.newLineNumber).toBeNull();
      expect(header.oldContent).toBeNull();
      expect(header.newContent).toBeNull();
      expect(header.header).toBe('@@ -10,3 +10,3 @@');
    });
  });

  describe('entirely new file (all additions)', () => {
    it('all rows are added', () => {
      const diff = makeDiff(`@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+const c = 3;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['added', 'added', 'added']);
      expect(data.rows.every((r) => r.oldLineNumber === null)).toBe(true);
      expect(data.rows.every((r) => r.oldContent === null)).toBe(true);
    });
  });

  describe('entirely deleted file (all removals)', () => {
    it('all rows are removed, no visible new lines', () => {
      const diff = makeDiff(`@@ -1,3 +0,0 @@
-const a = 1;
-const b = 2;
-const c = 3;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual(['removed', 'removed', 'removed']);
      expect(data.visibleNewLines).toEqual([]);
      expect(data.rows.every((r) => r.newLineNumber === null)).toBe(true);
    });
  });

  describe('line number mappings', () => {
    it('rowToNewLine maps correctly', () => {
      const diff = makeDiff(`@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 22;
+const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      // context(1), modified(2), added(3), context(4)
      expect(data.rowToNewLine).toEqual([1, 2, 3, 4]);
    });

    it('rowToNewLine is null for removed-only rows and hunk headers', () => {
      const diff = makeDiff(`@@ -1,4 +1,2 @@
 const a = 1;
-const b = 2;
-const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      // context(1), removed(null), removed(null), context(2)
      expect(data.rowToNewLine).toEqual([1, null, null, 2]);
    });

    it('newLineToRowIndex is consistent with rowToNewLine', () => {
      const diff = makeDiff(`@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 22;
+const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      // Every non-null entry in rowToNewLine should have a reverse mapping
      for (let i = 0; i < data.rowToNewLine.length; i++) {
        const newLine = data.rowToNewLine[i];
        if (newLine != null) {
          expect(data.newLineToRowIndex.get(newLine)).toBe(i);
        }
      }
    });

    it('visibleNewLines is sorted and matches newLineToRowIndex keys', () => {
      const diff = makeDiff(`@@ -1,5 +1,4 @@
 const a = 1;
-const b = 2;
-const c = 3;
+const x = 99;
 const d = 4;
 const e = 5;`);
      const data = alignDiff(diff, 'main');

      // Visible new lines: 1, 2 (modified), 3, 4
      expect(data.visibleNewLines).toEqual([1, 2, 3, 4]);
      expect([...data.newLineToRowIndex.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('content stripping', () => {
    it('strips +/- / space prefix from content', () => {
      const diff = makeDiff(`@@ -1,2 +1,2 @@
-  indented old;
+  indented new;`);
      const data = alignDiff(diff, 'main');

      expect(data.rows[0]!.oldContent).toBe('  indented old;');
      expect(data.rows[0]!.newContent).toBe('  indented new;');
    });
  });

  describe('label passthrough', () => {
    it('preserves the label in DiffData', () => {
      expect(alignDiff('', 'staged').label).toBe('staged');
      expect(alignDiff('', 'main~3').label).toBe('main~3');
    });
  });

  describe('complex interleaved changes', () => {
    it('handles del, del, del, add, add, normal, del, add, add', () => {
      // This is the example from PHASE_3_PLAN.md
      const diff = makeDiff(`@@ -1,7 +1,7 @@
-line1old
-line2old
-line3old
+line1new
+line2new
 unchanged
-line5old
+line5new
+line6new`);
      const data = alignDiff(diff, 'test');

      expect(types(data)).toEqual([
        'modified',  // del1 + add1
        'modified',  // del2 + add2
        'removed',   // del3 overflow
        'context',   // unchanged
        'modified',  // del5 + add5
        'added',     // add6 overflow
      ]);

      expect(lineNumbers(data)).toEqual([
        [1, 1],      // modified pair
        [2, 2],      // modified pair
        [3, null],   // removed overflow
        [4, 3],      // context
        [5, 4],      // modified pair
        [null, 5],   // added overflow
      ]);
    });
  });
});
