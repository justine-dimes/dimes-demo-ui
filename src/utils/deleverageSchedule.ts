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
// - The printed debt-clear price is the AT-ENTRY worst case: it is the price
//   at which selling the whole remaining position exactly repays the loan as
//   sized at entry. Every step that fires repays part of the loan, which
//   moves the LIVE exit line below the printed one: line = remainingLoan /
//   (remainingTokens × (1 − haircut(band))), mirroring the API's haircutBands
//   live-config. `simulateScheduleEvents` replays a straight decline against
//   that MOVING line: a printed step fires while its trigger still sits above
//   the live line; the moment the sweep reaches the live line, the exit fires
//   (selling just enough to repay the remaining loan) and no further forced
//   sales happen — remaining tokens ride
//   loan-free. At high leverage the live line starts near the first steps and
//   falls only slightly per sale, so the exit dominates early and deep
//   printed steps never fire on a straight decline; at low leverage the
//   ladder runs far ahead of the line and most steps fire first.
// - `scheduleStateAtPrice` reads that same event simulation at a probed
//   price, so the staircase chart, the what-if scrubber, and the narration
//   all agree with each other and with the mechanism.
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
  currentDebtClearLineUsd: number | null;
  nextEventPriceUsd: number | null;
  nextEventKind: 'step' | 'debt-clear' | null;
}

export interface ScheduleEvent {
  kind: 'step' | 'debt-clear';
  stepIndex: number | null;
  priceUsd: number;
  tokensSold: number;
  remainingFractionAfter: number;
  loanAfterUsd: number;
  lineAfterUsd: number | null;
}

// Mirrors the API's haircutBands live-config (spread + slippage per price band).
const HAIRCUT_BANDS = [
  { floorUsd: 0.5, ceilingUsd: Number.POSITIVE_INFINITY, haircut: 0.03 },
  { floorUsd: 0.2, ceilingUsd: 0.5, haircut: 0.08 },
  { floorUsd: 0, ceilingUsd: 0.2, haircut: 0.14 },
] as const;

export function solveDebtClearLineUsd(loanUsd: number, tokensHeld: number): number | null {
  if (loanUsd <= 0 || tokensHeld <= 0) return null;
  let deepestBandCandidate: number | null = null;
  for (const band of HAIRCUT_BANDS) {
    const candidate = loanUsd / (tokensHeld * (1 - band.haircut));
    const isConsistentWithBand = candidate >= band.floorUsd && candidate < band.ceilingUsd;
    if (isConsistentWithBand) return candidate;
    deepestBandCandidate = candidate;
  }
  // Band-boundary gap: fall back to the deepest band's (highest, most
  // conservative) estimate so the exit never renders later than it could fire.
  return deepestBandCandidate;
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

export function simulateScheduleEvents(walkthrough: ScheduleWalkthrough): ScheduleEvent[] {
  const { basis, stepRows } = walkthrough;
  const events: ScheduleEvent[] = [];
  let remainingFraction = 1;
  let loanUsd = basis.loanUsd;
  let lineUsd = solveDebtClearLineUsd(loanUsd, basis.positionTokens);

  const fireDebtClear = (atPriceUsd: number) => {
    const tokensHeld = basis.positionTokens * remainingFraction;
    const tokensSold = atPriceUsd > 0 ? Math.min(loanUsd / atPriceUsd, tokensHeld) : 0;
    loanUsd = Math.max(0, loanUsd - tokensSold * atPriceUsd);
    remainingFraction =
      basis.positionTokens > 0 ? (tokensHeld - tokensSold) / basis.positionTokens : 0;
    events.push({
      kind: 'debt-clear',
      stepIndex: null,
      priceUsd: atPriceUsd,
      tokensSold,
      remainingFractionAfter: remainingFraction,
      loanAfterUsd: loanUsd,
      lineAfterUsd: null,
    });
  };

  for (const row of stepRows) {
    const sweepHitsLineFirst = lineUsd != null && lineUsd > row.triggerPriceUsd;
    if (sweepHitsLineFirst) {
      fireDebtClear(lineUsd as number);
      return events;
    }
    const sellFraction = row.sellFractionBps / BPS_PER_UNIT;
    const tokensSold = basis.positionTokens * remainingFraction * sellFraction;
    loanUsd = Math.max(0, loanUsd - tokensSold * row.triggerPriceUsd);
    remainingFraction *= 1 - sellFraction;
    lineUsd = solveDebtClearLineUsd(loanUsd, basis.positionTokens * remainingFraction);
    events.push({
      kind: 'step',
      stepIndex: row.stepIndex,
      priceUsd: row.triggerPriceUsd,
      tokensSold,
      remainingFractionAfter: remainingFraction,
      loanAfterUsd: loanUsd,
      lineAfterUsd: lineUsd,
    });
    const sweepAlreadyBelowLine = lineUsd != null && lineUsd > row.triggerPriceUsd;
    if (sweepAlreadyBelowLine) {
      fireDebtClear(row.triggerPriceUsd);
      return events;
    }
    const loanFullyRepaidBySteps = loanUsd <= 0;
    if (loanFullyRepaidBySteps) {
      // Forced sales exist to protect the loan; with the loan repaid the
      // remaining printed steps never fire and the tokens ride loan-free.
      return events;
    }
  }
  if (lineUsd != null) fireDebtClear(lineUsd);
  return events;
}

export function scheduleStateAtPrice(
  walkthrough: ScheduleWalkthrough,
  priceUsd: number,
): ScheduleStateAtPrice {
  const { basis, stepRows, quietZoneFloorUsd } = walkthrough;
  const events = simulateScheduleEvents(walkthrough);

  let remainingFraction = 1;
  let loanRemainingUsd = basis.loanUsd;
  let currentDebtClearLineUsd = solveDebtClearLineUsd(loanRemainingUsd, basis.positionTokens);
  let firedStepCount = 0;
  let debtClearFired = false;
  let nextEvent: ScheduleEvent | null = null;

  for (const event of events) {
    if (priceUsd > event.priceUsd) {
      nextEvent = event;
      break;
    }
    remainingFraction = event.remainingFractionAfter;
    loanRemainingUsd = event.loanAfterUsd;
    currentDebtClearLineUsd = event.lineAfterUsd;
    if (event.kind === 'step') firedStepCount += 1;
    else debtClearFired = true;
  }

  return {
    priceUsd,
    firedStepCount,
    totalStepCount: stepRows.length,
    inQuietZone: firedStepCount === 0 && !debtClearFired && priceUsd >= quietZoneFloorUsd,
    debtClearFired,
    remainingFraction,
    tokensRemaining: basis.positionTokens * remainingFraction,
    loanRemainingUsd,
    currentDebtClearLineUsd,
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
