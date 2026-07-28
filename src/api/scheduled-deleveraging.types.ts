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
// cleared on tab close). Numbers are harness-true, from the tennis scenario:
// entry $0.52 at 2.25x on $44.44 collateral — 9 steps starting at $0.40
// spaced ~$0.0344 apart, selling ~15% each, debt cleared at $0.2978,
// refundable safety deposit $14.86.
// ---------------------------------------------------------------------------

const MOCK_SESSION_KEY = 'dimes.mockDeleverageSchedule';

const MOCK_FIRST_TRIGGER_USD = 0.4;
const MOCK_STEP_SPACING_USD = 0.0344;
const MOCK_STEP_COUNT = 9;
const MOCK_SELL_FRACTION_BPS = 1500;

const MOCK_SCHEDULE: DeleverageScheduleView = {
  entryBufferFloorPriceUsd: '0.4000',
  steps: Array.from({ length: MOCK_STEP_COUNT }, (_, i) => ({
    stepIndex: i,
    triggerPriceUsd: (MOCK_FIRST_TRIGGER_USD - i * MOCK_STEP_SPACING_USD).toFixed(4),
    sellFractionBps: MOCK_SELL_FRACTION_BPS,
  })),
  debtClearPriceUsd: '0.2978',
  safetyDepositRequiredUsd: '14.86',
  safetyDepositCollectedUsd: '14.86',
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
