/**
 * Modified version of diff-base.ts for diff testing.
 * Changes: modified greet, removed subtract, added divide, renamed constant,
 * added a very long line for horizontal scroll testing in diff mode.
 */

const greet = (name: string, greeting = 'Hello'): string => {
  return `${greeting}, ${name}! Welcome to the system.`;
};

const add = (a: number, b: number): number => {
  return a + b;
};

const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
};

const multiply = (a: number, b: number): number => {
  return a * b;
};

const NEW_CONSTANT = 99;

const LONG_CONFIG = { setting1: 'value1', setting2: 'value2', setting3: 'value3', setting4: 'value4', setting5: 'value5', setting6: 'value6', setting7: 'value7', setting8: 'value8' };

export { greet, add, divide, multiply, NEW_CONSTANT, LONG_CONFIG };
