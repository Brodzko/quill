import type { Annotation } from './schema.js';
import type { Mode } from './state.js';

// Fixed lines consumed by the header (title + mode/cursor + instructions + blank before body).
// Must stay in sync with the header lines emitted by `buildFrame`.
// Add 1 more in decide mode for the decision hint line.
const HEADER_LINES = 4;

export const getViewportHeight = (
  mode: Mode,
  terminalRows: number
): number => {
  const extraForDecideHint = mode === 'decide' ? 1 : 0;
  const rows = terminalRows;
  return Math.max(3, rows - HEADER_LINES - extraForDecideHint);
};

export const lineMarker = (params: {
  lineNumber: number;
  focusAnnotation?: string;
  annotations: Annotation[];
}): '◎' | '●' | ' ' => {
  const { lineNumber, focusAnnotation, annotations } = params;

  const hasFocus =
    typeof focusAnnotation === 'string'
      ? annotations.some(
          (annotation) =>
            annotation.id === focusAnnotation &&
            lineNumber >= annotation.startLine &&
            lineNumber <= annotation.endLine
        )
      : false;

  if (hasFocus) {
    return '◎';
  }

  const hasAnyAnnotation = annotations.some(
    (annotation) =>
      lineNumber >= annotation.startLine && lineNumber <= annotation.endLine
  );

  return hasAnyAnnotation ? '●' : ' ';
};

export const buildFrame = (params: {
  filePath: string;
  lines: string[];
  cursorLine: number;
  viewportOffset: number;
  mode: Mode;
  annotations: Annotation[];
  focusAnnotation?: string;
  terminalRows: number;
}): string => {
  const {
    filePath,
    lines,
    cursorLine,
    viewportOffset,
    mode,
    annotations,
    focusAnnotation,
    terminalRows,
  } = params;

  const viewportHeight = getViewportHeight(mode, terminalRows);
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

  return [
    `Quill v0 Slice 1 — ${filePath}`,
    `Mode: ${mode.toUpperCase()}  Cursor: ${cursorLine}/${lines.length}  Annotations: ${annotations.length}`,
    instructionsByMode[mode],
    decisionHint,
    body,
  ]
    .join('\n')
    .trimEnd();
};
