/**
 * Modified version — long file for diff Tab-cycling e2e test.
 * Changes at top (greet signature), middle (removed subtract, added divide),
 * and bottom (renamed version, added format util + export).
 */

// --- Section 1: greetings ---

const greet = (name: string, greeting = 'Hello'): string => {
  return `${greeting}, ${name}! Welcome.`;
};

const farewell = (name: string): string => {
  return `Goodbye, ${name}.`;
};

// --- Section 2: arithmetic ---

const add = (a: number, b: number): number => {
  return a + b;
};

const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error('Cannot divide by zero');
  return a / b;
};

const multiply = (a: number, b: number): number => {
  return a * b;
};

// --- Section 3: string helpers ---

const capitalize = (s: string): string => {
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const repeat = (s: string, n: number): string => {
  return s.repeat(n);
};

const truncate = (s: string, max: number): string => {
  return s.length > max ? s.slice(0, max) + '...' : s;
};

// --- Section 4: array utilities ---

const first = <T>(arr: T[]): T | undefined => arr[0];

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

const chunk = <T>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

// --- Section 5: config ---

const DEFAULT_CONFIG = {
  timeout: 3000,
  retries: 3,
  verbose: false,
  logLevel: 'info',
};

const NEW_VERSION = '2.0.0';

const formatOutput = (data: unknown): string => {
  return JSON.stringify(data, null, 2);
};

// --- Section 6: exports ---

export {
  greet,
  farewell,
  add,
  divide,
  multiply,
  capitalize,
  repeat,
  truncate,
  first,
  last,
  chunk,
  DEFAULT_CONFIG,
  NEW_VERSION,
  formatOutput,
};
