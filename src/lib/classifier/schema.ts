import { z } from 'zod';

// Output of the classifier (docs/classifier.md section 2). Everything the model returns is validated with this schema.
export const ClassificationSchema = z.object({
  author_type: z.enum(['buyer', 'seller', 'spam', 'irrelevant', 'unclear']),
  service: z.string().nullable(),
  matched_offering: z.string().nullable(),
  fit: z.enum(['strong', 'partial', 'none']).nullable(),
  intent_score: z.number().int().min(0).max(100),
  urgency: z.enum(['low', 'medium', 'high']).nullable(),
  budget: z.string().nullable(),
  timeline: z.string().nullable(),
  language: z.enum(['en', 'hi', 'hinglish', 'other']),
  reason: z.string().max(400),
  reply_draft: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type Classification = z.infer<typeof ClassificationSchema>;

/** Tolerates a Markdown code fence around the JSON, nothing else. */
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Validates the model output and enforces the rules that depend on the workspace:
 * service must be one of the workspace's service slugs (read from workspace_services) or "other".
 * Fields that must be null for non-buyers are cleaned instead of rejected.
 */
export function validateClassification(text: string, allowedServiceSlugs: string[], offeringNames: string[] = []): Classification {
  const c = ClassificationSchema.parse(parseModelJson(text));
  const allowed = new Set([...allowedServiceSlugs, 'other']);
  if (c.service !== null && !allowed.has(c.service)) {
    throw new Error(`service "${c.service}" is not one of the workspace services`);
  }
  const isBuyerish = c.author_type === 'buyer' || c.author_type === 'unclear';
  // matched_offering must be one of the confirmed offerings; without a profile both fields stay null.
  const offering = offeringNames.length > 0 && c.matched_offering !== null ? offeringNames.find((n) => n.toLowerCase() === c.matched_offering!.trim().toLowerCase()) ?? null : null;
  return {
    ...c,
    matched_offering: offering,
    fit: offeringNames.length > 0 ? c.fit : null,
    service: isBuyerish ? c.service : null,
    urgency: isBuyerish ? c.urgency : null,
    reply_draft: c.author_type === 'buyer' || (c.author_type === 'unclear' && c.confidence >= 0.4) ? c.reply_draft : null,
  };
}
