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

// ---------------------------------------------------------------------------
// Coherent price-sweep model.
//
// The printed ladder and the debt-clear backstop are two independent facts:
// the steps fire at fixed prices, the backstop fires at its printed
// `debtClearPriceUsd`. On a straight decline they interleave purely by price.
// This forward-simulates that decline so the table and chart never contradict
// each other. Once the backstop repays the loan, no further forced sells
// happen, so every event below it is part of the committed plan but is not
// reached on this decline.
//
// For the common case (backstop is the lowest-price event) this reproduces the
// old behaviour exactly: all steps fire top-down, backstop fires last, every
// event reached. Only "backstop-above-ladder" positions change: the backstop
// fires first and the steps beneath it are marked not-reached.
// ---------------------------------------------------------------------------

export type CoherentEventKind = 'step' | 'debt-clear';

export interface CoherentEvent {
  kind: CoherentEventKind;
  stepIndex: number | null;
  priceUsd: number;
  sellFractionOfCurrent: number;
  tokensSold: number;
  remainingFractionAfter: number;
  loanAfterUsd: number;
  reached: boolean;
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
  const debtClearRemainingFraction =
    basis.positionTokens > 0
      ? (tokensBeforeDebtClear - debtClearTokensSold) / basis.positionTokens
      : 0;
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
  };

  return { basis, quietZoneFloorUsd, debtClearPriceUsd, safetyDepositUsd, stepRows, debtClear };
}

interface PendingEvent {
  kind: CoherentEventKind;
  stepIndex: number | null;
  priceUsd: number;
  sellFractionBps: number | null;
}

// Forward-simulate a straight price decline over the printed steps plus the
// debt-clear backstop, ordered by price DESCENDING (price falls, so highest
// price fires first). The backstop price is the authoritative printed value —
// it is never invented or moved. Once the backstop repays the loan, selling
// stops: the backstop and every lower-price event are marked reached:false.
export function buildCoherentEvents(walkthrough: ScheduleWalkthrough): CoherentEvent[] {
  const { basis, stepRows, debtClearPriceUsd } = walkthrough;

  const pending: PendingEvent[] = stepRows.map((row) => ({
    kind: 'step',
    stepIndex: row.stepIndex,
    priceUsd: row.triggerPriceUsd,
    sellFractionBps: row.sellFractionBps,
  }));
  pending.push({
    kind: 'debt-clear',
    stepIndex: null,
    priceUsd: debtClearPriceUsd,
    sellFractionBps: null,
  });
  pending.sort((a, b) => b.priceUsd - a.priceUsd);

  let currentTokens = basis.positionTokens;
  let loanUsd = basis.loanUsd;
  let sellingStopped = false;

  return pending.map((event) => {
    if (sellingStopped) {
      return {
        kind: event.kind,
        stepIndex: event.stepIndex,
        priceUsd: event.priceUsd,
        sellFractionOfCurrent: 0,
        tokensSold: 0,
        remainingFractionAfter: basis.positionTokens > 0 ? currentTokens / basis.positionTokens : 0,
        loanAfterUsd: loanUsd,
        reached: false,
      };
    }

    let tokensSold: number;
    if (event.kind === 'step') {
      const sellFraction = event.sellFractionBps! / BPS_PER_UNIT;
      tokensSold = currentTokens * sellFraction;
    } else {
      tokensSold = event.priceUsd > 0 ? Math.min(loanUsd / event.priceUsd, currentTokens) : 0;
    }

    const sellFractionOfCurrent = currentTokens > 0 ? tokensSold / currentTokens : 0;
    const proceedsUsd = tokensSold * event.priceUsd;
    loanUsd = Math.max(0, loanUsd - proceedsUsd);
    currentTokens -= tokensSold;

    if (event.kind === 'debt-clear') {
      loanUsd = 0;
      sellingStopped = true;
    }

    return {
      kind: event.kind,
      stepIndex: event.stepIndex,
      priceUsd: event.priceUsd,
      sellFractionOfCurrent,
      tokensSold,
      remainingFractionAfter: basis.positionTokens > 0 ? currentTokens / basis.positionTokens : 0,
      loanAfterUsd: loanUsd,
      reached: true,
    };
  });
}

export interface StaircaseDrop {
  key: number | 'debt-clear';
  priceUsd: number;
  remainingBefore: number;
  remainingAfter: number;
}

// Staircase for the "Position Remaining" chart, built from the shared coherent
// price-sweep: one drop per REACHED event (steps and the backstop), in price
// order. After the backstop repays the loan the line goes flat — no phantom
// drops below it. For the common case (backstop lowest) this is the full
// staircase then the backstop drop at the bottom; for backstop-above-ladder it
// is flat down to the backstop, one drop, then flat below (the deeper steps are
// committed but not reached).
export function buildStaircaseDrops(walkthrough: ScheduleWalkthrough | null): StaircaseDrop[] {
  if (!walkthrough) return [];

  const events = buildCoherentEvents(walkthrough);
  let remainingBefore = 1;
  const drops: StaircaseDrop[] = [];
  for (const event of events) {
    if (!event.reached) continue;
    drops.push({
      key: event.kind === 'debt-clear' ? 'debt-clear' : event.stepIndex!,
      priceUsd: event.priceUsd,
      remainingBefore,
      remainingAfter: event.remainingFractionAfter,
    });
    remainingBefore = event.remainingFractionAfter;
  }
  return drops;
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
