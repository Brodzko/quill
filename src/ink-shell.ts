import { randomUUID } from 'crypto';
import { render as renderInk, Text, useApp, useInput } from 'ink';
import { createElement, useReducer, useState } from 'react';
import { stderr } from 'process';
import { ReadStream as TtyReadStream } from 'tty';
import type { SessionResult } from './schema.js';
import { buildFrame, getViewportHeight } from './render.js';
import { type BrowseState, reduce } from './state.js';
import { runCommentPrompt } from './terminal.js';

type InkShellAppProps = {
  filePath: string;
  lines: string[];
  initialState: BrowseState;
  focusAnnotation?: string;
  interactiveInput: NodeJS.ReadStream | TtyReadStream;
  onResult: (result: SessionResult) => void;
};

const InkShellApp = ({
  filePath,
  lines,
  initialState,
  focusAnnotation,
  interactiveInput,
  onResult,
}: InkShellAppProps) => {
  const { exit } = useApp();
  const terminalRows = process.stderr.rows ?? 24;
  const [state, dispatch] = useReducer(reduce, initialState);
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  useInput((input, key) => {
    if (isPromptOpen) {
      return;
    }

    if (key.ctrl && input === 'c') {
      onResult({ type: 'abort' });
      exit();
      return;
    }

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
        setIsPromptOpen(true);
        void runCommentPrompt(interactiveInput)
          .then((draft) => {
            if (!draft) {
              return;
            }

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
          })
          .finally(() => {
            setIsPromptOpen(false);
          });
        return;
      }

      if (input === 'q') {
        dispatch({ type: 'set_mode', mode: 'decide' });
        dispatch({
          type: 'update_viewport',
          viewportHeight: getViewportHeight('decide', terminalRows),
        });
      }

      return;
    }

    if (state.mode === 'decide') {
      if (input === 'a' || input === 'd') {
        onResult({
          type: 'finish',
          decision: input === 'a' ? 'approve' : 'deny',
          annotations: state.annotations,
        });
        exit();
        return;
      }

      if (key.escape) {
        dispatch({ type: 'set_mode', mode: 'browse' });
        dispatch({
          type: 'update_viewport',
          viewportHeight: getViewportHeight('browse', terminalRows),
        });
      }
    }
  });

  const frame = buildFrame({
    filePath,
    lines,
    focusAnnotation,
    terminalRows,
    ...state,
  });

  const promptHint = isPromptOpen
    ? '\n\nAnnotation prompt active in terminal input...'
    : '';

  return createElement(Text, {}, `${frame}${promptHint}`);
};

export const runInkShell = async (params: {
  filePath: string;
  lines: string[];
  initialState: BrowseState;
  focusAnnotation?: string;
  interactiveInput: NodeJS.ReadStream | TtyReadStream;
}): Promise<SessionResult> => {
  return new Promise((resolve) => {
    let resolved = false;

    const app = renderInk(
      createElement(InkShellApp, {
        ...params,
        onResult: (result: SessionResult) => {
          resolved = true;
          resolve(result);
        },
      }),
      {
        stdin: params.interactiveInput,
        stdout: stderr,
        stderr,
        exitOnCtrlC: false,
      }
    );

    void app.waitUntilExit().then(() => {
      if (!resolved) {
        resolve({ type: 'abort' });
      }
    });
  });
};
