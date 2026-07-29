import { describe, expect, it } from 'vitest'
import { getDeleverageSchedule, getShadowDeleverage } from './scheduled-deleveraging.types'

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

// Wire shape of the position DTO's shadowDeleverage field, SDK-camelized:
// two fired schedule steps plus the debt-clear (stepIndex -1), and a
// settlement summary. Values match the tennis schedule above.
const wireShadowDeleverage = {
  steps: [
    {
      stepIndex: 0,
      triggerKind: 'scheduleStep',
      triggerPriceUsdPips: '3600',
      shadowRecordedBidUsdPips: '3580',
      tokenUnitsToSellTarget: '137650000',
      triggeredAt: '2026-07-28T18:04:12.000Z',
    },
    {
      stepIndex: -1,
      triggerKind: 'debtClear',
      triggerPriceUsdPips: '2750',
      shadowRecordedBidUsdPips: '2731',
      tokenUnitsToSellTarget: '398810000',
      triggeredAt: '2026-07-28T19:40:03.000Z',
    },
  ],
  settlement: {
    shadowStepsFired: 2,
    shadowEstimatedEndValueUsdcUnits: '203450000',
    engineEndValueUsdcUnits: '187120000',
    shadowSummaryComputedAt: '2026-07-28T20:00:00.000Z',
  },
}

describe('getShadowDeleverage', () => {
  it('parses fired steps and the settlement summary into USD view models', () => {
    const view = getShadowDeleverage({ shadowDeleverage: wireShadowDeleverage })

    expect(view).not.toBeNull()
    expect(view!.steps).toHaveLength(2)
    expect(view!.steps[0]).toEqual({
      stepIndex: 0,
      triggerKind: 'scheduleStep',
      triggerPriceUsd: '0.3600',
      shadowRecordedBidUsd: '0.3580',
      tokensToSellTarget: 137.65,
      triggeredAt: '2026-07-28T18:04:12.000Z',
    })
    expect(view!.steps[1].stepIndex).toBe(-1)
    expect(view!.steps[1].triggerKind).toBe('debtClear')
    expect(view!.steps[1].tokensToSellTarget).toBeCloseTo(398.81, 10)
    expect(view!.settlement).toEqual({
      shadowStepsFired: 2,
      shadowEstimatedEndValueUsd: '203.45',
      engineEndValueUsd: '187.12',
      shadowSummaryComputedAt: '2026-07-28T20:00:00.000Z',
    })
  })

  it('parses a shadow record with no fired steps and no settlement yet', () => {
    const view = getShadowDeleverage({
      shadowDeleverage: { steps: [], settlement: null },
    })

    expect(view).toEqual({ steps: [], settlement: null })
  })

  it('returns null when the field is absent', () => {
    expect(getShadowDeleverage({})).toBeNull()
  })

  it('returns null for a malformed step', () => {
    expect(
      getShadowDeleverage({
        shadowDeleverage: {
          ...wireShadowDeleverage,
          steps: [{ stepIndex: 0, triggerKind: 'scheduleStep' }],
        },
      }),
    ).toBeNull()
  })

  it('returns null when a present settlement is malformed', () => {
    expect(
      getShadowDeleverage({
        shadowDeleverage: {
          ...wireShadowDeleverage,
          settlement: { shadowStepsFired: 2 },
        },
      }),
    ).toBeNull()
  })
})

describe('QA mock fallback', () => {
  it('serves the sample schedule and shadow record only while the session flag is set', () => {
    window.sessionStorage.setItem('dimes.mockDeleverageSchedule', '1')
    try {
      const schedule = getDeleverageSchedule({})
      const shadow = getShadowDeleverage({})
      expect(schedule).not.toBeNull()
      expect(shadow).not.toBeNull()
      expect(shadow!.steps).toHaveLength(2)
      expect(shadow!.steps.map((s) => s.triggerPriceUsd)).toEqual(
        schedule!.steps.slice(0, 2).map((s) => s.triggerPriceUsd),
      )
      expect(shadow!.settlement!.shadowStepsFired).toBe(2)
    } finally {
      window.sessionStorage.removeItem('dimes.mockDeleverageSchedule')
    }
    expect(getShadowDeleverage({})).toBeNull()
  })
})
