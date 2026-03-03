import { randomUUID } from 'crypto';
import * as R from 'remeda';
import { z } from 'zod';

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type Decision = 'approve' | 'deny';

export type KnownIntent = 'instruct' | 'question' | 'comment' | 'praise';
export type KnownCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'design'
  | 'style'
  | 'nitpick';

export type Annotation = {
  id: string;
  startLine: number;
  endLine: number;
  intent: string;
  category?: string;
  comment: string;
  source: string;
};

export type AnnotationDraft = {
  intent: KnownIntent;
  category?: KnownCategory;
  comment: string;
};

export type OutputEnvelope = {
  file: string;
  mode: 'raw';
  decision: Decision;
  annotations: Annotation[];
};

export type SessionResult =
  | { type: 'finish'; decision: Decision; annotations: Annotation[] }
  | { type: 'abort' };

export const INTENT_BY_KEY = {
  i: 'instruct',
  q: 'question',
  c: 'comment',
  p: 'praise',
} as const satisfies Record<string, KnownIntent>;

export const CATEGORY_BY_KEY = {
  b: 'bug',
  s: 'security',
  f: 'performance',
  d: 'design',
  t: 'style',
  k: 'nitpick',
} as const satisfies Record<string, KnownCategory>;

export const annotationInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    startLine: z.coerce.number().int(),
    endLine: z.coerce.number().int(),
    intent: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    comment: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const inputEnvelopeSchema = z
  .object({
    annotations: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type InputEnvelope = Prettify<z.output<typeof inputEnvelopeSchema>>;

export const normalizeCandidate = (candidate: unknown): Annotation | null => {
  const parsedCandidate = annotationInputSchema.safeParse(candidate);

  if (!parsedCandidate.success) {
    return null;
  }

  const { startLine, endLine, intent, category, comment, id, source } =
    parsedCandidate.data;

  if (startLine < 1 || endLine < startLine) {
    return null;
  }

  return {
    id: id ?? randomUUID(),
    startLine,
    endLine,
    intent,
    category,
    comment,
    source: source ?? 'agent',
  };
};

export const normalizeInputAnnotations = (
  envelope: InputEnvelope | null
): Annotation[] => {
  return R.pipe(
    envelope?.annotations ?? [],
    R.map(normalizeCandidate),
    R.filter(R.isNonNullish)
  );
};

export const tryParseInputEnvelope = (
  rawJson: string | null
): InputEnvelope | null => {
  if (!rawJson) {
    return null;
  }

  try {
    const parsedJson = JSON.parse(rawJson) as unknown;
    const parsedEnvelope = inputEnvelopeSchema.safeParse(parsedJson);
    return parsedEnvelope.success ? parsedEnvelope.data : null;
  } catch {
    return null;
  }
};

export const createOutput = (params: {
  filePath: string;
  decision: Decision;
  annotations: Annotation[];
}): OutputEnvelope => {
  return {
    file: params.filePath,
    mode: 'raw',
    decision: params.decision,
    annotations: params.annotations,
  };
};
