// ---------------------------------------------------------------------------
// Client-side helpers for the scheduled-deleveraging panel.
//
// The panel headlines two prices — the standard liquidation and the scheduled
// debt-clear exit — plus the refundable deposit, and lists the schedule's steps
// as a book-leverage ladder (the price each step fires at and the leverage it
// brings the position down to).
// ---------------------------------------------------------------------------

import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'

export interface ScheduleBasisInput {
  entryPriceUsd: string;
  notionalUsd: string;
  collateralUsd: string;
  positionTokenUnits?: string | null;
}

export interface ScheduleLeverageStep {
  triggerPriceUsd: string;
  bookLeverageBps: number;
  isDebtClear: boolean;
}

const BPS_PER_UNIT = 10000;

interface DeleverageTrigger {
  priceUsd: number;
  priceLabel: string;
  sellFractionBps: number;
  isDebtClear: boolean;
}

// Book leverage after each schedule trigger fires, in the order price actually crosses them as it
// FALLS (highest trigger first) — selling rungs AND the debt-clear backstop merged and sorted
// together. Book leverage = (remainingLoan + collateral) / collateral, floored at 1x, the same as
// the engine's `calculateNewBookLeverageBps`; it moves only as sale proceeds repay the loan, so it
// steps DOWN monotonically. The debt-clear repays whatever loan remains → 1x. Crucially, when a big
// loan puts the debt-clear ABOVE some rungs, it fires first and those lower rungs never matter: we
// stop the ladder the moment leverage reaches 1x. Zero-sell (quiet-zone) rungs are dropped.
export function computeScheduleLeverageSteps(
  schedule: Pick<DeleverageScheduleView, 'steps' | 'debtClearPriceUsd'>,
  basis: ScheduleBasisInput,
): ScheduleLeverageStep[] {
  const entryPriceUsd = Number(basis.entryPriceUsd)
  const notionalUsd = Number(basis.notionalUsd)
  const collateralUsd = Number(basis.collateralUsd)
  const hasValidBasis = entryPriceUsd > 0 && notionalUsd > 0 && collateralUsd > 0
  if (!hasValidBasis) {
    return []
  }

  const tokens0 = notionalUsd / entryPriceUsd
  let remainingLoanUsd = notionalUsd - collateralUsd
  const bookLeverageBps = (): number =>
    Math.max(BPS_PER_UNIT, Math.round(((remainingLoanUsd + collateralUsd) / collateralUsd) * BPS_PER_UNIT))

  const triggers: DeleverageTrigger[] = [
    ...schedule.steps
      .filter((step) => step.sellFractionBps > 0)
      .map((step) => ({
        priceUsd: Number(step.triggerPriceUsd),
        priceLabel: step.triggerPriceUsd,
        sellFractionBps: step.sellFractionBps,
        isDebtClear: false,
      })),
    {
      priceUsd: Number(schedule.debtClearPriceUsd),
      priceLabel: schedule.debtClearPriceUsd,
      sellFractionBps: 0,
      isDebtClear: true,
    },
  ].sort((a, b) => b.priceUsd - a.priceUsd)

  const leverageSteps: ScheduleLeverageStep[] = []
  for (const trigger of triggers) {
    if (trigger.isDebtClear) {
      remainingLoanUsd = 0
    } else {
      const proceedsUsd = (trigger.sellFractionBps / BPS_PER_UNIT) * tokens0 * trigger.priceUsd
      remainingLoanUsd = Math.max(0, remainingLoanUsd - proceedsUsd)
    }
    leverageSteps.push({
      triggerPriceUsd: trigger.priceLabel,
      bookLeverageBps: bookLeverageBps(),
      isDebtClear: trigger.isDebtClear,
    })
    // Loan repaid → 1x; nothing below this trigger can reduce leverage further.
    if (remainingLoanUsd <= 0) {
      break
    }
  }
  return leverageSteps
}

export function formatLeverageBps(bps: number): string {
  return `${(bps / BPS_PER_UNIT).toFixed(2)}x`
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
