import { describe, expect, it } from 'vitest'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import {
  buildScheduleWalkthrough,
  buildStaircaseDrops,
  parseScheduleBasis,
} from '../utils/deleverageSchedule'

const basisInput = {
  entryPriceUsd: '0.51',
  notionalUsd: '500.00',
  collateralUsd: '250.00',
  positionTokenUnits: null,
}

// Backstop lowest: backstop (15¢) below every step; steps fire then the
// backstop drop at the bottom-right. Loan sized (320 collateral → 180 loan) so
// the backstop still trims something.
const normalSchedule: DeleverageScheduleView = {
  entryBufferFloorPriceUsd: '0.4845',
  steps: [
    { stepIndex: 0, triggerPriceUsd: '0.4000', sellFractionBps: 1500 },
    { stepIndex: 1, triggerPriceUsd: '0.3000', sellFractionBps: 1500 },
    { stepIndex: 2, triggerPriceUsd: '0.2000', sellFractionBps: 1500 },
  ],
  debtClearPriceUsd: '0.1500',
  safetyDepositRequiredUsd: '75.76',
  safetyDepositCollectedUsd: '75.76',
}
const normalBasisInput = { ...basisInput, collateralUsd: '320.00' }

// Backstop above ladder: backstop (32.5¢) above the first step (31.5¢). The
// backstop is the only drop; the deeper steps never fire so there is nothing
// below it — the line is flat below the backstop.
const aboveLadderSchedule: DeleverageScheduleView = {
  entryBufferFloorPriceUsd: '0.4845',
  steps: [
    { stepIndex: 0, triggerPriceUsd: '0.3150', sellFractionBps: 1500 },
    { stepIndex: 1, triggerPriceUsd: '0.2790', sellFractionBps: 1200 },
    { stepIndex: 2, triggerPriceUsd: '0.2430', sellFractionBps: 1000 },
  ],
  debtClearPriceUsd: '0.3250',
  safetyDepositRequiredUsd: '75.76',
  safetyDepositCollectedUsd: '75.76',
}

function drops(schedule: DeleverageScheduleView, input = basisInput) {
  const basis = parseScheduleBasis(input)
  expect(basis).not.toBeNull()
  return buildStaircaseDrops(buildScheduleWalkthrough(schedule, basis!))
}

describe('buildStaircaseDrops', () => {
  it('returns no drops when the walkthrough is missing', () => {
    expect(buildStaircaseDrops(null)).toEqual([])
  })

  it('normal schedule: staircase through the steps then the backstop drop last', () => {
    const staircase = drops(normalSchedule, normalBasisInput)
    expect(staircase.map((d) => d.key)).toEqual([0, 1, 2, 'debt-clear'])
    // Prices strictly descending → left-to-right, no phantom re-orderings.
    for (let i = 1; i < staircase.length; i += 1) {
      expect(staircase[i].priceUsd).toBeLessThan(staircase[i - 1].priceUsd)
    }
    // remainingBefore chains from the previous drop's remainingAfter.
    expect(staircase[0].remainingBefore).toBe(1)
    for (let i = 1; i < staircase.length; i += 1) {
      expect(staircase[i].remainingBefore).toBeCloseTo(staircase[i - 1].remainingAfter, 10)
    }
    expect(staircase[staircase.length - 1].key).toBe('debt-clear')
  })

  it('backstop-above-ladder: only the backstop drops, so the line is flat below it', () => {
    const staircase = drops(aboveLadderSchedule)
    // The single reached event is the backstop; the not-reached steps below it
    // produce no drops, so the chart is flat from the backstop price downward.
    expect(staircase).toHaveLength(1)
    expect(staircase[0].key).toBe('debt-clear')
    expect(staircase[0].priceUsd).toBeCloseTo(0.325, 10)
    expect(staircase[0].remainingBefore).toBe(1)
    expect(staircase[0].remainingAfter).toBeCloseTo(0.2154, 3)
    // No drop sits below the backstop price.
    const lowestPrice = Math.min(...staircase.map((d) => d.priceUsd))
    expect(lowestPrice).toBeCloseTo(0.325, 10)
  })
})
