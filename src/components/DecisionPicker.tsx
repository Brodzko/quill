import { Box, Text } from 'ink';

export const DecisionPicker = () => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="yellow">
      Decision required:
    </Text>
    <Text>
      {'  '}
      <Text bold color="green">[a]</Text> approve{'  '}
      <Text bold color="red">[d]</Text> deny{'  '}
      <Text dimColor>[Esc]</Text> back
    </Text>
  </Box>
);
