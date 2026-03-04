import { describe, expect, it } from 'vitest';
import {
  type Annotation,
  type OutputEnvelope,
  createOutput,
  normalizeInputAnnotations,
  tryParseInputEnvelope,
} from './schema.js';

// ---------------------------------------------------------------------------
// tryParseInputEnvelope
// ---------------------------------------------------------------------------

describe('tryParseInputEnvelope', () => {
  it('parses valid JSON with annotations', () => {
    const input = JSON.stringify({
      annotations: [
        {
          startLine: 1,
          endLine: 5,
          intent: 'comment',
          comment: 'hello',
        },
      ],
    });
    const result = tryParseInputEnvelope(input);
    expect(result).not.toBeNull();
    expect(result!.annotations).toHaveLength(1);
  });

  it('returns null for null input', () => {
    expect(tryParseInputEnvelope(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(tryParseInputEnvelope('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(tryParseInputEnvelope('not json')).toBeNull();
  });

  it('parses envelope with no annotations key', () => {
    const result = tryParseInputEnvelope(JSON.stringify({ file: 'test.ts' }));
    expect(result).not.toBeNull();
    expect(result!.annotations).toBeUndefined();
  });

  it('passes through extra fields (passthrough schema)', () => {
    const input = JSON.stringify({
      annotations: [],
      decision: 'approve',
      file: 'test.ts',
    });
    const result = tryParseInputEnvelope(input);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('approve');
    expect(result!.file).toBe('test.ts');
  });

  it('drops malformed annotations via catch', () => {
    const input = JSON.stringify({
      annotations: [
        { startLine: 1, endLine: 5, intent: 'comment', comment: 'valid' },
        { startLine: 'not a number' }, // malformed
        { startLine: 5, endLine: 3, intent: 'x', comment: 'y' }, // endLine < startLine
      ],
    });
    const result = tryParseInputEnvelope(input);
    expect(result).not.toBeNull();
    // Malformed entries caught as undefined by .catch()
    const annotations = result!.annotations ?? [];
    const valid = annotations.filter(Boolean);
    expect(valid).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeInputAnnotations
// ---------------------------------------------------------------------------

describe('normalizeInputAnnotations', () => {
  it('returns empty array for null envelope', () => {
    expect(normalizeInputAnnotations(null)).toEqual([]);
  });

  it('returns empty array for envelope without annotations', () => {
    expect(normalizeInputAnnotations({ annotations: undefined })).toEqual([]);
  });

  it('generates id and source when missing', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          { startLine: 1, endLine: 1, intent: 'comment', comment: 'test' },
        ],
      })
    );
    const annotations = normalizeInputAnnotations(envelope);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.id).toBeTruthy();
    expect(annotations[0]!.source).toBe('agent');
  });

  it('preserves provided id and source', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            id: 'custom-id',
            startLine: 1,
            endLine: 1,
            intent: 'comment',
            comment: 'test',
            source: 'custom',
          },
        ],
      })
    );
    const annotations = normalizeInputAnnotations(envelope);
    expect(annotations[0]!.id).toBe('custom-id');
    expect(annotations[0]!.source).toBe('custom');
  });

  it('filters out undefined entries from malformed input', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          { startLine: 1, endLine: 1, intent: 'comment', comment: 'good' },
          { broken: true }, // will be caught as undefined
        ],
      })
    );
    const annotations = normalizeInputAnnotations(envelope);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.comment).toBe('good');
  });

  it('coerces string line numbers', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            startLine: '10',
            endLine: '20',
            intent: 'comment',
            comment: 'coerced',
          },
        ],
      })
    );
    const annotations = normalizeInputAnnotations(envelope);
    expect(annotations[0]!.startLine).toBe(10);
    expect(annotations[0]!.endLine).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// createOutput
// ---------------------------------------------------------------------------

describe('createOutput', () => {
  it('creates a valid output envelope', () => {
    const annotation: Annotation = {
      id: 'ann-1',
      startLine: 1,
      endLine: 5,
      intent: 'comment',
      comment: 'test',
      source: 'user',
    };

    const output: OutputEnvelope = createOutput({
      filePath: 'src/test.ts',
      mode: 'raw',
      decision: 'approve',
      annotations: [annotation],
    });

    expect(output.file).toBe('src/test.ts');
    expect(output.mode).toBe('raw');
    expect(output.decision).toBe('approve');
    expect(output.annotations).toHaveLength(1);
    expect(output.annotations[0]).toEqual(annotation);
  });

  it('produces empty annotations array when none provided', () => {
    const output = createOutput({
      filePath: 'test.ts',
      mode: 'raw',
      decision: 'deny',
      annotations: [],
    });
    expect(output.annotations).toEqual([]);
    expect(output.decision).toBe('deny');
  });

  it('includes mode: diff and diffRef when in diff mode', () => {
    const output = createOutput({
      filePath: 'src/foo.ts',
      mode: 'diff',
      decision: 'approve',
      annotations: [],
      diffRef: 'main',
    });
    expect(output.mode).toBe('diff');
    expect(output.diffRef).toBe('main');
  });

  it('omits diffRef when not provided in diff mode', () => {
    const output = createOutput({
      filePath: 'src/foo.ts',
      mode: 'diff',
      decision: 'deny',
      annotations: [],
    });
    expect(output.mode).toBe('diff');
    expect(output.diffRef).toBeUndefined();
  });

  it('preserves annotations with correct new-file line numbers in diff output', () => {
    const ann: Annotation = {
      id: 'diff-ann-1',
      startLine: 10,
      endLine: 12,
      intent: 'comment',
      comment: 'change looks good',
      source: 'user',
    };
    const output = createOutput({
      filePath: 'src/bar.ts',
      mode: 'diff',
      decision: 'approve',
      annotations: [ann],
      diffRef: 'feature-branch',
    });
    expect(output.annotations).toHaveLength(1);
    expect(output.annotations[0]!.startLine).toBe(10);
    expect(output.annotations[0]!.endLine).toBe(12);
    expect(output.diffRef).toBe('feature-branch');
  });
});

// ---------------------------------------------------------------------------
// replies and status round-trip
// ---------------------------------------------------------------------------

describe('replies and status', () => {
  it('normalizes annotations with replies', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            startLine: 1,
            endLine: 1,
            intent: 'comment',
            comment: 'test',
            source: 'agent',
            replies: [{ comment: 'agreed', source: 'user' }],
          },
        ],
      })
    );
    const anns = normalizeInputAnnotations(envelope);
    expect(anns).toHaveLength(1);
    expect(anns[0]!.replies).toEqual([{ comment: 'agreed', source: 'user' }]);
  });

  it('normalizes annotations with status', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            startLine: 1,
            endLine: 1,
            intent: 'comment',
            comment: 'test',
            source: 'agent',
            status: 'approved',
          },
        ],
      })
    );
    const anns = normalizeInputAnnotations(envelope);
    expect(anns[0]!.status).toBe('approved');
  });

  it('defaults reply source to user when omitted', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            startLine: 1,
            endLine: 1,
            intent: 'comment',
            comment: 'test',
            replies: [{ comment: 'reply text' }],
          },
        ],
      })
    );
    const anns = normalizeInputAnnotations(envelope);
    expect(anns[0]!.replies?.[0]?.source).toBe('user');
  });

  it('omits replies when empty array', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          {
            startLine: 1,
            endLine: 1,
            intent: 'comment',
            comment: 'test',
            replies: [],
          },
        ],
      })
    );
    const anns = normalizeInputAnnotations(envelope);
    expect(anns[0]!.replies).toBeUndefined();
  });

  it('omits status when not present', () => {
    const envelope = tryParseInputEnvelope(
      JSON.stringify({
        annotations: [
          { startLine: 1, endLine: 1, intent: 'comment', comment: 'test' },
        ],
      })
    );
    const anns = normalizeInputAnnotations(envelope);
    expect(anns[0]!.status).toBeUndefined();
  });
});
