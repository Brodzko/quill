/**
 * Base version of a file for diff testing.
 * The "new" version (diff-modified.ts) has additions, removals, and modifications.
 */

const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

const add = (a: number, b: number): number => {
  return a + b;
};

const subtract = (a: number, b: number): number => {
  return a - b;
};

const multiply = (a: number, b: number): number => {
  return a * b;
};

const OLD_CONSTANT = 42;

export { greet, add, subtract, multiply, OLD_CONSTANT };
