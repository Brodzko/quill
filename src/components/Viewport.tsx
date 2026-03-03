import { Box, Text } from 'ink';
import type { Annotation } from '../schema.js';

type ViewportProps = {
  lines: string[];
  cursorLine: number;
  viewportOffset: number;
  viewportHeight: number;
  annotations: Annotation[];
  focusAnnotation?: string;
};

const lineMarker = (params: {
  lineNumber: number;
  focusAnnotation?: string;
  annotations: Annotation[];
}): '◎' | '●' | ' ' => {
  const { lineNumber, focusAnnotation, annotations } = params;

  const hasFocus =
    typeof focusAnnotation === 'string' &&
    annotations.some(
      (a) =>
        a.id === focusAnnotation &&
        lineNumber >= a.startLine &&
        lineNumber <= a.endLine
    );

  if (hasFocus) return '◎';

  const hasAnnotation = annotations.some(
    (a) => lineNumber >= a.startLine && lineNumber <= a.endLine
  );

  return hasAnnotation ? '●' : ' ';
};

export const Viewport = ({
  lines,
  cursorLine,
  viewportOffset,
  viewportHeight,
  annotations,
  focusAnnotation,
}: ViewportProps) => {
  const visibleLines = lines.slice(
    viewportOffset,
    viewportOffset + viewportHeight
  );
  const gutterWidth = String(lines.length).length;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => {
        const lineNumber = viewportOffset + i + 1;
        const isCursor = lineNumber === cursorLine;
        const pointer = isCursor ? '>' : ' ';
        const marker = lineMarker({
          lineNumber,
          focusAnnotation,
          annotations,
        });
        const paddedNum = String(lineNumber).padStart(gutterWidth, ' ');

        return (
          <Text key={lineNumber} inverse={isCursor}>
            {pointer}
            {paddedNum} {marker} {line}
          </Text>
        );
      })}
    </Box>
  );
};
