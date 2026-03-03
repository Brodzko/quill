import { randomUUID } from 'crypto';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useReducer } from 'react';
import type { AnnotationDraft, SessionResult } from '../schema.js';
import { type BrowseState, reduce } from '../state.js';
import { AnnotationFlow } from './AnnotationFlow.js';
import { DecisionPicker } from './DecisionPicker.js';
import { HelpBar } from './HelpBar.js';
import { StatusBar } from './StatusBar.js';
import { Viewport } from './Viewport.js';

type AppProps = {
  filePath: string;
  lines: string[];
  initialState: BrowseState;
  focusAnnotation?: string;
  onResult: (result: SessionResult) => void;
};

const VIEWPORT_CHROME_LINES = 4; // status + help + decision + padding

const getViewportHeight = (terminalRows: number): number =>
  Math.max(3, terminalRows - VIEWPORT_CHROME_LINES);

export const App = ({
  filePath,
  lines,
  initialState,
  focusAnnotation,
  onResult,
}: AppProps) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reduce, initialState);

  // Sync viewport height from terminal dimensions.
  const viewportHeight = getViewportHeight(stdout?.rows ?? 24);
  if (viewportHeight !== state.viewportHeight) {
    dispatch({ type: 'update_viewport', viewportHeight });
  }

  const handleAnnotationComplete = useCallback(
    (draft: AnnotationDraft) => {
      dispatch({
        type: 'add_annotation',
        annotation: {
          id: randomUUID(),
          startLine: state.cursorLine,
          endLine: state.cursorLine,
          intent: draft.intent,
          category: draft.category,
          comment: draft.comment,
          source: 'user',
        },
      });
      dispatch({ type: 'set_mode', mode: 'browse' });
    },
    [state.cursorLine]
  );

  const handleAnnotationCancel = useCallback(() => {
    dispatch({ type: 'set_mode', mode: 'browse' });
  }, []);

  useInput(
    (input, key) => {
      // --- Global ---
      if (key.ctrl && input === 'c') {
        onResult({ type: 'abort' });
        exit();
        return;
      }

      // --- Browse mode ---
      if (state.mode === 'browse') {
        if (input === 'k' || key.upArrow) {
          dispatch({ type: 'move_cursor', delta: -1 });
          return;
        }
        if (input === 'j' || key.downArrow) {
          dispatch({ type: 'move_cursor', delta: 1 });
          return;
        }
        if (input === 'n') {
          dispatch({ type: 'set_mode', mode: 'annotate' });
          return;
        }
        if (input === 'q') {
          dispatch({ type: 'set_mode', mode: 'decide' });
          return;
        }
        return;
      }

      // --- Decide mode ---
      if (state.mode === 'decide') {
        if (input === 'a') {
          onResult({
            type: 'finish',
            decision: 'approve',
            annotations: state.annotations,
          });
          exit();
          return;
        }
        if (input === 'd') {
          onResult({
            type: 'finish',
            decision: 'deny',
            annotations: state.annotations,
          });
          exit();
          return;
        }
        if (key.escape) {
          dispatch({ type: 'set_mode', mode: 'browse' });
        }
      }
    },
    { isActive: state.mode !== 'annotate' }
  );

  return (
    <Box flexDirection="column">
      <Text bold>{`Quill — ${filePath}`}</Text>
      <Viewport
        lines={lines}
        cursorLine={state.cursorLine}
        viewportOffset={state.viewportOffset}
        viewportHeight={viewportHeight}
        annotations={state.annotations}
        focusAnnotation={focusAnnotation}
      />
      <StatusBar
        mode={state.mode}
        cursorLine={state.cursorLine}
        lineCount={state.lineCount}
        annotationCount={state.annotations.length}
        filePath={filePath}
      />
      <HelpBar mode={state.mode} />
      {state.mode === 'decide' && <DecisionPicker />}
      {state.mode === 'annotate' && (
        <AnnotationFlow
          cursorLine={state.cursorLine}
          onComplete={handleAnnotationComplete}
          onCancel={handleAnnotationCancel}
        />
      )}
    </Box>
  );
};
