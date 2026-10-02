// Turns a classification into a lead decision (decision D-29, docs/classifier.md section 6). Pure function.
//
// buyer at or above the lead threshold  -> lead (needs_review when confidence is below 0.5)
// unclear with intent 40 or more        -> lead flagged needs_review (never silently dropped)
// classification error                  -> lead flagged needs_review (the model failed, a human looks)
// everything else                       -> not a lead (stored, visible under "Hidden by AI")
// A language outside the workspace's allowed_languages hides the post too (decision D-34).

export const UNCLEAR_MIN_INTENT = 40;
export const CONFIDENCE_MIN = 0.5;

export type PromoteInput = {
  authorType: 'buyer' | 'seller' | 'spam' | 'irrelevant' | 'unclear';
  intentScore: number | null;
  confidence: number | null;
  language: string | null;
  error: string | null;
  /** Only set when the workspace has a confirmed Business Profile. */
  fit?: 'strong' | 'partial' | 'none' | null;
};

export type PromoteSettings = {
  leadThreshold: number;
  allowedLanguages: string[];
};

export type PromoteDecision = {
  isLead: boolean;
  needsReview: boolean;
  /** Why a post is not a lead, for the "Hidden by AI" view. */
  hiddenReason: string | null;
};

export function decidePromotion(c: PromoteInput, s: PromoteSettings): PromoteDecision {
  if (c.error) return { isLead: true, needsReview: true, hiddenReason: null };

  if (c.language && !s.allowedLanguages.includes(c.language)) {
    return { isLead: false, needsReview: false, hiddenReason: `language "${c.language}" is not allowed for this workspace` };
  }

  const intent = c.intentScore ?? 0;
  const confidence = c.confidence ?? 0;

  if (c.authorType === 'buyer') {
    if (intent >= s.leadThreshold) {
      // A buyer asking for something the business does not sell is kept, but flagged for a human look (never dropped silently).
      return { isLead: true, needsReview: confidence < CONFIDENCE_MIN || c.fit === 'none', hiddenReason: null };
    }
    return { isLead: false, needsReview: false, hiddenReason: `buyer, but intent ${intent} is below the threshold ${s.leadThreshold}` };
  }
  if (c.authorType === 'unclear') {
    if (intent >= UNCLEAR_MIN_INTENT) return { isLead: true, needsReview: true, hiddenReason: null };
    return { isLead: false, needsReview: false, hiddenReason: `unclear, intent ${intent} is below ${UNCLEAR_MIN_INTENT}` };
  }
  return { isLead: false, needsReview: false, hiddenReason: `classified as ${c.authorType}` };
}
