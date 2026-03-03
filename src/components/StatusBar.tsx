import { Box, Text } from 'ink';
import type { Mode } from '../state.js';

type StatusBarProps = {
  mode: Mode;
  cursorLine: number;
  lineCount: number;
  annotationCount: number;
  filePath: string;
};

const MODE_COLORS: Record<Mode, string> = {
  browse: 'green',
  decide: 'yellow',
  annotate: 'cyan',
};

export const StatusBar = ({
  mode,
  cursorLine,
  lineCount,
  annotationCount,
  filePath,
}: StatusBarProps) => (
  <Box>
    <Text bold color={MODE_COLORS[mode]}>
      {` ${mode.toUpperCase()} `}
    </Text>
    <Text dimColor>
      {`  ln ${cursorLine}/${lineCount}  ${annotationCount} annotation${annotationCount === 1 ? '' : 's'}  raw  ${filePath}`}
    </Text>
  </Box>
);
