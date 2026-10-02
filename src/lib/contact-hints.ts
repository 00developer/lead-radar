// Finds contact details that the author wrote publicly in the post or bio (docs/design.md 4.4). Pure function.
// The tool never contacts anyone: this only helps a human reply.

export type ContactHints = { emails: string[]; phones: string[]; links: string[]; whatsapp: boolean };

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
// 8 to 15 digits, optionally with +, spaces, dots, dashes or brackets. Loose on purpose: a human checks it.
const PHONE = /(?<![\w/])\+?\(?\d[\d\s().-]{6,17}\d(?![\w])/g;

const uniq = (xs: string[]) => [...new Set(xs)];

export function extractContactHints(...texts: (string | null | undefined)[]): ContactHints {
  const all = texts.filter((t): t is string => !!t).join('\n');
  const emails = uniq(all.match(EMAIL) ?? []).map((e) => e.toLowerCase());
  const links = uniq((all.match(URL_RE) ?? []).map((u) => u.replace(/[.,;!?]+$/, '')));
  const withoutUrls = all.replace(URL_RE, ' ');
  const phones = uniq(
    (withoutUrls.match(PHONE) ?? [])
      .map((p) => p.trim())
      .filter((p) => {
        const digits = p.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15;
      }),
  );
  return { emails, phones, links, whatsapp: /whats\s?app|watsapp|\bwa\.me\b/i.test(all) };
}

export function hasAnyHint(h: ContactHints): boolean {
  return h.emails.length > 0 || h.phones.length > 0 || h.links.length > 0 || h.whatsapp;
}
