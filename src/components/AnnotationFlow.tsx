import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { AnnotationDraft, KnownCategory, KnownIntent } from '../schema.js';
import { CATEGORY_BY_KEY, INTENT_BY_KEY } from '../schema.js';

type AnnotationFlowProps = {
  cursorLine: number;
  onComplete: (draft: AnnotationDraft) => void;
  onCancel: () => void;
};

type FlowStep = 'intent' | 'category' | 'comment';

export const AnnotationFlow = ({
  cursorLine,
  onComplete,
  onCancel,
}: AnnotationFlowProps) => {
  const [step, setStep] = useState<FlowStep>('intent');
  const [intent, setIntent] = useState<KnownIntent | undefined>();
  const [category, setCategory] = useState<KnownCategory | undefined>();
  const [comment, setComment] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (step === 'intent') {
      const matched =
        INTENT_BY_KEY[input as keyof typeof INTENT_BY_KEY];
      if (matched) {
        setIntent(matched);
        setStep('category');
      }
      return;
    }

    if (step === 'category') {
      if (key.return) {
        setStep('comment');
        return;
      }
      const matched =
        CATEGORY_BY_KEY[input as keyof typeof CATEGORY_BY_KEY];
      if (matched) {
        setCategory(matched);
        setStep('comment');
      }
      return;
    }

    if (step === 'comment') {
      if (key.return) {
        const trimmed = comment.trim();
        if (trimmed.length > 0 && intent) {
          onComplete({ intent, category, comment: trimmed });
        }
        return;
      }
      if (key.backspace || key.delete) {
        setComment((prev) => prev.slice(0, -1));
        return;
      }
      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setComment((prev) => prev + input);
      }
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Annotate line {cursorLine}
      </Text>

      {step === 'intent' && (
        <Text>
          Intent:{' '}
          <Text bold>[i]</Text>nstruct{' '}
          <Text bold>[q]</Text>uestion{' '}
          <Text bold>[c]</Text>omment{' '}
          <Text bold>[p]</Text>raise{' '}
          <Text dimColor>[Esc] cancel</Text>
        </Text>
      )}

      {step === 'category' && (
        <Box flexDirection="column">
          <Text dimColor>Intent: {intent}</Text>
          <Text>
            Category:{' '}
            <Text bold>[b]</Text>ug{' '}
            <Text bold>[s]</Text>ecurity{' '}
            per<Text bold>[f]</Text>ormance{' '}
            <Text bold>[d]</Text>esign{' '}
            s<Text bold>[t]</Text>yle{' '}
            nit pic<Text bold>[k]</Text>{' '}
            <Text dimColor>[Enter] skip  [Esc] cancel</Text>
          </Text>
        </Box>
      )}

      {step === 'comment' && (
        <Box flexDirection="column">
          <Text dimColor>
            Intent: {intent}
            {category ? `  Category: ${category}` : ''}
          </Text>
          <Text>
            Comment: {comment}
            <Text dimColor>▎</Text>
          </Text>
          <Text dimColor>[Enter] submit  [Esc] cancel</Text>
        </Box>
      )}
    </Box>
  );
};
