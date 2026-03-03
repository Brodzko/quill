import { describe, expect, it } from 'vitest';
import { detectLanguage } from './highlight.js';

describe('detectLanguage', () => {
  it.each([
    ['src/app.ts', 'typescript'],
    ['src/app.tsx', 'tsx'],
    ['index.js', 'javascript'],
    ['style.css', 'css'],
    ['README.md', 'markdown'],
    ['data.json', 'json'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['script.py', 'python'],
    ['main.go', 'go'],
    ['main.rs', 'rust'],
    ['Dockerfile.dockerfile', 'dockerfile'],
    ['app.vue', 'vue'],
    ['app.svelte', 'svelte'],
  ])('detects %s as %s', (filePath, expected) => {
    expect(detectLanguage(filePath)).toBe(expected);
  });

  it('is case-insensitive for extensions', () => {
    expect(detectLanguage('file.TS')).toBe('typescript');
    expect(detectLanguage('file.JSON')).toBe('json');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBeNull();
    expect(detectLanguage('file.unknown')).toBeNull();
  });

  it('returns null for files without extensions', () => {
    expect(detectLanguage('Makefile')).toBeNull();
  });
});
