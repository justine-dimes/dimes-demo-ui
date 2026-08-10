// ---------------------------------------------------------------------------
// COMMITTED UNWINDS (merged API #5311)
//
// Replaces the never-merged shadow-mode DTOs (`deleverageSchedule` /
// `shadowDeleverage`, see scheduled-deleveraging.types.ts, kept dormant).
// The merged surface:
// - offers carry `riskMode` + `committedUnwinds` (plan preview: margin
//   required, debt-clear price, planned rungs with target leverage)
// - positions carry `riskMode` + `lockedMarginUsd`
// - the unwinds endpoint returns `planned` / `triggered` / `superseded` rows
//   (trigger price + before/after leverage) alongside `executed` ones
// None of these fields are in @dimes-dot-fi/sdk (2.4.0) yet — local mirror
// until the SDK ships them.
// ---------------------------------------------------------------------------

export type RiskMode = 'adaptive' | 'committed';

export interface PlannedUnwindView {
  sequence: number;
  triggerPriceUsd: string;
  targetLeverageBps: number;
  estimatedSellTokens: string | null;
}

export interface CommittedUnwindsView {
  available: boolean;
  marginRequiredUsd: string | null;
  debtClearPriceUsd: string | null;
  plannedUnwinds: PlannedUnwindView[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function getRiskMode(offerOrPosition: unknown): RiskMode | null {
  const raw = asRecord(offerOrPosition)?.riskMode;
  return raw === 'committed' || raw === 'adaptive' ? raw : null;
}

export function getLockedMarginUsd(position: unknown): string | null {
  return asString(asRecord(position)?.lockedMarginUsd);
}

export function getCommittedUnwinds(offer: unknown): CommittedUnwindsView | null {
  const raw = asRecord(asRecord(offer)?.committedUnwinds);
  if (!raw) return null;

  const plannedRaw = Array.isArray(raw.plannedUnwinds) ? raw.plannedUnwinds : [];
  const plannedUnwinds: PlannedUnwindView[] = [];
  for (const entry of plannedRaw) {
    const row = asRecord(entry);
    const triggerPriceUsd = asString(row?.triggerPriceUsd);
    if (!row || triggerPriceUsd === null || typeof row.targetLeverageBps !== 'number') continue;
    plannedUnwinds.push({
      sequence: typeof row.sequence === 'number' ? row.sequence : plannedUnwinds.length,
      triggerPriceUsd,
      targetLeverageBps: row.targetLeverageBps,
      estimatedSellTokens: asString(row.estimatedSellTokens),
    });
  }

  return {
    available: raw.available === true,
    marginRequiredUsd: asString(raw.marginRequiredUsd),
    debtClearPriceUsd: asString(raw.debtClearPriceUsd),
    plannedUnwinds,
  };
}

// Unwind rows (positions): the endpoint now mixes executed history with the
// committed plan. Planned rows carry the trigger price and the target
// (after) leverage; superseded rows are rungs replaced by a newer plan.
export type CommittedUnwindRowStatus = 'executed' | 'planned' | 'superseded' | 'triggered';

export interface CommittedPlanRowView {
  status: CommittedUnwindRowStatus;
  triggerPriceUsd: string;
  afterLeverageBps: number;
}

export function getCommittedPlanRows(unwinds: unknown): CommittedPlanRowView[] {
  const list = asRecord(unwinds)?.data;
  if (!Array.isArray(list)) return [];
  const rows: CommittedPlanRowView[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    const status = row?.status;
    const isPlanRow = status === 'planned' || status === 'triggered';
    const triggerPriceUsd = asString(row?.triggerPriceUsd);
    if (!row || !isPlanRow || triggerPriceUsd === null || typeof row.afterLeverageBps !== 'number') continue;
    rows.push({ status, triggerPriceUsd, afterLeverageBps: row.afterLeverageBps });
  }
  return rows.sort((a, b) => Number(b.triggerPriceUsd) - Number(a.triggerPriceUsd));
}

export interface CommittedRung {
  triggerPriceUsd: string;
  leverageBps: number;
}

export function committedRungsFromPlan(view: CommittedUnwindsView): CommittedRung[] {
  return view.plannedUnwinds.map((rung) => ({
    triggerPriceUsd: rung.triggerPriceUsd,
    leverageBps: rung.targetLeverageBps,
  }));
}

export function committedRungsFromRows(rows: CommittedPlanRowView[]): CommittedRung[] {
  return rows.map((row) => ({ triggerPriceUsd: row.triggerPriceUsd, leverageBps: row.afterLeverageBps }));
}
