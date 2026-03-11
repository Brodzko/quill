/**
 * Diff parser & aligner — transforms a raw unified diff string into
 * aligned side-by-side rows with line number mappings.
 *
 * Uses `parse-diff` for parsing. The alignment algorithm pairs
 * consecutive del/add blocks positionally (first del with first add),
 * overflow on either side becomes padding — producing the familiar
 * GitLab-style side-by-side layout.
 *
 * Between hunks, collapsed separator rows are emitted. These can be
 * expanded interactively to reveal hidden context lines.
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
 * - collapsed: replaces hunk-header — interactive "N lines hidden" separator
 * - expanded-context: user-expanded unchanged lines (visually distinct)
 */
export type DiffLineType = 'context' | 'added' | 'removed' | 'modified' | 'collapsed' | 'expanded-context';

/**
 * A single row in the aligned side-by-side diff.
 * Either side can be null (padding).
 */
export type AlignedRow = {
  readonly type: DiffLineType;
  /** 1-indexed old-file line number, or null for added lines / collapsed rows. */
  readonly oldLineNumber: number | null;
  /** 1-indexed new-file line number, or null for removed lines / collapsed rows. */
  readonly newLineNumber: number | null;
  /** Raw old-file line content (no highlighting), or null. */
  readonly oldContent: string | null;
  /** Raw new-file line content (no highlighting), or null. */
  readonly newContent: string | null;
  /** For 'collapsed' rows: the region index. */
  readonly regionIndex?: number;
  /** For 'collapsed' rows: number of currently hidden lines. */
  readonly hiddenLineCount?: number;
};

/**
 * A collapsed region between/around hunks. Represents a gap of unchanged
 * lines that can be expanded interactively. Computed once by `alignDiff`.
 */
export type CollapsedRegion = {
  /** Stable index (0-based, ordered by position in file). */
  readonly index: number;
  /** New-file line range, 1-indexed, inclusive. */
  readonly newStartLine: number;
  readonly newEndLine: number;
  /** Old-file line range, 1-indexed, inclusive. */
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  /** Total hidden lines (newEndLine - newStartLine + 1). */
  readonly lineCount: number;
  /**
   * Index into base DiffData.rows where this region sits.
   * The region logically lives between rows[insertAfterRow] and
   * rows[insertAfterRow + 1]. -1 = before first row.
   */
  readonly insertAfterRow: number;
};

/**
 * Complete aligned diff data, computed once at startup. Immutable.
 */
export type DiffData = {
  /** Display rows in order (base rows — before expansion). */
  readonly rows: readonly AlignedRow[];
  /**
   * Maps display row index → new-file line number, or null for
   * removed-only rows and collapsed separators.
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
  /** Collapsed regions between/around hunks. Ordered by file position. */
  readonly collapsedRegions: readonly CollapsedRegion[];
};

// --- Alignment ---

/**
 * Minimum similarity (0–1) for a del/add pair to be shown as a "modified" row.
 * Below this threshold, lines are emitted as separate removed + added rows.
 * Comparable to git's `-M` rename detection threshold — deterministic given
 * the same inputs, just threshold-dependent.
 */
const SIMILARITY_THRESHOLD = 0.4;

/**
 * Compute similarity between two strings using bigram overlap (Dice coefficient).
 * Returns 0–1 where 1 = identical. Deterministic and fast for short lines.
 * Empty strings vs non-empty = 0; both empty = 1.
 */
export const similarity = (a: string, b: string): number => {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };

  // For single-char strings, fall back to exact match (already handled above → 0)
  if (ta.length < 2 || tb.length < 2) return 0;

  const aMap = bigrams(ta);
  const bMap = bigrams(tb);
  let intersection = 0;
  for (const [bg, count] of aMap) {
    intersection += Math.min(count, bMap.get(bg) ?? 0);
  }
  const totalBigrams = (ta.length - 1) + (tb.length - 1);
  return (2 * intersection) / totalBigrams;
};

/**
 * Strip the leading diff prefix character (+, -, space) from a change line.
 */
const stripPrefix = (content: string): string =>
  content.length > 0 && (content[0] === '+' || content[0] === '-' || content[0] === ' ')
    ? content.slice(1)
    : content;

/**
 * Reclassify noise rows as context:
 * - `modified` rows where trimmed content is identical (whitespace-only
 *   or line-number-only offset changes).
 */
const suppressNoiseRows = (rows: AlignedRow[]): AlignedRow[] =>
  rows.map((row) => {
    if (
      row.type === 'modified' &&
      row.oldContent !== null &&
      row.newContent !== null &&
      row.oldContent.trim() === row.newContent.trim()
    ) {
      return { ...row, type: 'context' as const };
    }
    return row;
  });

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
 *
 * @param lineCount - Total lines in the new file. Used to compute the
 *   after-last-hunk collapsed region. Optional — when omitted, no
 *   after-last-hunk region is emitted.
 */
export const alignDiff = (rawDiff: string, label: string, lineCount?: number): DiffData => {
  if (!rawDiff.trim()) {
    return emptyDiffData(label);
  }

  const files = parseDiff(rawDiff);
  // Single-file diff — take the first file entry
  const file = files[0];
  if (!file || file.chunks.length === 0) {
    return emptyDiffData(label);
  }

  // --- Phase 1: Compute collapsed regions from chunk metadata ---
  const collapsedRegions: CollapsedRegion[] = [];
  const chunks = file.chunks;

  // Before first hunk
  if (chunks[0]!.newStart > 1) {
    const region: CollapsedRegion = {
      index: collapsedRegions.length,
      newStartLine: 1,
      newEndLine: chunks[0]!.newStart - 1,
      oldStartLine: 1,
      oldEndLine: chunks[0]!.oldStart - 1,
      lineCount: chunks[0]!.newStart - 1,
      insertAfterRow: -1,
    };
    if (region.lineCount > 0) collapsedRegions.push(region);
  }

  // Between hunks N and N+1
  for (let ci = 0; ci < chunks.length - 1; ci++) {
    const current = chunks[ci]!;
    const next = chunks[ci + 1]!;
    const newStart = current.newStart + current.newLines;
    const newEnd = next.newStart - 1;
    const oldStart = current.oldStart + current.oldLines;
    const oldEnd = next.oldStart - 1;
    const count = newEnd - newStart + 1;
    if (count > 0) {
      collapsedRegions.push({
        index: collapsedRegions.length,
        newStartLine: newStart,
        newEndLine: newEnd,
        oldStartLine: oldStart,
        oldEndLine: oldEnd,
        lineCount: count,
        insertAfterRow: -1, // patched below after rows are built
      });
    }
  }

  // After last hunk (only when lineCount is provided)
  if (lineCount !== undefined) {
    const last = chunks[chunks.length - 1]!;
    const newStart = last.newStart + last.newLines;
    const newEnd = lineCount;
    const count = newEnd - newStart + 1;
    if (count > 0) {
      const oldStart = last.oldStart + last.oldLines;
      collapsedRegions.push({
        index: collapsedRegions.length,
        newStartLine: newStart,
        newEndLine: newEnd,
        oldStartLine: oldStart,
        oldEndLine: oldStart + count - 1,
        lineCount: count,
        insertAfterRow: -1, // patched below
      });
    }
  }

  // --- Phase 2: Build aligned rows with collapsed separators ---
  const rows: AlignedRow[] = [];
  // Track which region index to emit between hunks
  // regionSlot[0] = before first hunk (if exists)
  // regionSlot[ci] = between hunk ci-1 and hunk ci for ci > 0
  // regionSlot[chunks.length] = after last hunk

  // Build a map: gap position → region
  // gap 0 = before first hunk, gap ci = between hunk ci-1 and ci, gap chunks.length = after last
  const gapToRegion = new Map<number, CollapsedRegion>();
  for (const region of collapsedRegions) {
    // Determine which gap this region belongs to
    if (region.newEndLine < chunks[0]!.newStart) {
      gapToRegion.set(0, region);
    } else if (lineCount !== undefined && region.newStartLine >= chunks[chunks.length - 1]!.newStart + chunks[chunks.length - 1]!.newLines) {
      gapToRegion.set(chunks.length, region);
    } else {
      for (let ci = 0; ci < chunks.length - 1; ci++) {
        const current = chunks[ci]!;
        const regionNewStart = current.newStart + current.newLines;
        if (region.newStartLine === regionNewStart) {
          gapToRegion.set(ci + 1, region);
          break;
        }
      }
    }
  }

  // Emit collapsed row for before-first-hunk region
  const beforeFirstRegion = gapToRegion.get(0);
  if (beforeFirstRegion) {
    const updatedRegion = { ...beforeFirstRegion, insertAfterRow: -1 };
    collapsedRegions[updatedRegion.index] = updatedRegion;
    rows.push({
      type: 'collapsed',
      oldLineNumber: null,
      newLineNumber: null,
      oldContent: null,
      newContent: null,
      regionIndex: updatedRegion.index,
      hiddenLineCount: updatedRegion.lineCount,
    });
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!;

    // Between-hunk collapsed separator (for ci > 0)
    if (ci > 0) {
      const region = gapToRegion.get(ci);
      if (region) {
        const insertAfterRow = rows.length - 1;
        const updatedRegion = { ...region, insertAfterRow };
        collapsedRegions[updatedRegion.index] = updatedRegion;
        rows.push({
          type: 'collapsed',
          oldLineNumber: null,
          newLineNumber: null,
          oldContent: null,
          newContent: null,
          regionIndex: updatedRegion.index,
          hiddenLineCount: updatedRegion.lineCount,
        });
      }
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
            const del = pendingDels[0]!;
            const sim = similarity(stripPrefix(del.content), stripPrefix(change.content));
            if (sim >= SIMILARITY_THRESHOLD) {
              // Similar enough → pair as modified row
              pendingDels.shift();
              rows.push({
                type: 'modified',
                oldLineNumber: del.ln,
                newLineNumber: change.ln,
                oldContent: stripPrefix(del.content),
                newContent: stripPrefix(change.content),
              });
            } else {
              // Not similar → emit add now, keep dels pending.
              // Pending dels flush at next context line or end of hunk,
              // so additions render before deletions (new code first).
              rows.push({
                type: 'added',
                oldLineNumber: null,
                newLineNumber: change.ln,
                oldContent: null,
                newContent: stripPrefix(change.content),
              });
            }
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

  // After-last-hunk collapsed row
  const afterLastRegion = gapToRegion.get(chunks.length);
  if (afterLastRegion) {
    const insertAfterRow = rows.length - 1;
    const updatedRegion = { ...afterLastRegion, insertAfterRow };
    collapsedRegions[updatedRegion.index] = updatedRegion;
    rows.push({
      type: 'collapsed',
      oldLineNumber: null,
      newLineNumber: null,
      oldContent: null,
      newContent: null,
      regionIndex: updatedRegion.index,
      hiddenLineCount: updatedRegion.lineCount,
    });
  }

  return buildDiffData(suppressNoiseRows(rows), label, collapsedRegions);
};

// --- DiffData construction ---

const emptyDiffData = (label: string): DiffData => ({
  rows: [],
  rowToNewLine: [],
  newLineToRowIndex: new Map(),
  visibleNewLines: [],
  label,
  collapsedRegions: [],
});

const buildDiffData = (
  rows: AlignedRow[],
  label: string,
  collapsedRegions: readonly CollapsedRegion[] = [],
): DiffData => {
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
    collapsedRegions,
  };
};

// --- Region expansion types ---

/**
 * Per-region expansion state. Tracks how many lines are revealed from each edge.
 * A region is fully expanded when `fromTop + fromBottom >= region.lineCount`.
 */
export type RegionExpansion = {
  /** Lines revealed from the top of the region (expanding downward from upper hunk boundary). */
  readonly fromTop: number;
  /** Lines revealed from the bottom of the region (expanding upward from lower hunk boundary). */
  readonly fromBottom: number;
};

// --- Effective row resolution ---

/**
 * Resolve effective rows from base diff rows + expansion state.
 * Walks base rows. When encountering a 'collapsed' row:
 * 1. Emits revealed lines from top edge as 'expanded-context' rows
 * 2. If remaining hidden > 0, emits a 'collapsed' row with updated hiddenLineCount
 * 3. Emits revealed lines from bottom edge as 'expanded-context' rows
 * Non-collapsed rows pass through unchanged.
 */
export const resolveEffectiveRows = (
  baseRows: readonly AlignedRow[],
  collapsedRegions: readonly CollapsedRegion[],
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
  sourceLines: readonly string[],
  oldSourceLines: readonly string[] | undefined,
): AlignedRow[] => {
  if (expandedRegions.size === 0) return baseRows as AlignedRow[];

  const result: AlignedRow[] = [];

  for (const row of baseRows) {
    if (row.type !== 'collapsed' || row.regionIndex === undefined) {
      result.push(row);
      continue;
    }

    const region = collapsedRegions[row.regionIndex];
    if (!region) {
      result.push(row);
      continue;
    }

    const expansion = expandedRegions.get(region.index);
    if (!expansion) {
      result.push(row);
      continue;
    }

    const { fromTop, fromBottom } = expansion;
    const actualFromTop = Math.min(fromTop, region.lineCount);
    const actualFromBottom = Math.min(fromBottom, region.lineCount - actualFromTop);
    const remaining = region.lineCount - actualFromTop - actualFromBottom;

    // Emit expanded lines from top edge
    for (let k = 0; k < actualFromTop; k++) {
      const newLine = region.newStartLine + k;
      const oldLine = region.oldStartLine + k;
      const content = sourceLines[newLine - 1] ?? '';
      const oldContent = oldSourceLines ? (oldSourceLines[oldLine - 1] ?? content) : content;
      result.push({
        type: 'expanded-context',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        oldContent,
        newContent: content,
      });
    }

    // Emit remaining collapsed separator (if any lines still hidden)
    if (remaining > 0) {
      result.push({
        type: 'collapsed',
        oldLineNumber: null,
        newLineNumber: null,
        oldContent: null,
        newContent: null,
        regionIndex: region.index,
        hiddenLineCount: remaining,
      });
    }

    // Emit expanded lines from bottom edge
    for (let k = 0; k < actualFromBottom; k++) {
      const newLine = region.newEndLine - actualFromBottom + 1 + k;
      const oldLine = region.oldEndLine - actualFromBottom + 1 + k;
      const content = sourceLines[newLine - 1] ?? '';
      const oldContent = oldSourceLines ? (oldSourceLines[oldLine - 1] ?? content) : content;
      result.push({
        type: 'expanded-context',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        oldContent,
        newContent: content,
      });
    }
  }

  return result;
};

/**
 * Recompute DiffMeta from base DiffData + expanded regions.
 * Pure function of structural metadata — no source line content needed.
 */
export const recomputeDiffMeta = (
  baseDiffData: DiffData,
  expandedRegions: ReadonlyMap<number, RegionExpansion>,
): { rowCount: number; visibleLines: readonly number[]; newLineToRow: ReadonlyMap<number, number> } => {
  if (expandedRegions.size === 0) {
    return {
      rowCount: baseDiffData.rows.length,
      visibleLines: baseDiffData.visibleNewLines,
      newLineToRow: baseDiffData.newLineToRowIndex,
    };
  }

  const visibleLines: number[] = [];
  const newLineToRow = new Map<number, number>();
  let effectiveRow = 0;

  for (const row of baseDiffData.rows) {
    if (row.type !== 'collapsed' || row.regionIndex === undefined) {
      const newLine = row.newLineNumber;
      if (newLine !== null) {
        newLineToRow.set(newLine, effectiveRow);
        visibleLines.push(newLine);
      }
      effectiveRow++;
      continue;
    }

    const region = baseDiffData.collapsedRegions[row.regionIndex];
    if (!region) {
      effectiveRow++;
      continue;
    }

    const expansion = expandedRegions.get(region.index);
    if (!expansion) {
      effectiveRow++; // collapsed row stays
      continue;
    }

    const { fromTop, fromBottom } = expansion;
    const actualFromTop = Math.min(fromTop, region.lineCount);
    const actualFromBottom = Math.min(fromBottom, region.lineCount - actualFromTop);
    const remaining = region.lineCount - actualFromTop - actualFromBottom;

    // Top expanded lines
    for (let k = 0; k < actualFromTop; k++) {
      const newLine = region.newStartLine + k;
      newLineToRow.set(newLine, effectiveRow);
      visibleLines.push(newLine);
      effectiveRow++;
    }

    // Remaining collapsed separator
    if (remaining > 0) {
      effectiveRow++;
    }

    // Bottom expanded lines
    for (let k = 0; k < actualFromBottom; k++) {
      const newLine = region.newEndLine - actualFromBottom + 1 + k;
      newLineToRow.set(newLine, effectiveRow);
      visibleLines.push(newLine);
      effectiveRow++;
    }
  }

  // Sort visibleLines (expanded lines may interleave with base order)
  visibleLines.sort((a, b) => a - b);

  return { rowCount: effectiveRow, visibleLines, newLineToRow };
};

/**
 * Find which CollapsedRegion contains a given new-file line number.
 * Returns undefined if the line is not in any collapsed region.
 */
export const findRegionForLine = (
  regions: readonly CollapsedRegion[],
  line: number,
): CollapsedRegion | undefined =>
  regions.find(r => line >= r.newStartLine && line <= r.newEndLine);

/**
 * Check if a line is already revealed by expansion state.
 * Returns true if the line is within the top or bottom expanded portion.
 */
export const isLineRevealed = (
  region: CollapsedRegion,
  expansion: RegionExpansion,
  line: number,
): boolean => {
  const fromTop = Math.min(expansion.fromTop, region.lineCount);
  const fromBottom = Math.min(expansion.fromBottom, region.lineCount - fromTop);
  // Top expanded: [newStartLine, newStartLine + fromTop - 1]
  if (line >= region.newStartLine && line < region.newStartLine + fromTop) return true;
  // Bottom expanded: [newEndLine - fromBottom + 1, newEndLine]
  if (line > region.newEndLine - fromBottom && line <= region.newEndLine) return true;
  return false;
};

/**
 * Compute the minimum expansion needed to make a target line visible,
 * with padding. Expands from whichever edge is closer.
 */
export const autoExpandForLine = (
  line: number,
  region: CollapsedRegion,
  current: RegionExpansion,
): RegionExpansion => {
  const padding = 3;
  const offsetFromTop = line - region.newStartLine;
  const offsetFromBottom = region.newEndLine - line;

  if (offsetFromTop <= offsetFromBottom) {
    // Closer to top edge — expand from top
    const needed = offsetFromTop + 1 + padding;
    return { ...current, fromTop: Math.max(current.fromTop, needed) };
  } else {
    // Closer to bottom edge — expand from bottom
    const needed = offsetFromBottom + 1 + padding;
    return { ...current, fromBottom: Math.max(current.fromBottom, needed) };
  }
};
