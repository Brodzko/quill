import { Text } from 'ink';
import type { Mode } from '../state.js';

const HINTS: Record<Mode, string> = {
  browse: '[j/k ↑↓] move  [n] annotate  [q] finish  [Ctrl+C] abort',
  decide: '[a] approve  [d] deny  [Esc] back',
  annotate: '[Esc] cancel',
};

export const HelpBar = ({ mode }: { mode: Mode }) => (
  <Text dimColor>{HINTS[mode]}</Text>
);
