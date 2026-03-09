/**
 * Base version — long file for diff Tab-cycling e2e test.
 * ~80 lines so bottom annotations start off-screen.
 */

// --- Section 1: greetings ---

const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

const farewell = (name: string): string => {
  return `Goodbye, ${name}.`;
};

// --- Section 2: arithmetic ---

const add = (a: number, b: number): number => {
  return a + b;
};

const subtract = (a: number, b: number): number => {
  return a - b;
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

const OLD_VERSION = '1.0.0';

// --- Section 6: exports ---

export {
  greet,
  farewell,
  add,
  subtract,
  multiply,
  capitalize,
  repeat,
  truncate,
  first,
  last,
  chunk,
  DEFAULT_CONFIG,
  OLD_VERSION,
};
