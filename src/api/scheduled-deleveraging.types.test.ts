import { describe, expect, it } from 'vitest'
import { getDeleverageSchedule } from './scheduled-deleveraging.types'

// Real ApiDeleverageSchedule captured from a local API offer (tennis market,
// entry 5100 pips, 2x leverage, $250 collateral), camelized exactly as the
// SDK's humps pass delivers it. The numbers are pip-exact against the
// family1-compare.py harness for the same inputs.
const realWireSchedule = {
  bandTableVersion: '2026-07-28.pace-p99.promise-menu-p90.v1',
  debtClearPriceUsdPips: '2750',
  entryBufferFloorPriceUsdPips: '4845',
  entryPriceUsdPips: '5100',
  gamePhaseAtOrigination: null,
  safetyDepositCollectedUsdcUnits: '75764706',
  safetyDepositRequiredUsdcUnits: '75764706',
  steps: [
    { sellFractionBps: 1404, stepIndex: 0, triggerPriceUsdPips: '3600' },
    { sellFractionBps: 1101, stepIndex: 1, triggerPriceUsdPips: '3308' },
    { sellFractionBps: 971, stepIndex: 2, triggerPriceUsdPips: '3016' },
    { sellFractionBps: 855, stepIndex: 3, triggerPriceUsdPips: '2724' },
    { sellFractionBps: 751, stepIndex: 4, triggerPriceUsdPips: '2432' },
    { sellFractionBps: 0, stepIndex: 5, triggerPriceUsdPips: '2140' },
    { sellFractionBps: 0, stepIndex: 6, triggerPriceUsdPips: '1848' },
    { sellFractionBps: 658, stepIndex: 7, triggerPriceUsdPips: '1556' },
    { sellFractionBps: 765, stepIndex: 8, triggerPriceUsdPips: '1264' },
  ],
}

const soccerWireSchedule = {
  ...realWireSchedule,
  gamePhaseAtOrigination: 'pregame',
  steps: [
    ...realWireSchedule.steps,
    { stepIndex: 9, triggerElapsedFraction: 0.5, trimFractionBps: 0 },
  ],
}

describe('getDeleverageSchedule', () => {
  it('parses a real API wire schedule into the USD view model', () => {
    const view = getDeleverageSchedule({ deleverageSchedule: realWireSchedule })

    expect(view).not.toBeNull()
    expect(view!.entryBufferFloorPriceUsd).toBe('0.4845')
    expect(view!.debtClearPriceUsd).toBe('0.2750')
    expect(view!.safetyDepositRequiredUsd).toBe('75.76')
    expect(view!.safetyDepositCollectedUsd).toBe('75.76')
    expect(view!.timeTrims).toBeUndefined()
    expect(view!.steps).toHaveLength(9)
    expect(view!.steps[0]).toEqual({
      stepIndex: 0,
      triggerPriceUsd: '0.3600',
      sellFractionBps: 1404,
    })
    expect(view!.steps[8]).toEqual({
      stepIndex: 8,
      triggerPriceUsd: '0.1264',
      sellFractionBps: 765,
    })
  })

  it('splits inline time-trim steps out of the price ladder', () => {
    const view = getDeleverageSchedule({ deleverageSchedule: soccerWireSchedule })

    expect(view).not.toBeNull()
    expect(view!.steps).toHaveLength(9)
    expect(view!.timeTrims).toEqual([
      { triggerElapsedFraction: 0.5, trimFractionBps: 0 },
    ])
  })

  it('returns null when the field is absent', () => {
    expect(getDeleverageSchedule({})).toBeNull()
  })

  it('returns null for a malformed schedule', () => {
    expect(
      getDeleverageSchedule({
        deleverageSchedule: { ...realWireSchedule, steps: [{ stepIndex: 0 }] },
      }),
    ).toBeNull()
  })
})
