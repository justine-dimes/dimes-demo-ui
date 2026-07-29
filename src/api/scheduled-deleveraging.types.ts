// ---------------------------------------------------------------------------
// SCHEDULED DELEVERAGING (sandbox-only preview)
//
// Parses the API's `deleverageSchedule` DTO field on offers and positions
// (ApiDeleverageSchedule: prices as USD-pip strings, deposits as USDC-unit
// strings, price steps and time-trim steps mixed in one `steps` array) into
// the USD-denominated view model the panel renders. The field is not in
// @dimes-dot-fi/sdk yet — once the API ships it, the wire types move to the
// SDK and this local mirror gets deleted in favor of re-exports from
// src/api/types.ts.
// ---------------------------------------------------------------------------

export interface DeleverageScheduleStep {
  stepIndex: number;
  triggerPriceUsd: string;
  sellFractionBps: number;
}

export interface DeleverageScheduleTimeTrim {
  triggerElapsedFraction: number;
  trimFractionBps: number;
}

export interface DeleverageScheduleView {
  entryBufferFloorPriceUsd: string;
  steps: DeleverageScheduleStep[];
  timeTrims?: DeleverageScheduleTimeTrim[];
  debtClearPriceUsd: string;
  safetyDepositRequiredUsd: string;
  safetyDepositCollectedUsd?: string;
}

// ---------------------------------------------------------------------------
// QA-ONLY MOCK — never ships as real data.
//
// Enable in DevTools, then reload:
//   sessionStorage.setItem('dimes.mockDeleverageSchedule', '1')
//
// Same sessionStorage gating as runtimeConfig.ts dev overrides (tab-scoped,
// cleared on tab close). Numbers are harness-true, from the real API capture
// in scheduled-deleveraging.types.test.ts (tennis market, entry $0.51 at 2x
// on $250 collateral): quiet-zone floor $0.4845, 9 steps from $0.36 down to
// $0.1264 spaced $0.0292 apart with varied sell fractions (incl. two zero-sell
// checkpoints), debt cleared at $0.2750, refundable safety deposit $75.76.
// The single time trim is illustrative (the soccer capture carried 0 bps) so
// the trim row is exercisable in QA.
// ---------------------------------------------------------------------------

const MOCK_SESSION_KEY = 'dimes.mockDeleverageSchedule';

const MOCK_SCHEDULE: DeleverageScheduleView = {
  entryBufferFloorPriceUsd: '0.4845',
  steps: [
    { stepIndex: 0, triggerPriceUsd: '0.3600', sellFractionBps: 1404 },
    { stepIndex: 1, triggerPriceUsd: '0.3308', sellFractionBps: 1101 },
    { stepIndex: 2, triggerPriceUsd: '0.3016', sellFractionBps: 971 },
    { stepIndex: 3, triggerPriceUsd: '0.2724', sellFractionBps: 855 },
    { stepIndex: 4, triggerPriceUsd: '0.2432', sellFractionBps: 751 },
    { stepIndex: 5, triggerPriceUsd: '0.2140', sellFractionBps: 0 },
    { stepIndex: 6, triggerPriceUsd: '0.1848', sellFractionBps: 0 },
    { stepIndex: 7, triggerPriceUsd: '0.1556', sellFractionBps: 658 },
    { stepIndex: 8, triggerPriceUsd: '0.1264', sellFractionBps: 765 },
  ],
  timeTrims: [{ triggerElapsedFraction: 0.5, trimFractionBps: 2000 }],
  debtClearPriceUsd: '0.2750',
  safetyDepositRequiredUsd: '75.76',
  safetyDepositCollectedUsd: '75.76',
};

function isMockEnabled(): boolean {
  try {
    return window.sessionStorage.getItem(MOCK_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

// Wire shapes (ApiDeleverageSchedule / ApiDeleverageScheduleStep from the API)

interface WirePriceStep {
  stepIndex: number;
  triggerPriceUsdPips: string;
  sellFractionBps: number;
}

interface WireTimeStep {
  stepIndex: number;
  triggerElapsedFraction: number;
  trimFractionBps: number;
}

const USD_PIPS_PER_USD = 10_000;
const USDC_UNITS_PER_USD = 1_000_000;
const PRICE_DISPLAY_DECIMALS = 4;
const USD_DISPLAY_DECIMALS = 2;

function pipsToUsd(pips: string): string | null {
  const value = Number(pips);
  if (!Number.isFinite(value)) return null;
  return (value / USD_PIPS_PER_USD).toFixed(PRICE_DISPLAY_DECIMALS);
}

function unitsToUsd(units: string): string | null {
  const value = Number(units);
  if (!Number.isFinite(value)) return null;
  return (value / USDC_UNITS_PER_USD).toFixed(USD_DISPLAY_DECIMALS);
}

function isWirePriceStep(value: unknown): value is WirePriceStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.stepIndex === 'number' &&
    typeof step.triggerPriceUsdPips === 'string' &&
    typeof step.sellFractionBps === 'number'
  );
}

function isWireTimeStep(value: unknown): value is WireTimeStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.stepIndex === 'number' &&
    typeof step.triggerElapsedFraction === 'number' &&
    typeof step.trimFractionBps === 'number'
  );
}

function parseSchedule(raw: unknown): DeleverageScheduleView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const schedule = raw as Record<string, unknown>;
  const hasValidWireSteps =
    Array.isArray(schedule.steps) &&
    schedule.steps.length > 0 &&
    schedule.steps.every(
      (step) => isWirePriceStep(step) || isWireTimeStep(step),
    );
  const hasValidPrices =
    typeof schedule.entryBufferFloorPriceUsdPips === 'string' &&
    typeof schedule.debtClearPriceUsdPips === 'string' &&
    typeof schedule.safetyDepositRequiredUsdcUnits === 'string' &&
    typeof schedule.safetyDepositCollectedUsdcUnits === 'string';
  if (!hasValidWireSteps || !hasValidPrices) return null;

  const wireSteps = schedule.steps as (WirePriceStep | WireTimeStep)[];
  const priceSteps: DeleverageScheduleStep[] = [];
  const timeTrims: DeleverageScheduleTimeTrim[] = [];
  for (const step of wireSteps) {
    if (isWirePriceStep(step)) {
      const triggerPriceUsd = pipsToUsd(step.triggerPriceUsdPips);
      if (triggerPriceUsd === null) return null;
      priceSteps.push({
        stepIndex: priceSteps.length,
        triggerPriceUsd,
        sellFractionBps: step.sellFractionBps,
      });
    } else {
      timeTrims.push({
        triggerElapsedFraction: step.triggerElapsedFraction,
        trimFractionBps: step.trimFractionBps,
      });
    }
  }
  if (priceSteps.length === 0) return null;

  const entryBufferFloorPriceUsd = pipsToUsd(
    schedule.entryBufferFloorPriceUsdPips as string,
  );
  const debtClearPriceUsd = pipsToUsd(schedule.debtClearPriceUsdPips as string);
  const safetyDepositRequiredUsd = unitsToUsd(
    schedule.safetyDepositRequiredUsdcUnits as string,
  );
  const safetyDepositCollectedUsd = unitsToUsd(
    schedule.safetyDepositCollectedUsdcUnits as string,
  );
  if (
    entryBufferFloorPriceUsd === null ||
    debtClearPriceUsd === null ||
    safetyDepositRequiredUsd === null ||
    safetyDepositCollectedUsd === null
  ) {
    return null;
  }

  return {
    entryBufferFloorPriceUsd,
    steps: priceSteps,
    timeTrims: timeTrims.length > 0 ? timeTrims : undefined,
    debtClearPriceUsd,
    safetyDepositRequiredUsd,
    safetyDepositCollectedUsd,
  };
}

/**
 * Reads the untyped `deleverageSchedule` field off an offer or position.
 * Returns null when the field is absent or malformed — this feeds a QA
 * panel, and absence is the normal state while the API flag is off.
 * With the QA mock enabled (see MOCK_SESSION_KEY above), absence falls
 * back to the sample schedule so the panel can be previewed today.
 */
export function getDeleverageSchedule(
  offerOrPosition: unknown,
): DeleverageScheduleView | null {
  if (typeof offerOrPosition === 'object' && offerOrPosition !== null) {
    const raw = (offerOrPosition as Record<string, unknown>).deleverageSchedule;
    const parsed = parseSchedule(raw);
    if (parsed) return parsed;
  }
  if (isMockEnabled()) return MOCK_SCHEDULE;
  return null;
}
