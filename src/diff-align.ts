/**
 * Diff parser & aligner — transforms a raw unified diff string into
 * aligned side-by-side rows with line number mappings.
 *
 * Uses `parse-diff` for parsing. The alignment algorithm pairs
 * consecutive del/add blocks positionally (first del with first add),
 * overflow on either side becomes padding — producing the familiar
 * GitLab-style side-by-side layout.
 *
 * Only hunked lines are included (not the full file). Between hunks,
 * a hunk-header separator row is emitted. Toggle to raw mode (`d`)
 * to see the full file.
 */

import parseDiff from 'parse-diff';

// --- Types ---

/**
 * Type of content on a single display row in the aligned diff.
 *
 * - context: unchanged line, present on both sides
 * - added: new line (right side only, left side is padding)
 * - removed: old line (left side only, right side is padding)
 * - modified: line changed on both sides (paired del + add)
 * - hunk-header: @@ separator between hunks
 */
export type DiffLineType = 'context' | 'added' | 'removed' | 'modified' | 'hunk-header';

/**
 * A single row in the aligned side-by-side diff.
 * Either side can be null (padding).
 */
export type AlignedRow = {
  readonly type: DiffLineType;
  /** 1-indexed old-file line number, or null for added lines / hunk headers. */
  readonly oldLineNumber: number | null;
  /** 1-indexed new-file line number, or null for removed lines / hunk headers. */
  readonly newLineNumber: number | null;
  /** Raw old-file line content (no highlighting), or null. */
  readonly oldContent: string | null;
  /** Raw new-file line content (no highlighting), or null. */
  readonly newContent: string | null;
  /** Hunk header text (only for hunk-header rows). */
  readonly header?: string;
};

/**
 * Complete aligned diff data, computed once at startup. Immutable.
 */
export type DiffData = {
  /** Display rows in order. */
  readonly rows: readonly AlignedRow[];
  /**
   * Maps display row index → new-file line number, or null for
   * removed-only rows and hunk headers.
   */
  readonly rowToNewLine: readonly (number | null)[];
  /**
   * Maps new-file line number (1-indexed) → display row index.
   * Only includes lines that appear in the diff (context + added + modified).
   */
  readonly newLineToRowIndex: ReadonlyMap<number, number>;
  /**
   * Sorted array of new-file line numbers visible in the diff.
   * Used for cursor clamping in diff mode.
   */
  readonly visibleNewLines: readonly number[];
  /** Label for the status bar (e.g. "main", "staged"). */
  readonly label: string;
};

// --- Alignment ---

/**
 * Strip the leading diff prefix character (+, -, space) from a change line.
 */
const stripPrefix = (content: string): string =>
  content.length > 0 && (content[0] === '+' || content[0] === '-' || content[0] === ' ')
    ? content.slice(1)
    : content;

/**
 * Parse a unified diff and align into side-by-side rows.
 *
 * Algorithm per hunk:
 * 1. Walk changes sequentially
 * 2. 'normal' (context): flush pending removals, then emit paired left+right
 * 3. 'del': accumulate into pending removals
 * 4. 'add': if pending removals exist, pair with first pending (= modified);
 *    otherwise emit as added-only (left padding)
 * 5. After all changes, flush remaining pending removals as removed-only
 */
export const alignDiff = (rawDiff: string, label: string): DiffData => {
  if (!rawDiff.trim()) {
    return emptyDiffData(label);
  }

  const files = parseDiff(rawDiff);
  // Single-file diff — take the first file entry
  const file = files[0];
  if (!file || file.chunks.length === 0) {
    return emptyDiffData(label);
  }

  const rows: AlignedRow[] = [];

  for (let ci = 0; ci < file.chunks.length; ci++) {
    const chunk = file.chunks[ci]!;

    // Hunk header separator (skip before first hunk for cleaner layout)
    if (ci > 0) {
      rows.push({
        type: 'hunk-header',
        oldLineNumber: null,
        newLineNumber: null,
        oldContent: null,
        newContent: null,
        header: chunk.content,
      });
    }

    const pendingDels: Array<{ ln: number; content: string }> = [];

    const flushDels = (): void => {
      for (const del of pendingDels) {
        rows.push({
          type: 'removed',
          oldLineNumber: del.ln,
          newLineNumber: null,
          oldContent: stripPrefix(del.content),
          newContent: null,
        });
      }
      pendingDels.length = 0;
    };

    for (const change of chunk.changes) {
      switch (change.type) {
        case 'normal': {
          flushDels();
          rows.push({
            type: 'context',
            oldLineNumber: change.ln1,
            newLineNumber: change.ln2,
            oldContent: stripPrefix(change.content),
            newContent: stripPrefix(change.content),
          });
          break;
        }
        case 'del': {
          pendingDels.push({ ln: change.ln, content: change.content });
          break;
        }
        case 'add': {
          if (pendingDels.length > 0) {
            // Pair with first pending deletion → modified row
            const del = pendingDels.shift()!;
            rows.push({
              type: 'modified',
              oldLineNumber: del.ln,
              newLineNumber: change.ln,
              oldContent: stripPrefix(del.content),
              newContent: stripPrefix(change.content),
            });
          } else {
            // Pure addition — left side is padding
            rows.push({
              type: 'added',
              oldLineNumber: null,
              newLineNumber: change.ln,
              oldContent: null,
              newContent: stripPrefix(change.content),
            });
          }
          break;
        }
      }
    }

    // Flush any remaining deletions at end of hunk
    flushDels();
  }

  return buildDiffData(rows, label);
};

// --- DiffData construction ---

const emptyDiffData = (label: string): DiffData => ({
  rows: [],
  rowToNewLine: [],
  newLineToRowIndex: new Map(),
  visibleNewLines: [],
  label,
});

const buildDiffData = (rows: AlignedRow[], label: string): DiffData => {
  const rowToNewLine: (number | null)[] = [];
  const newLineToRowIndex = new Map<number, number>();
  const visibleNewLines: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const newLine = row.newLineNumber;
    rowToNewLine.push(newLine);

    if (newLine !== null) {
      newLineToRowIndex.set(newLine, i);
      visibleNewLines.push(newLine);
    }
  }

  return {
    rows,
    rowToNewLine,
    newLineToRowIndex,
    visibleNewLines,
    label,
  };
};
