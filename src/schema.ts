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

const replySchema = z.object({
  comment: z.string().min(1),
  source: z.string().min(1),
});

const replyInputSchema = z.object({
  comment: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
});

// Lenient input schema: id and source are optional (defaults applied during normalization).
const annotationInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    startLine: z.coerce.number().int().min(0),
    endLine: z.coerce.number().int().min(0),
    intent: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    comment: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
    status: z.enum(['approved', 'dismissed']).optional(),
    replies: z.array(replyInputSchema.catch(undefined as never)).optional(),
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
  status: z.enum(['approved', 'dismissed']).optional(),
  fileLevel: z.boolean().optional(),
  replies: z.array(replySchema).optional(),
});

const inputEnvelopeSchema = z
  .object({
    annotations: z.array(annotationInputSchema.catch(undefined as never)).optional(),
  })
  .passthrough();

const outputEnvelopeSchema = z.object({
  file: z.string(),
  mode: z.enum(['raw', 'diff']),
  decision: z.enum(['approve', 'deny']),
  diffRef: z.string().optional(),
  annotations: z.array(annotationSchema.extend({
    // In output, file-level annotations are emitted with startLine: 0 / endLine: 0
    startLine: z.number().int().min(0),
    endLine: z.number().int().min(0),
  })),
});

export type AnnotationStatus = z.infer<typeof annotationSchema>['status'];

// --- Derived types ---

export type Reply = z.infer<typeof replySchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Decision = z.infer<typeof outputEnvelopeSchema>['decision'];
export type OutputEnvelope = z.infer<typeof outputEnvelopeSchema>;
export type InputEnvelope = Prettify<z.infer<typeof inputEnvelopeSchema>>;

export type SessionResult =
  | { type: 'finish'; decision: Decision; annotations: readonly Annotation[] }
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
): Annotation => {
  // File-level annotations (startLine: 0) are anchored to line 1 for
  // rendering/navigation. The fileLevel flag preserves the original intent.
  const isFileLevel = candidate.startLine === 0 && candidate.endLine === 0;
  const base: Annotation = {
    id: candidate.id ?? randomUUID(),
    startLine: isFileLevel ? 1 : candidate.startLine,
    endLine: isFileLevel ? 1 : candidate.endLine,
    intent: candidate.intent,
    category: candidate.category,
    comment: candidate.comment,
    source: candidate.source ?? 'agent',
    ...(isFileLevel ? { fileLevel: true } : {}),
  };
  if (candidate.status) base.status = candidate.status;
  const replies = (candidate.replies ?? []).filter(R.isNonNullish).map((r) => ({
    comment: r.comment,
    source: r.source ?? 'user',
  }));
  if (replies.length > 0) base.replies = replies;
  return base;
};

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
  mode: 'raw' | 'diff';
  decision: Decision;
  annotations: readonly Annotation[];
  diffRef?: string;
}): OutputEnvelope => ({
  file: params.filePath,
  mode: params.mode,
  decision: params.decision,
  ...(params.diffRef ? { diffRef: params.diffRef } : {}),
  annotations: params.annotations.map((a) =>
    a.fileLevel ? { ...a, startLine: 0, endLine: 0 } : { ...a },
  ),
});
