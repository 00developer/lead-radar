// Offline stand-in for the LLM. Used by tests and by `npm run pipeline:dry` so the whole pipeline can run
// without an API key, without network and without cost. It is a rough keyword heuristic, NOT a real classifier.

import type { Llm } from './llm';

export function createFakeLlm(): Llm {
  return {
    provider: 'fake',
    model: 'fake-heuristic',
    async complete(_system, user) {
      const text = (/text: """([\s\S]*)"""/.exec(user)?.[1] ?? '').toLowerCase();
      const seller = ['we offer', 'hire us', 'dm for', 'our agency', 'i am a', "i'm a", 'available for', 'i build'].some((k) => text.includes(k));
      const recruiting = ['hiring', 'send your cv', 'looking for freelancers', 'intern'].some((k) => text.includes(k));
      const buyer = ['need a', 'need an', 'looking for a', 'i need', 'want a', 'chahiye', 'banwana'].some((k) => text.includes(k));
      const authorType = recruiting ? 'irrelevant' : seller ? 'seller' : buyer ? 'buyer' : 'irrelevant';
      const isBuyer = authorType === 'buyer';
      const nonLatin = /[Ѐ-ӿ぀-ヿ一-鿿]/.test(text);
      const out = {
        author_type: authorType,
        service: isBuyer ? 'web_dev' : null,
        matched_offering: null,
        fit: null,
        intent_score: isBuyer ? 75 : 5,
        urgency: isBuyer ? 'medium' : null,
        budget: null,
        timeline: null,
        language: nonLatin ? 'other' : /chahiye|banwana|karo/.test(text) ? 'hinglish' : 'en',
        reason: '[DRY RUN] keyword heuristic, not a real model call',
        reply_draft: isBuyer ? 'Hi! This is a placeholder draft from the dry run.' : null,
        confidence: 0.6,
      };
      return { text: JSON.stringify(out), inputTokens: Math.ceil(user.length / 4), outputTokens: 120 };
    },
  };
}
