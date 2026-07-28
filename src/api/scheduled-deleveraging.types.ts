// ---------------------------------------------------------------------------
// SCHEDULED DELEVERAGING (sandbox-only preview)
//
// Mirrors the API's upcoming `deleverageSchedule` DTO field on offers and
// positions. The field is not in @dimes-dot-fi/sdk yet — once the API ships
// it, these types move to the SDK and this local mirror gets deleted in
// favor of re-exports from src/api/types.ts.
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

function isScheduleStep(value: unknown): value is DeleverageScheduleStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.stepIndex === 'number' &&
    typeof step.triggerPriceUsd === 'string' &&
    typeof step.sellFractionBps === 'number'
  );
}

function isTimeTrim(value: unknown): value is DeleverageScheduleTimeTrim {
  if (typeof value !== 'object' || value === null) return false;
  const trim = value as Record<string, unknown>;
  return (
    typeof trim.triggerElapsedFraction === 'number' &&
    typeof trim.trimFractionBps === 'number'
  );
}

function parseSchedule(raw: unknown): DeleverageScheduleView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const schedule = raw as Record<string, unknown>;
  const hasValidSteps =
    Array.isArray(schedule.steps) &&
    schedule.steps.length > 0 &&
    schedule.steps.every(isScheduleStep);
  const hasValidTimeTrims =
    schedule.timeTrims === undefined ||
    (Array.isArray(schedule.timeTrims) && schedule.timeTrims.every(isTimeTrim));
  const isValid =
    hasValidSteps &&
    hasValidTimeTrims &&
    typeof schedule.entryBufferFloorPriceUsd === 'string' &&
    typeof schedule.debtClearPriceUsd === 'string' &&
    typeof schedule.safetyDepositRequiredUsd === 'string' &&
    (schedule.safetyDepositCollectedUsd === undefined ||
      typeof schedule.safetyDepositCollectedUsd === 'string');
  if (!isValid) return null;
  return schedule as unknown as DeleverageScheduleView;
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
