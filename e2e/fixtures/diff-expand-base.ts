/**
 * Base version — large file for expandable collapsed region e2e tests.
 *
 * ~250 lines with content spread across 6 sections.
 * The modified version has changes in sections 1, 3, 5, and 6,
 * leaving sections 2 and 4 (~55 lines each) as large collapsed gaps.
 */

// ─── Section 1: Configuration ───────────────────────────────────

const APP_NAME = 'quill-test';
const APP_VERSION = '1.0.0';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

const createLogger = (level: LogLevel) => {
  return {
    level,
    prefix: `[${APP_NAME}]`,
    log: (msg: string) => console.log(`[${level}] ${msg}`),
  };
};

// ─── Section 2: String utilities (unchanged) ────────────────────

const capitalize = (s: string): string => {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const camelCase = (s: string): string => {
  return s
    .split(/[-_\s]+/)
    .map((word, i) => (i === 0 ? word.toLowerCase() : capitalize(word)))
    .join('');
};

const snakeCase = (s: string): string => {
  return s
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
};

const kebabCase = (s: string): string => {
  return s
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
};

const truncate = (s: string, maxLen: number): string => {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
};

const padLeft = (s: string, len: number, char = ' '): string => {
  while (s.length < len) s = char + s;
  return s;
};

const padRight = (s: string, len: number, char = ' '): string => {
  while (s.length < len) s = s + char;
  return s;
};

const repeat = (s: string, n: number): string => {
  return s.repeat(Math.max(0, n));
};

const words = (s: string): string[] => {
  return s.split(/\s+/).filter(w => w.length > 0);
};

const reverse = (s: string): string => {
  return s.split('').reverse().join('');
};

const isPalindrome = (s: string): boolean => {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
};

const countOccurrences = (s: string, sub: string): number => {
  let count = 0;
  let pos = 0;
  while ((pos = s.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
};

// ─── Section 3: Array utilities ─────────────────────────────────

const first = <T>(arr: readonly T[]): T | undefined => arr[0];

const last = <T>(arr: readonly T[]): T | undefined => arr[arr.length - 1];

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const flatten = <T>(arr: readonly (T | T[])[]): T[] => {
  return arr.reduce<T[]>((acc, val) => acc.concat(val), []);
};

const unique = <T>(arr: readonly T[]): T[] => {
  return [...new Set(arr)];
};

const zip = <A, B>(a: readonly A[], b: readonly B[]): [A, B][] => {
  const len = Math.min(a.length, b.length);
  const result: [A, B][] = [];
  for (let i = 0; i < len; i++) {
    result.push([a[i]!, b[i]!]);
  }
  return result;
};

const range = (start: number, end: number): number[] => {
  const result: number[] = [];
  for (let i = start; i < end; i++) result.push(i);
  return result;
};

// ─── Section 4: Math utilities (unchanged) ──────────────────────

const clamp = (val: number, min: number, max: number): number => {
  return Math.min(Math.max(val, min), max);
};

const lerp = (a: number, b: number, t: number): number => {
  return a + (b - a) * t;
};

const inverseLerp = (a: number, b: number, val: number): number => {
  return (val - a) / (b - a);
};

const remap = (val: number, inMin: number, inMax: number, outMin: number, outMax: number): number => {
  const t = inverseLerp(inMin, inMax, val);
  return lerp(outMin, outMax, t);
};

const degToRad = (deg: number): number => (deg * Math.PI) / 180;

const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

const roundTo = (val: number, decimals: number): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
};

const sum = (arr: readonly number[]): number => {
  return arr.reduce((a, b) => a + b, 0);
};

const average = (arr: readonly number[]): number => {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
};

const median = (arr: readonly number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const standardDeviation = (arr: readonly number[]): number => {
  const avg = average(arr);
  const squareDiffs = arr.map(val => Math.pow(val - avg, 2));
  return Math.sqrt(average(squareDiffs));
};

const factorial = (n: number): number => {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
};

const fibonacci = (n: number): number => {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
};

const gcd = (a: number, b: number): number => {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
};

const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) {
    if (n % i === 0) return false;
  }
  return true;
};

// ─── Section 5: Validation ──────────────────────────────────────

type ValidationResult = {
  valid: boolean;
  errors: string[];
};

const validateString = (val: unknown): ValidationResult => {
  if (typeof val !== 'string') {
    return { valid: false, errors: ['Expected string'] };
  }
  return { valid: true, errors: [] };
};

const validateNumber = (val: unknown): ValidationResult => {
  if (typeof val !== 'number' || isNaN(val)) {
    return { valid: false, errors: ['Expected number'] };
  }
  return { valid: true, errors: [] };
};

const validateRange = (val: number, min: number, max: number): ValidationResult => {
  const errors: string[] = [];
  if (val < min) errors.push(`Value ${val} below minimum ${min}`);
  if (val > max) errors.push(`Value ${val} above maximum ${max}`);
  return { valid: errors.length === 0, errors };
};

// ─── Section 6: Exports ─────────────────────────────────────────

export {
  APP_NAME,
  APP_VERSION,
  createLogger,
  capitalize,
  camelCase,
  snakeCase,
  kebabCase,
  truncate,
  padLeft,
  padRight,
  repeat,
  words,
  reverse,
  isPalindrome,
  countOccurrences,
  first,
  last,
  chunk,
  flatten,
  unique,
  zip,
  range,
  clamp,
  lerp,
  inverseLerp,
  remap,
  degToRad,
  radToDeg,
  roundTo,
  sum,
  average,
  median,
  standardDeviation,
  factorial,
  fibonacci,
  gcd,
  isPrime,
  validateString,
  validateNumber,
  validateRange,
};
