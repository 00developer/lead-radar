// Classifier evaluation on the owner-labeled golden set (docs/classifier.md section 7). Pure metrics, no I/O.

export type EvalItem = {
  id: string;
  text: string;
  ownerGenuine: boolean;
  /** The owner label after applying documented decisions made later (for example D-33). Same as ownerGenuine when there is none. */
  expectedGenuine: boolean;
  isLead: boolean;
  aiType: string;
  intent: number | null;
  failed?: boolean;
};

export type Metrics = {
  n: number;
  leads: number;
  genuineTotal: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  /** Share of leads that are genuine. This is the product metric (target 50% or more). */
  precision: number | null;
  /** Share of genuine posts that became leads. */
  recall: number | null;
};

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function computeMetrics(items: EvalItem[], useExpected: boolean): Metrics {
  const rows = items.filter((i) => !i.failed);
  const genuine = (i: EvalItem) => (useExpected ? i.expectedGenuine : i.ownerGenuine);
  const tp = rows.filter((i) => i.isLead && genuine(i)).length;
  const fp = rows.filter((i) => i.isLead && !genuine(i)).length;
  const fn = rows.filter((i) => !i.isLead && genuine(i)).length;
  return {
    n: rows.length,
    leads: tp + fp,
    genuineTotal: tp + fn,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
  };
}

export function confusion(items: EvalItem[], useExpected: boolean): Record<string, { genuine: number; notGenuine: number }> {
  const out: Record<string, { genuine: number; notGenuine: number }> = {};
  for (const i of items.filter((x) => !x.failed)) {
    const cell = (out[i.aiType] ??= { genuine: 0, notGenuine: 0 });
    if ((useExpected ? i.expectedGenuine : i.ownerGenuine)) cell.genuine += 1;
    else cell.notGenuine += 1;
  }
  return out;
}
