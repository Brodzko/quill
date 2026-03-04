/**
 * Sample TypeScript file for e2e testing.
 * Covers: syntax highlighting, line numbers, scrolling, annotations.
 */

import { readFileSync } from 'fs';
import * as path from 'path';

// --- Types ---

type ReviewStatus = 'pending' | 'approved' | 'denied';

type Annotation = {
  id: string;
  startLine: number;
  endLine: number;
  intent: string;
  comment: string;
  source: string;
};

type ReviewResult = {
  file: string;
  status: ReviewStatus;
  annotations: Annotation[];
};

// --- Constants ---

const MAX_LINE_LENGTH = 120;
const DEFAULT_TIMEOUT = 5000;
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yaml', '.yml'] as const;

// --- Functions ---

const validateAnnotation = (ann: Annotation): boolean => {
  if (ann.startLine < 1 || ann.endLine < ann.startLine) return false;
  if (!ann.comment.trim()) return false;
  if (!ann.id) return false;
  return true;
};

const formatAnnotation = (ann: Annotation): string => {
  const range = ann.startLine === ann.endLine
    ? `L${ann.startLine}`
    : `L${ann.startLine}-L${ann.endLine}`;
  return `[${range}] ${ann.intent}: ${ann.comment}`;
};

const processFile = (filePath: string): ReviewResult => {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const annotations: Annotation[] = [];

  // Scan for TODO/FIXME comments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes('TODO') || line.includes('FIXME')) {
      annotations.push({
        id: `auto-${i + 1}`,
        startLine: i + 1,
        endLine: i + 1,
        intent: 'comment',
        comment: `Found marker: ${line.trim()}`,
        source: 'scanner',
      });
    }
  }

  return {
    file: filePath,
    status: annotations.length > 0 ? 'pending' : 'approved',
    annotations,
  };
};

// --- A very long line for horizontal scroll testing ---
const LONG_STRING = 'abcdefghijklmnopqrstuvwxyz'.repeat(10) + ' | This text should only be visible after horizontal scrolling to the right →→→';

// --- Multi-line expressions for selection testing ---

const CONFIG = {
  server: {
    host: 'localhost',
    port: 3000,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
    },
  },
  database: {
    url: 'postgresql://localhost:5432/mydb',
    pool: { min: 2, max: 10 },
    debug: process.env['NODE_ENV'] === 'development',
  },
  logging: {
    level: 'info',
    format: 'json',
    transports: ['console', 'file'],
  },
};

// --- Export ---

export { validateAnnotation, formatAnnotation, processFile, CONFIG, LONG_STRING };
export type { Annotation, ReviewResult, ReviewStatus };
