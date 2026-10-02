// Cheap rules that run before any AI call (docs/architecture.md section 7, step 2). Pure functions, no I/O.
// A dropped post is kept in the database with a reason, so nothing disappears silently.

export type PrefilterStatus = 'passed' | 'dropped_short' | 'dropped_language' | 'dropped_old' | 'dropped_negative_keyword' | 'dropped_duplicate';

export type PrefilterVerdict = { status: PrefilterStatus; reason: string | null };

export type PrefilterPost = { text: string; postedAt: Date | null };

export type PrefilterContext = {
  now: Date;
  maxAgeDays: number;
  negativeTerms: string[];
  minLetters?: number;
};

const DEFAULT_MIN_LETTERS = 10;

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, ' ');
}

function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * Scripts we can read: Latin (English, Hinglish) and Devanagari (Hindi). If most letters are in another script
 * (Cyrillic, CJK, Thai, Arabic and so on) the post is dropped before the AI call. Other Latin-script languages
 * (for example Indonesian) cannot be told apart by script; the classifier reports the language and promotion
 * applies the workspace's allowed_languages setting.
 */
export function hasSupportedScript(text: string): boolean {
  const letters = letterCount(text);
  if (letters === 0) return false;
  const supported = (text.match(/[\p{Script=Latin}\p{Script=Devanagari}]/gu) ?? []).length;
  return supported / letters >= 0.5;
}

export function normalizeForDedupe(text: string): string {
  return stripUrls(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-phrase, case-insensitive match. "portfolio" does not match inside another word. */
export function matchesTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}($|[^\\p{L}\\p{N}])`, 'iu');
  return re.test(text);
}

export function prefilterPost(post: PrefilterPost, ctx: PrefilterContext): PrefilterVerdict {
  const body = stripUrls(post.text);
  if (letterCount(body) < (ctx.minLetters ?? DEFAULT_MIN_LETTERS)) {
    return { status: 'dropped_short', reason: 'too little text' };
  }
  if (!hasSupportedScript(body)) {
    return { status: 'dropped_language', reason: 'script is not Latin or Devanagari' };
  }
  if (post.postedAt) {
    const ageDays = (ctx.now.getTime() - post.postedAt.getTime()) / 86_400_000;
    if (ageDays > ctx.maxAgeDays) {
      return { status: 'dropped_old', reason: `older than ${ctx.maxAgeDays} days` };
    }
  }
  const hit = ctx.negativeTerms.find((term) => matchesTerm(post.text, term));
  if (hit) return { status: 'dropped_negative_keyword', reason: `negative keyword: ${hit}` };
  return { status: 'passed', reason: null };
}
