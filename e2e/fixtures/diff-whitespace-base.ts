/**
 * Base file for whitespace / offset diff suppression testing.
 */

const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

const config = {
  host: 'localhost',
  port: 3000,
  debug: false,
};

const process = (items: string[]): string[] => {
  return items
    .filter((item) => item.length > 0)
    .map((item) => item.trim());
};

const FORMAT = 'json';

const validate = (input: unknown): boolean => {
  if (input === null) return false;
  if (typeof input !== 'object') return false;
  return true;
};

export { greet, config, process, FORMAT, validate };
