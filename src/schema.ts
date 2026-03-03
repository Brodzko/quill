import { randomUUID } from 'crypto';
import * as R from 'remeda';
import { z } from 'zod';

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type KnownIntent = 'instruct' | 'question' | 'comment' | 'praise';
export type KnownCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'design'
  | 'style'
  | 'nitpick';

// --- Schemas ---

// Lenient input schema: id and source are optional (defaults applied during normalization).
const annotationInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    startLine: z.coerce.number().int().min(1),
    endLine: z.coerce.number().int().min(1),
    intent: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    comment: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .refine((a) => a.endLine >= a.startLine, {
    message: 'endLine must be >= startLine',
  });

const annotationSchema = z.object({
  id: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  intent: z.string().min(1),
  category: z.string().min(1).optional(),
  comment: z.string().min(1),
  source: z.string().min(1),
});

const inputEnvelopeSchema = z
  .object({
    annotations: z.array(annotationInputSchema.catch(undefined as never)).optional(),
  })
  .passthrough();

const outputEnvelopeSchema = z.object({
  file: z.string(),
  mode: z.literal('raw'),
  decision: z.enum(['approve', 'deny']),
  annotations: z.array(annotationSchema),
});

// --- Derived types ---

export type Annotation = z.infer<typeof annotationSchema>;
export type Decision = z.infer<typeof outputEnvelopeSchema>['decision'];
export type OutputEnvelope = z.infer<typeof outputEnvelopeSchema>;
export type InputEnvelope = Prettify<z.infer<typeof inputEnvelopeSchema>>;

export type SessionResult =
  | { type: 'finish'; decision: Decision; annotations: Annotation[] }
  | { type: 'abort' };

export type AnnotationDraft = {
  intent: KnownIntent;
  category?: KnownCategory;
  comment: string;
};

// --- Constants ---

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

// --- Normalization ---

const normalizeCandidate = (
  candidate: z.infer<typeof annotationInputSchema>
): Annotation => ({
  id: candidate.id ?? randomUUID(),
  startLine: candidate.startLine,
  endLine: candidate.endLine,
  intent: candidate.intent,
  category: candidate.category,
  comment: candidate.comment,
  source: candidate.source ?? 'agent',
});

export const normalizeInputAnnotations = (
  envelope: InputEnvelope | null
): Annotation[] => {
  return R.pipe(
    envelope?.annotations ?? [],
    R.filter(R.isNonNullish),
    R.map(normalizeCandidate)
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
    const result = inputEnvelopeSchema.safeParse(parsedJson);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const createOutput = (params: {
  filePath: string;
  decision: Decision;
  annotations: Annotation[];
}): OutputEnvelope => ({
  file: params.filePath,
  mode: 'raw',
  decision: params.decision,
  annotations: params.annotations,
});
