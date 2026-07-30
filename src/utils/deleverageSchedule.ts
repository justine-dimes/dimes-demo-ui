// ---------------------------------------------------------------------------
// Client-side helpers for the scheduled-deleveraging panel.
//
// The panel headlines two prices — the standard liquidation and the scheduled
// debt-clear exit — plus the refundable deposit. It no longer renders the
// step-by-step ladder (proven largely vestigial for a naked guard: gradual
// cutting destroys value; the product is a deposit-backed backstop that repays
// the loan), so the ladder arithmetic that used to live here is gone.
// ---------------------------------------------------------------------------

export interface ScheduleBasisInput {
  entryPriceUsd: string;
  notionalUsd: string;
  collateralUsd: string;
  positionTokenUnits?: string | null;
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
