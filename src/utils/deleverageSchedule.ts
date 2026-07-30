import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types';

// ---------------------------------------------------------------------------
// Pure client-side arithmetic for the scheduled-deleveraging walkthrough.
//
// Model, in plain terms:
// - The printed ladder is FIXED and known at quote time: sell `sellFractionBps`
//   of the CURRENT (surviving) position at each trigger price, so remaining
//   size is multiplicative.
// - Estimated proceeds assume execution exactly at the trigger price (no
//   slippage) and are applied to the loan (notional - collateral at entry);
//   accrued fees are not modelled.
// - The debt-clear exit sells just enough tokens at its trigger price to repay
//   whatever loan is still outstanding, capped at the tokens still held. The
//   printed debt-clear price is the AT-ENTRY worst case: selling the whole
//   remaining position at it exactly repays the loan as sized at entry. Each
//   step that fires repays part of the loan, so the real exit can only clear
//   at or below the printed price — it is a knowable upper bound, not a
//   simulated exact price.
// - `scheduleStateAtPrice` reports the static state at a probed price: every
//   printed step whose trigger sits at/above the price has fired in order, and
//   the debt-clear has fired iff the price is at/below the printed debt-clear.
// ---------------------------------------------------------------------------

const BPS_PER_UNIT = 10_000;
const TOKEN_UNITS_PER_TOKEN = 1_000_000;

export interface ScheduleBasisInput {
  entryPriceUsd: string;
  notionalUsd: string;
  collateralUsd: string;
  positionTokenUnits?: string | null;
}

export interface ScheduleBasis {
  entryPriceUsd: number;
  notionalUsd: number;
  collateralUsd: number;
  loanUsd: number;
  positionTokens: number;
  tokensAreEstimated: boolean;
}

export interface ScheduleStepRow {
  stepIndex: number;
  triggerPriceUsd: number;
  dropFromEntryFraction: number;
  sellFractionBps: number;
  spacingUsd: number | null;
  tokensSold: number;
  proceedsUsd: number;
  remainingFractionAfter: number;
  loanAfterUsd: number;
  effectiveLeverageAfter: number | null;
}

// Cost-basis leverage = remaining position valued at ENTRY price / remaining
// equity. Entry-priced (not marked to the trigger) so it reflects the
// deleveraging action itself — selling down repays loan and lowers it toward
// 1x — rather than the market drop (which erodes equity and would raise a
// marked leverage). null once realized cost-basis losses exhaust equity.
function costBasisLeverage(
  notionalUsd: number,
  remainingFraction: number,
  loanRemainingUsd: number,
): number | null {
  const costValueUsd = notionalUsd * remainingFraction;
  const equityAtCostUsd = costValueUsd - loanRemainingUsd;
  return equityAtCostUsd > 0 ? costValueUsd / equityAtCostUsd : null;
}

export interface DebtClearRow {
  triggerPriceUsd: number;
  dropFromEntryFraction: number;
  sellFractionOfCurrentBps: number;
  tokensSold: number;
  proceedsUsd: number;
  remainingFractionAfter: number;
  effectiveLeverageAfter: number | null;
}

export interface ScheduleWalkthrough {
  basis: ScheduleBasis;
  quietZoneFloorUsd: number;
  debtClearPriceUsd: number;
  safetyDepositUsd: number;
  stepRows: ScheduleStepRow[];
  debtClear: DebtClearRow;
}

export interface ScheduleStateAtPrice {
  priceUsd: number;
  firedStepCount: number;
  totalStepCount: number;
  inQuietZone: boolean;
  debtClearFired: boolean;
  remainingFraction: number;
  tokensRemaining: number;
  loanRemainingUsd: number;
  nextEventPriceUsd: number | null;
  nextEventKind: 'step' | 'debt-clear' | null;
}

export function parseScheduleBasis(input: ScheduleBasisInput): ScheduleBasis | null {
  const entryPriceUsd = Number(input.entryPriceUsd);
  const notionalUsd = Number(input.notionalUsd);
  const collateralUsd = Number(input.collateralUsd);
  const isUsable =
    Number.isFinite(entryPriceUsd) &&
    entryPriceUsd > 0 &&
    Number.isFinite(notionalUsd) &&
    notionalUsd > 0 &&
    Number.isFinite(collateralUsd) &&
    collateralUsd >= 0;
  if (!isUsable) return null;

  const tokenUnits = input.positionTokenUnits != null ? Number(input.positionTokenUnits) : NaN;
  const hasTokenUnits = Number.isFinite(tokenUnits) && tokenUnits > 0;
  const positionTokens = hasTokenUnits
    ? tokenUnits / TOKEN_UNITS_PER_TOKEN
    : notionalUsd / entryPriceUsd;

  return {
    entryPriceUsd,
    notionalUsd,
    collateralUsd,
    loanUsd: Math.max(0, notionalUsd - collateralUsd),
    positionTokens,
    tokensAreEstimated: !hasTokenUnits,
  };
}

export function buildScheduleWalkthrough(
  schedule: DeleverageScheduleView,
  basis: ScheduleBasis,
): ScheduleWalkthrough {
  const quietZoneFloorUsd = Number(schedule.entryBufferFloorPriceUsd);
  const debtClearPriceUsd = Number(schedule.debtClearPriceUsd);
  const safetyDepositUsd = Number(schedule.safetyDepositRequiredUsd);

  const stepRows: ScheduleStepRow[] = [];
  let remainingFraction = 1;
  let loanUsd = basis.loanUsd;
  let previousTriggerUsd: number | null = null;

  for (const step of schedule.steps) {
    const triggerPriceUsd = Number(step.triggerPriceUsd);
    const sellFraction = step.sellFractionBps / BPS_PER_UNIT;
    const tokensSold = basis.positionTokens * remainingFraction * sellFraction;
    const proceedsUsd = tokensSold * triggerPriceUsd;
    loanUsd = Math.max(0, loanUsd - proceedsUsd);
    remainingFraction *= 1 - sellFraction;
    stepRows.push({
      stepIndex: step.stepIndex,
      triggerPriceUsd,
      dropFromEntryFraction: 1 - triggerPriceUsd / basis.entryPriceUsd,
      sellFractionBps: step.sellFractionBps,
      spacingUsd: previousTriggerUsd != null ? previousTriggerUsd - triggerPriceUsd : null,
      tokensSold,
      proceedsUsd,
      remainingFractionAfter: remainingFraction,
      loanAfterUsd: loanUsd,
      effectiveLeverageAfter: costBasisLeverage(basis.notionalUsd, remainingFraction, loanUsd),
    });
    previousTriggerUsd = triggerPriceUsd;
  }

  const tokensBeforeDebtClear = basis.positionTokens * remainingFraction;
  const debtClearTokensSold =
    debtClearPriceUsd > 0 ? Math.min(loanUsd / debtClearPriceUsd, tokensBeforeDebtClear) : 0;
  const debtClearRemainingFraction =
    basis.positionTokens > 0
      ? (tokensBeforeDebtClear - debtClearTokensSold) / basis.positionTokens
      : 0;
  const loanAfterDebtClear = Math.max(0, loanUsd - debtClearTokensSold * debtClearPriceUsd);
  const debtClear: DebtClearRow = {
    triggerPriceUsd: debtClearPriceUsd,
    dropFromEntryFraction: 1 - debtClearPriceUsd / basis.entryPriceUsd,
    sellFractionOfCurrentBps:
      tokensBeforeDebtClear > 0
        ? Math.round((debtClearTokensSold / tokensBeforeDebtClear) * BPS_PER_UNIT)
        : 0,
    tokensSold: debtClearTokensSold,
    proceedsUsd: debtClearTokensSold * debtClearPriceUsd,
    remainingFractionAfter: debtClearRemainingFraction,
    effectiveLeverageAfter: costBasisLeverage(
      basis.notionalUsd,
      debtClearRemainingFraction,
      loanAfterDebtClear,
    ),
  };

  return { basis, quietZoneFloorUsd, debtClearPriceUsd, safetyDepositUsd, stepRows, debtClear };
}

export function scheduleStateAtPrice(
  walkthrough: ScheduleWalkthrough,
  priceUsd: number,
): ScheduleStateAtPrice {
  const { basis, stepRows, quietZoneFloorUsd, debtClearPriceUsd, debtClear } = walkthrough;

  let remainingFraction = 1;
  let loanRemainingUsd = basis.loanUsd;
  let firedStepCount = 0;
  let nextStep: ScheduleStepRow | null = null;

  for (const row of stepRows) {
    const stepHasFired = row.triggerPriceUsd >= priceUsd;
    if (!stepHasFired) {
      nextStep = row;
      break;
    }
    remainingFraction = row.remainingFractionAfter;
    loanRemainingUsd = row.loanAfterUsd;
    firedStepCount += 1;
  }

  const debtClearFired = priceUsd <= debtClearPriceUsd;
  if (debtClearFired) {
    remainingFraction = debtClear.remainingFractionAfter;
    loanRemainingUsd = 0;
    nextStep = null;
  }

  // On a further decline the next thing to fire is the highest still-unfired
  // trigger below the probed price: the next printed step, or the debt-clear
  // exit if its (bounding) price sits above that step.
  const nextStepPriceUsd = nextStep?.triggerPriceUsd ?? null;
  const debtClearIsNext =
    !debtClearFired &&
    debtClearPriceUsd < priceUsd &&
    (nextStepPriceUsd == null || debtClearPriceUsd >= nextStepPriceUsd);
  const nextEventKind: 'step' | 'debt-clear' | null = debtClearFired
    ? null
    : debtClearIsNext
      ? 'debt-clear'
      : nextStepPriceUsd != null
        ? 'step'
        : null;
  const nextEventPriceUsd =
    nextEventKind === 'debt-clear'
      ? debtClearPriceUsd
      : nextEventKind === 'step'
        ? nextStepPriceUsd
        : null;

  return {
    priceUsd,
    firedStepCount,
    totalStepCount: stepRows.length,
    inQuietZone: firedStepCount === 0 && !debtClearFired && priceUsd >= quietZoneFloorUsd,
    debtClearFired,
    remainingFraction,
    tokensRemaining: basis.positionTokens * remainingFraction,
    loanRemainingUsd,
    nextEventPriceUsd,
    nextEventKind,
  };
}

const TENTHS_OF_CENT_PER_USD = 1000;
const CENTS_PER_TENTH = 10;
// Counters binary-representation shortfall (0.4845 → 484.4999…) so a true
// half-tenth rounds up as a human would expect.
const DISPLAY_ROUNDING_EPSILON = 1e-6;

/** "0.3600" → "36¢", "0.4845" → "48.5¢" (one decimal, trailing .0 dropped). */
export function formatCentsUsd(priceUsd: number | string): string {
  const usd = typeof priceUsd === 'string' ? Number(priceUsd) : priceUsd;
  const tenths = Math.round(usd * TENTHS_OF_CENT_PER_USD + DISPLAY_ROUNDING_EPSILON);
  return `${(tenths / CENTS_PER_TENTH).toFixed(1).replace(/\.0$/, '')}¢`;
}
