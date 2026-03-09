/**
 * Modified file for whitespace / offset diff suppression testing.
 *
 * Changes from base:
 * - Added an import at the top (pushes everything down = offset-only changes)
 * - Re-indented config object (whitespace-only changes)
 * - One real modification to validate (genuine change among noise)
 * - Trailing whitespace removed from process function
 */

import { log } from './logger';

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
  if (Array.isArray(input)) return false;
  return true;
};

log('module loaded');

export { greet, config, process, FORMAT, validate };
