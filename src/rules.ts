// The rules every part of a debate must pass. Pure functions, no I/O.

/** The words and phrases a part may never contain (matched case insensitively, as whole words). */
export const REFUSED: readonly string[] = [
  'bull', 'bear', 'bullish', 'bearish', 'upside', 'downside target', 'undervalued', 'overvalued',
  'accumulate', 'moon', 'buy now', 'sell now', 'price target', 'entry', 'exit', 'take profit',
  'not financial advice',
];

export const ADVOCATE_MAX_WORDS = 180;
export const REVIEWER_MAX_WORDS = 150;

/** A number as written: a run of digits, optionally with inner "." or "," groups (12, 12.5, 1,234.56). */
const NUMBER = /[0-9]+(?:[.,][0-9]+)*/g;

/** Every number written in a text, exactly as written. */
export function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

/** Any dash character: Unicode Dash_Punctuation (hyphen, en dash, em dash, ...) plus the minus signs. */
const DASH = /[\p{Pd}\u2212\u2796\uFE63\uFF0D\u00AD]/u;
/** Any numeric character that is not one of the Latin digits 0 to 9 (Arabic, Devanagari, fullwidth, superscripts ...). */
const NON_LATIN_DIGIT = /(?![0-9])\p{N}/u;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One whole word pattern per refused term; a plural "s" also counts, and inner spaces match any whitespace. */
const REFUSED_PATTERNS: ReadonlyArray<[string, RegExp]> = REFUSED.map((term) => {
  const body = term.split(' ').map(escape).join('\\s+');
  const plural = term === 'entry' ? '(?:y|ies)' : '(?:s|es)?';
  const core = term === 'entry' ? 'entr' + plural : body + plural;
  return [term, new RegExp(`(?<![\\p{L}\\p{N}])${core}(?![\\p{L}\\p{N}])`, 'iu')];
});

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface RuleOptions {
  /** The measured facts; every number in the text must appear in it, written the same way. */
  facts: string;
  /** Word limit for this part. */
  maxWords: number;
  /** The caller's extra guard: problems found in the text, empty when fine. */
  check?: (text: string) => string[];
  /** Whether to apply the word limit to this text (the reviewer's lists are checked but not counted). */
  countWords?: boolean;
}

/**
 * The problems with one text, in plain words. An empty list means the text passes every rule.
 * The checks: numbers in the facts, refused words, Latin digits, no dash characters, word limit, deps.check.
 */
export function problems(text: string, opts: RuleOptions): string[] {
  const out: string[] = [];
  if (typeof text !== 'string') return ['the text is not a string'];
  if (text.trim() === '') return ['the text is empty'];
  const known = new Set(numbersIn(opts.facts));
  const missing = [...new Set(numbersIn(text))].filter((n) => !known.has(n));
  for (const n of missing) out.push(`the number ${n} is not in the measured facts`);
  for (const [term, re] of REFUSED_PATTERNS) if (re.test(text)) out.push(`refused word "${term}"`);
  if (NON_LATIN_DIGIT.test(text)) out.push('a digit that is not a Latin digit 0 to 9');
  if (DASH.test(text)) out.push('a dash character');
  if (opts.countWords !== false) {
    const words = countWords(text);
    if (words > opts.maxWords) out.push(`${words} words, over the limit of ${opts.maxWords}`);
  }
  if (opts.check) {
    let extra: unknown;
    try {
      extra = opts.check(text);
    } catch (e) {
      extra = [`the check failed: ${e instanceof Error ? e.message : String(e)}`];
    }
    if (Array.isArray(extra)) for (const p of extra) if (p != null && String(p).trim() !== '') out.push(String(p));
  }
  return out;
}
