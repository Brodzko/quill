import { describe, expect, it } from 'vitest';
import {
  alignDiff,
  autoExpandForLine,
  findRegionForLine,
  isLineRevealed,
  recomputeDiffMeta,
  resolveEffectiveRows,
  similarity,
  type CollapsedRegion,
  type DiffData,
  type DiffLineType,
  type RegionExpansion,
} from './diff-align.js';

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

  describe('similarity function', () => {
    it('returns 1 for identical strings', () => {
      expect(similarity('const a = 1;', 'const a = 1;')).toBe(1);
    });

    it('returns 1 for identical after trim', () => {
      expect(similarity('  const a = 1;  ', 'const a = 1;')).toBe(1);
    });

    it('returns 0 for empty vs non-empty', () => {
      expect(similarity('', 'const a = 1;')).toBe(0);
      expect(similarity('const a = 1;', '')).toBe(0);
    });

    it('returns 1 for both empty', () => {
      expect(similarity('', '')).toBe(1);
    });

    it('returns high score for genuine edits', () => {
      expect(similarity('const b = 2;', 'const b = 22;')).toBeGreaterThan(0.9);
    });

    it('returns low score for unrelated lines', () => {
      expect(similarity("import { foo } from './foo';", 'const x = calculate();')).toBeLessThan(0.2);
      expect(similarity('const b = 2;', 'function helper() {')).toBeLessThan(0.2);
    });
  });

  describe('similarity-gated pairing', () => {
    it('does not pair unrelated del/add with equal block sizes', () => {
      const diff = makeDiff(`@@ -1,5 +1,5 @@
 const a = 1;
-import { foo } from './foo';
-import { bar } from './bar';
-import { baz } from './baz';
+const x = calculate();
+const y = transform(x);
+const z = finalize(y);
 const e = 5;`);
      const data = alignDiff(diff, 'main');

      // Unrelated lines should NOT be paired — adds first, then dels
      expect(types(data)).toEqual([
        'context',
        'added', 'added', 'added',
        'removed', 'removed', 'removed',
        'context',
      ]);
    });

    it('does not pair unrelated del/add with unequal block sizes', () => {
      const diff = makeDiff(`@@ -1,4 +1,6 @@
 const a = 1;
-const b = 2;
-const c = 3;
+function helper() {
+  console.log('x');
+  console.log('y');
+  console.log('z');
+}
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      // All unrelated — adds first, then dels, no modified
      expect(types(data)).toEqual([
        'context',
        'added', 'added', 'added', 'added', 'added',
        'removed', 'removed',
        'context',
      ]);
    });

    it('pure insertion produces only added rows, no red on left', () => {
      // Simulates inserting a new function block between existing code.
      // Git should produce only '+' lines — no dels at all.
      // All added lines should be type 'added', context lines untouched.
      const diff = makeDiff(`@@ -1,4 +1,10 @@
 const a = 1;
 const b = 2;
+
+function newHelper() {
+  const x = calculate();
+  return transform(x);
+}
+
 const c = 3;
 const d = 4;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual([
        'context', 'context',
        'added', 'added', 'added', 'added', 'added', 'added',
        'context', 'context',
      ]);

      // No row should have red/left content without green/right content
      for (const row of data.rows) {
        if (row.type === 'added') {
          expect(row.oldContent).toBeNull();
          expect(row.oldLineNumber).toBeNull();
          expect(row.newContent).not.toBeNull();
        }
        if (row.type === 'context') {
          expect(row.oldContent).not.toBeNull();
          expect(row.newContent).not.toBeNull();
        }
        // No 'removed' or 'modified' rows expected
        expect(row.type).not.toBe('removed');
        expect(row.type).not.toBe('modified');
      }
    });

    it('pure insertion with structurally similar lines (braces) stays as added', () => {
      // The inserted block has `}` which also exists in surrounding code.
      // This must NOT cause false pairing via similarity matching.
      const diff = makeDiff(`@@ -1,5 +1,11 @@
 function foo() {
   return 1;
 }
+
+function inserted() {
+  return 42;
+}
+
+// separator
 
 function bar() {`);
      const data = alignDiff(diff, 'main');

      // All new lines are purely added — no removed, no modified
      const addedRows = data.rows.filter(r => r.type === 'added');
      const removedRows = data.rows.filter(r => r.type === 'removed');
      const modifiedRows = data.rows.filter(r => r.type === 'modified');

      expect(addedRows.length).toBe(6);
      expect(removedRows.length).toBe(0);
      expect(modifiedRows.length).toBe(0);
    });

    it('still pairs genuine edits as modified', () => {
      const diff = makeDiff(`@@ -1,5 +1,5 @@
 const a = 1;
-const b = 2;
-const c = 3;
-const d = 4;
+const b = 22;
+const c = 33;
+const d = 44;
 const e = 5;`);
      const data = alignDiff(diff, 'main');

      expect(types(data)).toEqual([
        'context',
        'modified', 'modified', 'modified',
        'context',
      ]);
    });
  });

  describe('multiple hunks', () => {
    it('emits collapsed separator between hunks (not before first)', () => {
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
        'collapsed',
        'context', 'modified', 'context',
      ]);

      // Collapsed separator row
      const separator = data.rows[3]!;
      expect(separator.oldLineNumber).toBeNull();
      expect(separator.newLineNumber).toBeNull();
      expect(separator.oldContent).toBeNull();
      expect(separator.newContent).toBeNull();
      expect(separator.regionIndex).toBe(0);
      expect(separator.hiddenLineCount).toBe(6); // lines 4-9
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

  // -------------------------------------------------------------------
  // Collapsed regions
  // -------------------------------------------------------------------

  describe('collapsed regions', () => {
    it('computes before-first-hunk region', () => {
      const diff = makeDiff(`@@ -5,3 +5,3 @@
 const a = 5;
-const b = 6;
+const b = 66;
 const c = 7;`);
      const data = alignDiff(diff, 'test', 10);

      expect(data.collapsedRegions.length).toBeGreaterThanOrEqual(1);
      const before = data.collapsedRegions[0]!;
      expect(before.newStartLine).toBe(1);
      expect(before.newEndLine).toBe(4);
      expect(before.oldStartLine).toBe(1);
      expect(before.oldEndLine).toBe(4);
      expect(before.lineCount).toBe(4);
    });

    it('computes between-hunks region', () => {
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
      const data = alignDiff(diff, 'test');

      // Between hunks: lines 4-9 (new-file), lines 4-9 (old-file)
      const between = data.collapsedRegions.find(r => r.newStartLine === 4);
      expect(between).toBeDefined();
      expect(between!.newEndLine).toBe(9);
      expect(between!.lineCount).toBe(6);
    });

    it('computes after-last-hunk region when lineCount provided', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;`);
      const data = alignDiff(diff, 'test', 20);

      const after = data.collapsedRegions.find(r => r.newStartLine === 4);
      expect(after).toBeDefined();
      expect(after!.newEndLine).toBe(20);
      expect(after!.lineCount).toBe(17);
    });

    it('does not emit after-last-hunk region without lineCount', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;`);
      const data = alignDiff(diff, 'test');

      // No after-last region since no lineCount
      expect(data.collapsedRegions.length).toBe(0);
    });

    it('skips zero-line collapsed regions', () => {
      // When hunks are adjacent (no gap), no collapsed region should be emitted
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;
@@ -4,3 +4,3 @@
 const d = 4;
-const e = 5;
+const e = 55;
 const f = 6;`);
      const data = alignDiff(diff, 'test');

      // Hunks are adjacent (lines 1-3 and 4-6), no gap
      expect(data.collapsedRegions.length).toBe(0);
    });

    it('does not emit collapsed rows for zero-line regions', () => {
      const diff = makeDiff(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;
@@ -4,3 +4,3 @@
 const d = 4;
-const e = 5;
+const e = 55;
 const f = 6;`);
      const data = alignDiff(diff, 'test');

      // No collapsed rows when regions have 0 lines
      expect(data.rows.filter(r => r.type === 'collapsed').length).toBe(0);
    });

    it('all-added file has no collapsed regions', () => {
      const diff = makeDiff(`@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+const c = 3;`);
      const data = alignDiff(diff, 'test', 3);

      expect(data.collapsedRegions.length).toBe(0);
    });

    it('collapsed row carries regionIndex and hiddenLineCount', () => {
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
      const data = alignDiff(diff, 'test');

      const collapsedRows = data.rows.filter(r => r.type === 'collapsed');
      expect(collapsedRows.length).toBe(1);
      expect(collapsedRows[0]!.regionIndex).toBe(0);
      expect(collapsedRows[0]!.hiddenLineCount).toBe(6);
    });
  });
});

// -------------------------------------------------------------------
// resolveEffectiveRows
// -------------------------------------------------------------------

describe('resolveEffectiveRows', () => {
  it('returns base rows when no expansions', () => {
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
    const data = alignDiff(diff, 'test');
    const result = resolveEffectiveRows(
      data.rows, data.collapsedRegions,
      new Map(), [''], undefined,
    );
    expect(result).toBe(data.rows);
  });

  it('expands lines from top edge', () => {
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
    const data = alignDiff(diff, 'test');
    const sourceLines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);

    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 2, fromBottom: 0 });

    const result = resolveEffectiveRows(
      data.rows, data.collapsedRegions,
      expansions, sourceLines, undefined,
    );

    // Should have 2 expanded-context rows from top + 1 collapsed (remaining 4) + original rows
    const expandedRows = result.filter(r => r.type === 'expanded-context');
    expect(expandedRows.length).toBe(2);
    expect(expandedRows[0]!.newLineNumber).toBe(4); // first expanded line
    expect(expandedRows[1]!.newLineNumber).toBe(5);

    // Collapsed row should have reduced count
    const collapsedRows = result.filter(r => r.type === 'collapsed');
    expect(collapsedRows.length).toBe(1);
    expect(collapsedRows[0]!.hiddenLineCount).toBe(4); // 6 - 2 = 4
  });

  it('expands lines from bottom edge', () => {
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
    const data = alignDiff(diff, 'test');
    const sourceLines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);

    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 0, fromBottom: 3 });

    const result = resolveEffectiveRows(
      data.rows, data.collapsedRegions,
      expansions, sourceLines, undefined,
    );

    const expandedRows = result.filter(r => r.type === 'expanded-context');
    expect(expandedRows.length).toBe(3);
    // Bottom 3 lines of region (lines 7, 8, 9)
    expect(expandedRows[0]!.newLineNumber).toBe(7);
    expect(expandedRows[1]!.newLineNumber).toBe(8);
    expect(expandedRows[2]!.newLineNumber).toBe(9);

    const collapsedRows = result.filter(r => r.type === 'collapsed');
    expect(collapsedRows.length).toBe(1);
    expect(collapsedRows[0]!.hiddenLineCount).toBe(3); // 6 - 3 = 3
  });

  it('fully expands when fromTop covers all lines', () => {
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
    const data = alignDiff(diff, 'test');
    const sourceLines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);

    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 6, fromBottom: 0 });

    const result = resolveEffectiveRows(
      data.rows, data.collapsedRegions,
      expansions, sourceLines, undefined,
    );

    // No collapsed rows remain
    const collapsedRows = result.filter(r => r.type === 'collapsed');
    expect(collapsedRows.length).toBe(0);

    // All 6 lines expanded
    const expandedRows = result.filter(r => r.type === 'expanded-context');
    expect(expandedRows.length).toBe(6);
  });

  it('uses oldSourceLines for old-side content when available', () => {
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
    const data = alignDiff(diff, 'test');
    const sourceLines = Array.from({ length: 15 }, (_, i) => `new ${i + 1}`);
    const oldSourceLines = Array.from({ length: 15 }, (_, i) => `old ${i + 1}`);

    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 1, fromBottom: 0 });

    const result = resolveEffectiveRows(
      data.rows, data.collapsedRegions,
      expansions, sourceLines, oldSourceLines,
    );

    const expanded = result.find(r => r.type === 'expanded-context');
    expect(expanded!.newContent).toBe('new 4');
    expect(expanded!.oldContent).toBe('old 4');
  });
});

// -------------------------------------------------------------------
// recomputeDiffMeta
// -------------------------------------------------------------------

describe('recomputeDiffMeta', () => {
  it('returns base values when no expansions', () => {
    const diff = makeDiff(`@@ -1,3 +1,3 @@
 a;
-b;
+bb;
 c;
@@ -10,3 +10,3 @@
 x;
-y;
+yy;
 z;`);
    const data = alignDiff(diff, 'test');
    const meta = recomputeDiffMeta(data, new Map());
    expect(meta.rowCount).toBe(data.rows.length);
    expect(meta.visibleLines).toEqual(data.visibleNewLines);
  });

  it('increases rowCount and visibleLines when regions expand', () => {
    const diff = makeDiff(`@@ -1,3 +1,3 @@
 a;
-b;
+bb;
 c;
@@ -10,3 +10,3 @@
 x;
-y;
+yy;
 z;`);
    const data = alignDiff(diff, 'test');
    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 3, fromBottom: 0 });

    const meta = recomputeDiffMeta(data, expansions);
    // Base rows + 3 expanded - but collapsed row either stays (if remaining) or goes
    // Region has 6 lines, expanded 3 from top, so 3 remain → collapsed stays
    expect(meta.rowCount).toBe(data.rows.length + 3); // 3 extra expanded lines
    expect(meta.visibleLines.length).toBe(data.visibleNewLines.length + 3);
  });

  it('fully expanded region removes collapsed row', () => {
    const diff = makeDiff(`@@ -1,3 +1,3 @@
 a;
-b;
+bb;
 c;
@@ -10,3 +10,3 @@
 x;
-y;
+yy;
 z;`);
    const data = alignDiff(diff, 'test');
    const expansions = new Map<number, RegionExpansion>();
    expansions.set(0, { fromTop: 6, fromBottom: 0 }); // fully expand the 6-line gap

    const meta = recomputeDiffMeta(data, expansions);
    // Collapsed row gone (-1), 6 expanded added
    expect(meta.rowCount).toBe(data.rows.length - 1 + 6);
  });
});

// -------------------------------------------------------------------
// findRegionForLine
// -------------------------------------------------------------------

describe('findRegionForLine', () => {
  const regions: CollapsedRegion[] = [
    { index: 0, newStartLine: 1, newEndLine: 4, oldStartLine: 1, oldEndLine: 4, lineCount: 4 },
    { index: 1, newStartLine: 10, newEndLine: 15, oldStartLine: 10, oldEndLine: 15, lineCount: 6 },
  ];

  it('finds region containing the line', () => {
    expect(findRegionForLine(regions, 3)).toBe(regions[0]);
    expect(findRegionForLine(regions, 12)).toBe(regions[1]);
  });

  it('finds region at boundary', () => {
    expect(findRegionForLine(regions, 1)).toBe(regions[0]);
    expect(findRegionForLine(regions, 4)).toBe(regions[0]);
    expect(findRegionForLine(regions, 10)).toBe(regions[1]);
    expect(findRegionForLine(regions, 15)).toBe(regions[1]);
  });

  it('returns undefined for lines not in any region', () => {
    expect(findRegionForLine(regions, 5)).toBeUndefined();
    expect(findRegionForLine(regions, 9)).toBeUndefined();
    expect(findRegionForLine(regions, 20)).toBeUndefined();
  });
});

// -------------------------------------------------------------------
// isLineRevealed
// -------------------------------------------------------------------

describe('isLineRevealed', () => {
  const region: CollapsedRegion = {
    index: 0, newStartLine: 10, newEndLine: 20,
    oldStartLine: 10, oldEndLine: 20, lineCount: 11,
  };

  it('returns true for lines in top expansion', () => {
    const exp: RegionExpansion = { fromTop: 3, fromBottom: 0 };
    expect(isLineRevealed(region, exp, 10)).toBe(true);
    expect(isLineRevealed(region, exp, 12)).toBe(true);
    expect(isLineRevealed(region, exp, 13)).toBe(false);
  });

  it('returns true for lines in bottom expansion', () => {
    const exp: RegionExpansion = { fromTop: 0, fromBottom: 2 };
    expect(isLineRevealed(region, exp, 19)).toBe(true);
    expect(isLineRevealed(region, exp, 20)).toBe(true);
    expect(isLineRevealed(region, exp, 18)).toBe(false);
  });

  it('returns false when no expansion', () => {
    const exp: RegionExpansion = { fromTop: 0, fromBottom: 0 };
    expect(isLineRevealed(region, exp, 15)).toBe(false);
  });
});

// -------------------------------------------------------------------
// autoExpandForLine
// -------------------------------------------------------------------

describe('autoExpandForLine', () => {
  const region: CollapsedRegion = {
    index: 0, newStartLine: 10, newEndLine: 30,
    oldStartLine: 10, oldEndLine: 30, lineCount: 21,
  };

  it('expands from top when line is closer to top', () => {
    const current: RegionExpansion = { fromTop: 0, fromBottom: 0 };
    const result = autoExpandForLine(12, region, current);
    // offsetFromTop = 12 - 10 = 2, needed = 2 + 1 + 3 = 6
    expect(result.fromTop).toBe(6);
    expect(result.fromBottom).toBe(0);
  });

  it('expands from bottom when line is closer to bottom', () => {
    const current: RegionExpansion = { fromTop: 0, fromBottom: 0 };
    const result = autoExpandForLine(28, region, current);
    // offsetFromBottom = 30 - 28 = 2, needed = 2 + 1 + 3 = 6
    expect(result.fromBottom).toBe(6);
    expect(result.fromTop).toBe(0);
  });

  it('preserves existing expansion and takes max', () => {
    const current: RegionExpansion = { fromTop: 10, fromBottom: 0 };
    const result = autoExpandForLine(12, region, current);
    expect(result.fromTop).toBe(10); // max(10, 6)
  });
});
