import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types';

// ---------------------------------------------------------------------------
// Pure client-side arithmetic for the scheduled-deleveraging walkthrough.
//
// Model, in plain terms:
// - The printed ladder sells `sellFractionBps` of the CURRENT (surviving)
//   position at each trigger price, so remaining size is multiplicative.
// - Estimated proceeds assume execution exactly at the trigger price (no
//   slippage) and are applied to the loan (notional - collateral at entry);
//   accrued fees are not modelled.
// - The debt-clear exit sells just enough tokens at its trigger price to repay
//   whatever loan is still outstanding, capped at the tokens still held.
// - `scheduleStateAtPrice` replays the plan for a price sweep: every printed
//   step whose trigger is at or above the probed price has fired (in printed
//   order), then the debt-clear exit fires if the price is at or below its
//   line. The printed debt-clear price can sit inside the ladder (the API
//   emits schedules where it does), so the exit is applied the moment the
//   sweep crosses it rather than only after the last slice.
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
}

export interface DebtClearRow {
  triggerPriceUsd: number;
  dropFromEntryFraction: number;
  sellFractionOfCurrentBps: number;
  tokensSold: number;
  proceedsUsd: number;
  remainingFractionAfter: number;
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
    });
    previousTriggerUsd = triggerPriceUsd;
  }

  const tokensBeforeDebtClear = basis.positionTokens * remainingFraction;
  const debtClearTokensSold =
    debtClearPriceUsd > 0 ? Math.min(loanUsd / debtClearPriceUsd, tokensBeforeDebtClear) : 0;
  const debtClear: DebtClearRow = {
    triggerPriceUsd: debtClearPriceUsd,
    dropFromEntryFraction: 1 - debtClearPriceUsd / basis.entryPriceUsd,
    sellFractionOfCurrentBps:
      tokensBeforeDebtClear > 0
        ? Math.round((debtClearTokensSold / tokensBeforeDebtClear) * BPS_PER_UNIT)
        : 0,
    tokensSold: debtClearTokensSold,
    proceedsUsd: debtClearTokensSold * debtClearPriceUsd,
    remainingFractionAfter:
      basis.positionTokens > 0
        ? (tokensBeforeDebtClear - debtClearTokensSold) / basis.positionTokens
        : 0,
  };

  return { basis, quietZoneFloorUsd, debtClearPriceUsd, safetyDepositUsd, stepRows, debtClear };
}

export function scheduleStateAtPrice(
  walkthrough: ScheduleWalkthrough,
  priceUsd: number,
): ScheduleStateAtPrice {
  const { basis, stepRows, debtClearPriceUsd, quietZoneFloorUsd } = walkthrough;

  let remainingFraction = 1;
  let loanRemainingUsd = basis.loanUsd;
  let firedStepCount = 0;
  let nextTriggerPriceUsd: number | null = null;

  for (const row of stepRows) {
    if (priceUsd <= row.triggerPriceUsd) {
      const sellFraction = row.sellFractionBps / BPS_PER_UNIT;
      const tokensSold = basis.positionTokens * remainingFraction * sellFraction;
      loanRemainingUsd = Math.max(0, loanRemainingUsd - tokensSold * row.triggerPriceUsd);
      remainingFraction *= 1 - sellFraction;
      firedStepCount += 1;
    } else if (nextTriggerPriceUsd == null) {
      nextTriggerPriceUsd = row.triggerPriceUsd;
    }
  }

  const debtClearFired = priceUsd <= debtClearPriceUsd;
  if (debtClearFired) {
    const tokensHeld = basis.positionTokens * remainingFraction;
    const tokensSold =
      debtClearPriceUsd > 0 ? Math.min(loanRemainingUsd / debtClearPriceUsd, tokensHeld) : 0;
    loanRemainingUsd = Math.max(0, loanRemainingUsd - tokensSold * debtClearPriceUsd);
    remainingFraction =
      basis.positionTokens > 0 ? (tokensHeld - tokensSold) / basis.positionTokens : 0;
  }

  const nextEventCandidates: { priceUsd: number; kind: 'step' | 'debt-clear' }[] = [];
  if (nextTriggerPriceUsd != null) {
    nextEventCandidates.push({ priceUsd: nextTriggerPriceUsd, kind: 'step' });
  }
  if (!debtClearFired) {
    nextEventCandidates.push({ priceUsd: debtClearPriceUsd, kind: 'debt-clear' });
  }
  nextEventCandidates.sort((a, b) => b.priceUsd - a.priceUsd);
  const nextEvent = nextEventCandidates[0] ?? null;

  return {
    priceUsd,
    firedStepCount,
    totalStepCount: stepRows.length,
    inQuietZone: firedStepCount === 0 && !debtClearFired && priceUsd >= quietZoneFloorUsd,
    debtClearFired,
    remainingFraction,
    tokensRemaining: basis.positionTokens * remainingFraction,
    loanRemainingUsd,
    nextEventPriceUsd: nextEvent?.priceUsd ?? null,
    nextEventKind: nextEvent?.kind ?? null,
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
