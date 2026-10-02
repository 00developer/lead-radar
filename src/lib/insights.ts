// Phase 3 tuning maths (docs/roadmap.md Phase 3). Pure functions: they turn the owner's labels into numbers that show which
// keywords work, which intent scores are trustworthy, and what a different lead threshold would have done.
// Nothing here changes any setting: it only gives advice, and the owner decides.

export type InsightRow = {
  intent_score: number | null;
  review_label: 'genuine' | 'not_genuine' | null;
  matched_keyword: string | null;
  service: string | null;
  language: string | null;
  source: string;
};

export type Group = { key: string; total: number; labeled: number; genuine: number; rate: number | null };

export type ThresholdRow = {
  threshold: number;
  /** Labeled leads that would still be leads at this threshold. */
  keptLabeled: number;
  keptGenuine: number;
  /** Share of kept labeled leads that are genuine. */
  precision: number | null;
  /** Labeled genuine leads that would be lost (their intent is below the threshold). */
  genuineLost: number;
  /** Share of all labeled genuine leads that are kept. */
  recall: number | null;
};

export type Insights = {
  total: number;
  labeled: number;
  genuine: number;
  /** Genuine share of labeled leads: the product metric (target 50% or more). */
  rate: number | null;
  targetRate: number;
  byKeyword: Group[];
  byService: Group[];
  byLanguage: Group[];
  bySource: Group[];
  byIntentBand: Group[];
  thresholds: ThresholdRow[];
  advice: string[];
  /** True when there are too few labels to trust the numbers. */
  fewLabels: boolean;
};

export const MIN_LABELS_FOR_TRUST = 30;
export const MIN_LABELS_FOR_ADVICE = 5;
export const THRESHOLDS = [40, 50, 60, 65, 70, 75, 80, 85, 90];

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
export const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

function group(rows: InsightRow[], keyOf: (r: InsightRow) => string): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = map.get(key) ?? { key, total: 0, labeled: 0, genuine: 0, rate: null };
    g.total += 1;
    if (r.review_label) {
      g.labeled += 1;
      if (r.review_label === 'genuine') g.genuine += 1;
    }
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, rate: ratio(g.genuine, g.labeled) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function intentBand(score: number | null): string {
  if (score === null) return 'no score';
  if (score >= 90) return '90 to 100';
  if (score >= 80) return '80 to 89';
  if (score >= 70) return '70 to 79';
  if (score >= 60) return '60 to 69';
  return 'below 60';
}

export function computeInsights(rows: InsightRow[], targetRate = 0.5): Insights {
  const labeledRows = rows.filter((r) => r.review_label);
  const genuineRows = labeledRows.filter((r) => r.review_label === 'genuine');

  const thresholds: ThresholdRow[] = THRESHOLDS.map((t) => {
    const kept = labeledRows.filter((r) => (r.intent_score ?? 0) >= t);
    const keptGenuine = kept.filter((r) => r.review_label === 'genuine').length;
    return {
      threshold: t,
      keptLabeled: kept.length,
      keptGenuine,
      precision: ratio(keptGenuine, kept.length),
      genuineLost: genuineRows.length - keptGenuine,
      recall: ratio(keptGenuine, genuineRows.length),
    };
  });

  const byKeyword = group(rows, (r) => r.matched_keyword ?? '(unknown)');
  const byIntentBand = group(rows, (r) => intentBand(r.intent_score));
  // Keep the bands in a sensible order instead of by size.
  const bandOrder = ['90 to 100', '80 to 89', '70 to 79', '60 to 69', 'below 60', 'no score'];
  byIntentBand.sort((a, b) => bandOrder.indexOf(a.key) - bandOrder.indexOf(b.key));

  const rate = ratio(genuineRows.length, labeledRows.length);
  const fewLabels = labeledRows.length < MIN_LABELS_FOR_TRUST;
  const advice: string[] = [];

  if (labeledRows.length === 0) {
    advice.push('No leads are labeled yet. Open a lead and press "Genuine lead" or "Not a real lead". About 30 labels give the first useful numbers.');
  } else {
    if (rate !== null) {
      advice.push(
        rate >= targetRate
          ? `The genuine rate is ${pct(rate)}, at or above the ${pct(targetRate)} target.`
          : `The genuine rate is ${pct(rate)}, below the ${pct(targetRate)} target. The keyword and threshold advice below is where to start.`,
      );
    }
    if (fewLabels) advice.push(`Only ${labeledRows.length} lead(s) are labeled. Treat everything here as a first hint, not a result (about ${MIN_LABELS_FOR_TRUST} labels are needed).`);

    for (const g of byKeyword) {
      if (g.labeled < MIN_LABELS_FOR_ADVICE || g.rate === null) continue;
      if (g.rate < 0.3) advice.push(`Keyword "${g.key}": only ${pct(g.rate)} genuine in ${g.labeled} labeled leads. Consider disabling it on the Keywords page.`);
      else if (g.rate >= 0.7) advice.push(`Keyword "${g.key}": ${pct(g.rate)} genuine in ${g.labeled} labeled leads. It works well, keep it.`);
    }

    // Suggest the lowest threshold that reaches the target precision while keeping at least 85% of the genuine leads.
    if (labeledRows.length >= 20) {
      const ok = thresholds.find((t) => t.precision !== null && t.precision >= targetRate && (t.recall ?? 0) >= 0.85);
      const current = thresholds.find((t) => t.threshold === 60);
      if (ok && current && ok.threshold !== 60) {
        advice.push(`A lead threshold of ${ok.threshold} would have given ${pct(ok.precision)} genuine while keeping ${pct(ok.recall)} of the genuine leads (the current threshold of 60 gives ${pct(current.precision)}). Change it in Settings if you agree.`);
      } else if (!ok) {
        advice.push('No threshold reaches the target precision while keeping most genuine leads. The keywords or the AI prompt need work before the threshold can help.');
      }
    }
  }

  return {
    total: rows.length,
    labeled: labeledRows.length,
    genuine: genuineRows.length,
    rate,
    targetRate,
    byKeyword,
    byService: group(rows, (r) => r.service ?? 'other'),
    byLanguage: group(rows, (r) => r.language ?? 'unknown'),
    bySource: group(rows, (r) => r.source),
    byIntentBand,
    thresholds,
    advice,
    fewLabels,
  };
}
