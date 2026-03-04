/**
 * Shiki-based syntax highlighting: file → ANSI-colored string[].
 *
 * Lazily creates a highlighter on first call. Language is detected from the
 * file extension; unknown extensions fall back to plain text (no color).
 * Theme is configurable via the `theme` parameter (default: `one-dark-pro`).
 */

import { extname } from 'path';
import {
  type BundledLanguage,
  type BundledTheme,
  type ThemedToken,
  bundledLanguages,
  createHighlighter,
} from 'shiki';

// ---------------------------------------------------------------------------
// Hex → ANSI truecolor
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';

const hexToAnsi = (hex: string): string => {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
};

const colorize = (text: string, hex: string | undefined): string =>
  hex ? `${hexToAnsi(hex)}${text}${RESET}` : text;

// ---------------------------------------------------------------------------
// Extension → Shiki language
// ---------------------------------------------------------------------------

/** Map of common file extensions to Shiki `BundledLanguage` ids. */
const EXT_TO_LANG: Record<string, BundledLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.lua': 'lua',
  '.php': 'php',
  '.r': 'r',
  '.dockerfile': 'dockerfile',
  '.tf': 'terraform',
  '.hcl': 'hcl',
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure',
  '.scala': 'scala',
  '.dart': 'dart',
  '.ps1': 'powershell',
  '.prisma': 'prisma',
};

export const detectLanguage = (filePath: string): BundledLanguage | null => {
  const ext = extname(filePath).toLowerCase();
  const mapped = EXT_TO_LANG[ext];
  if (mapped) return mapped;

  // Fallback: try the extension without the dot as a lang id
  const bare = ext.slice(1) as BundledLanguage;
  if (bare in bundledLanguages) return bare;

  return null;
};

// ---------------------------------------------------------------------------
// Highlighter singleton
// ---------------------------------------------------------------------------

type HighlighterInstance = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<HighlighterInstance> | null = null;
let loadedLangs = new Set<string>();
let loadedThemes = new Set<string>();

const DEFAULT_THEME: BundledTheme = 'one-dark-pro';

const getHighlighter = async (
  theme: BundledTheme,
  lang: BundledLanguage | null
): Promise<HighlighterInstance> => {
  if (!highlighterPromise) {
    const initLangs = lang ? [lang] : [];
    highlighterPromise = createHighlighter({
      themes: [theme],
      langs: initLangs,
    });
    loadedThemes.add(theme);
    if (lang) loadedLangs.add(lang);
    return highlighterPromise;
  }

  const h = await highlighterPromise;

  if (!loadedThemes.has(theme)) {
    await h.loadTheme(theme);
    loadedThemes.add(theme);
  }

  if (lang && !loadedLangs.has(lang)) {
    await h.loadLanguage(lang);
    loadedLangs.add(lang);
  }

  return h;
};

// ---------------------------------------------------------------------------
// Token line → ANSI string
// ---------------------------------------------------------------------------

const tokensToAnsi = (tokens: ThemedToken[]): string =>
  tokens.map((t) => colorize(t.content, t.color)).join('');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Files above this line count skip syntax highlighting to avoid Shiki OOM /
 * multi-second parse times. The viewer still works — just without color.
 */
export const HIGHLIGHT_LINE_LIMIT = 50_000;

export type HighlightOptions = {
  /** Full code content. */
  code: string;
  /** File path — used for language detection. */
  filePath: string;
  /** Shiki theme name. Default: `one-dark-pro`. */
  theme?: BundledTheme;
};

/**
 * Highlight source code and return one ANSI-colored string per line.
 *
 * Falls back to plain (uncolored) lines when:
 * - the language is unknown
 * - the file exceeds {@link HIGHLIGHT_LINE_LIMIT} lines
 */
export const highlightCode = async (
  options: HighlightOptions
): Promise<string[]> => {
  const { code, filePath, theme = DEFAULT_THEME } = options;
  const plainLines = code.split(/\r?\n/);

  if (plainLines.length > HIGHLIGHT_LINE_LIMIT) {
    return plainLines;
  }

  const lang = detectLanguage(filePath);

  if (!lang) {
    return plainLines;
  }

  const highlighter = await getHighlighter(theme, lang);
  const { tokens } = highlighter.codeToTokens(code, { lang, theme });

  return tokens.map(tokensToAnsi);
};

/** Supported theme names — re-exported for CLI validation. */
export type { BundledTheme } from 'shiki';
export { DEFAULT_THEME };
