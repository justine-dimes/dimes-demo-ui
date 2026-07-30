import { describe, expect, it } from 'vitest'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import {
  buildScheduleWalkthrough,
  formatCentsUsd,
  parseScheduleBasis,
  scheduleStateAtPrice,
} from './deleverageSchedule'

// Same real capture as scheduled-deleveraging.types.test.ts (tennis market,
// entry $0.51, 2x on $250 collateral → $500 notional, $250 loan), already
// converted to the USD view model.
const schedule: DeleverageScheduleView = {
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
  debtClearPriceUsd: '0.2750',
  safetyDepositRequiredUsd: '75.76',
  safetyDepositCollectedUsd: '75.76',
}

const basisInput = {
  entryPriceUsd: '0.51',
  notionalUsd: '500.00',
  collateralUsd: '250.00',
  positionTokenUnits: null,
}

function walkthrough() {
  const basis = parseScheduleBasis(basisInput)
  expect(basis).not.toBeNull()
  return buildScheduleWalkthrough(schedule, basis!)
}

describe('parseScheduleBasis', () => {
  it('derives loan and estimated tokens from notional/entry when token units are absent', () => {
    const basis = parseScheduleBasis(basisInput)!
    expect(basis.loanUsd).toBe(250)
    expect(basis.positionTokens).toBeCloseTo(980.392, 3)
    expect(basis.tokensAreEstimated).toBe(true)
  })

  it('prefers exact token units when provided', () => {
    const basis = parseScheduleBasis({ ...basisInput, positionTokenUnits: '980392157' })!
    expect(basis.positionTokens).toBeCloseTo(980.392157, 6)
    expect(basis.tokensAreEstimated).toBe(false)
  })

  it.each([
    ['entryPriceUsd', '0'],
    ['entryPriceUsd', 'not-a-number'],
    ['notionalUsd', ''],
  ] as const)('returns null when %s is %s', (field, value) => {
    expect(parseScheduleBasis({ ...basisInput, [field]: value })).toBeNull()
  })
})

describe('buildScheduleWalkthrough', () => {
  it('computes multiplicative remaining size, proceeds, and loan progression per step', () => {
    const rows = walkthrough().stepRows
    expect(rows).toHaveLength(9)

    expect(rows[0].triggerPriceUsd).toBeCloseTo(0.36, 10)
    expect(rows[0].spacingUsd).toBeNull()
    expect(rows[0].dropFromEntryFraction).toBeCloseTo(0.2941, 4)
    expect(rows[0].tokensSold).toBeCloseTo(137.65, 2)
    expect(rows[0].proceedsUsd).toBeCloseTo(49.55, 2)
    expect(rows[0].remainingFractionAfter).toBeCloseTo(0.8596, 4)
    expect(rows[0].loanAfterUsd).toBeCloseTo(200.45, 2)

    expect(rows[1].spacingUsd).toBeCloseTo(0.0292, 4)
    expect(rows[1].remainingFractionAfter).toBeCloseTo(0.765, 3)
    expect(rows[1].loanAfterUsd).toBeCloseTo(169.75, 2)

    expect(rows[5].sellFractionBps).toBe(0)
    expect(rows[5].tokensSold).toBe(0)
    expect(rows[5].loanAfterUsd).toBeCloseTo(rows[4].loanAfterUsd, 10)

    expect(rows[8].remainingFractionAfter).toBeCloseTo(0.504, 3)
    expect(rows[8].loanAfterUsd).toBeCloseTo(109.67, 2)
  })

  it('reports cost-basis leverage: falls on the first step, stays >=1x, 1x at debt-clear', () => {
    const { basis, stepRows, debtClear } = walkthrough()
    const entryLeverage = basis.notionalUsd / basis.collateralUsd
    // 2x position: notional 500 / collateral 250 = 2.0x at entry.
    expect(entryLeverage).toBeCloseTo(2.0, 10)
    // First step (sold ~14% at 36¢, loan 250 → 200.45): 429.8 / (429.8 − 200.45).
    expect(stepRows[0].effectiveLeverageAfter).toBeCloseTo(1.874, 3)
    expect(stepRows[0].effectiveLeverageAfter!).toBeLessThan(entryLeverage)
    // A levered long is always >= 1x while any loan remains (not monotone deep:
    // realized losses on deep sales can nudge it back up before debt-clear).
    for (const row of stepRows) {
      if (row.effectiveLeverageAfter != null) {
        expect(row.effectiveLeverageAfter).toBeGreaterThanOrEqual(1)
      }
    }
    // Debt-clear repays the loan in full → unlevered, own the tokens outright.
    expect(debtClear.effectiveLeverageAfter).toBeCloseTo(1.0, 3)
  })

  it('sizes the debt-clear exit to repay exactly the loan left after all printed steps', () => {
    const { debtClear } = walkthrough()
    expect(debtClear.triggerPriceUsd).toBeCloseTo(0.275, 10)
    expect(debtClear.tokensSold).toBeCloseTo(398.81, 2)
    expect(debtClear.proceedsUsd).toBeCloseTo(109.67, 2)
    expect(debtClear.remainingFractionAfter).toBeCloseTo(0.0972, 3)
  })
})

describe('scheduleStateAtPrice (static printed schedule)', () => {
  it('reports the quiet zone above the buffer floor, before any step fires', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.5)
    expect(state.inQuietZone).toBe(true)
    expect(state.firedStepCount).toBe(0)
    expect(state.debtClearFired).toBe(false)
    expect(state.remainingFraction).toBe(1)
    expect(state.loanRemainingUsd).toBe(250)
    expect(state.nextEventKind).toBe('step')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.36, 10)
  })

  it('fires every printed step at or above the probed price, in order', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.33)
    expect(state.firedStepCount).toBe(2)
    expect(state.remainingFraction).toBeCloseTo(0.765, 3)
    expect(state.loanRemainingUsd).toBeCloseTo(169.75, 2)
    expect(state.debtClearFired).toBe(false)
    expect(state.nextEventKind).toBe('step')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.3016, 10)
  })

  it('fires the debt-clear exit at or below the printed at-entry price', () => {
    // debtClearPriceUsd is 27.5¢; at 27.3¢ the exit has fired and the loan is
    // repaid in full, regardless of how many printed steps preceded it.
    const state = scheduleStateAtPrice(walkthrough(), 0.273)
    expect(state.debtClearFired).toBe(true)
    expect(state.loanRemainingUsd).toBe(0)
    expect(state.remainingFraction).toBeCloseTo(0.0972, 3)
    expect(state.nextEventKind).toBeNull()
    expect(state.nextEventPriceUsd).toBeNull()
  })

  it('does NOT fire the debt-clear above its printed price, and names it as next', () => {
    // 28¢ sits just above the printed 27.5¢ debt-clear, which is itself above
    // the next step (27.24¢) — so the debt-clear is the next event on the way
    // down, priced at the printed at-entry bound.
    const state = scheduleStateAtPrice(walkthrough(), 0.28)
    expect(state.debtClearFired).toBe(false)
    expect(state.firedStepCount).toBe(3)
    expect(state.nextEventKind).toBe('debt-clear')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.275, 10)
  })

  it('reports the ride-free tail once the debt-clear has fired', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.12)
    expect(state.debtClearFired).toBe(true)
    expect(state.loanRemainingUsd).toBe(0)
    expect(state.remainingFraction).toBeCloseTo(0.0972, 3)
    expect(state.nextEventKind).toBeNull()
    expect(state.nextEventPriceUsd).toBeNull()
  })
})

describe('formatCentsUsd', () => {
  it.each([
    ['0.3600', '36¢'],
    ['0.4845', '48.5¢'],
    [0.275, '27.5¢'],
    [0.1264, '12.6¢'],
  ] as const)('formats %s as %s', (input, expected) => {
    expect(formatCentsUsd(input)).toBe(expected)
  })
})
