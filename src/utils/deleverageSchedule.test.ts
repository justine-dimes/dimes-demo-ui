import { describe, expect, it } from 'vitest'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import {
  buildCoherentEvents,
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

// Normal schedule: the debt-clear backstop (15¢) sits BELOW every printed step
// (40¢/30¢/20¢), so on a straight decline the steps fire top-down and the
// backstop fires last. Loan sized so the backstop still has work to do (320
// collateral → 180 loan) rather than being pre-cleared by the steps.
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
const normalBasisInput = {
  entryPriceUsd: '0.51',
  notionalUsd: '500.00',
  collateralUsd: '320.00',
  positionTokenUnits: null,
}

// Backstop-above-ladder: the debt-clear backstop (32.5¢) sits ABOVE the first
// printed step (31.5¢), so on a straight decline the backstop fires FIRST — it
// repays the whole loan — and every printed step beneath it is committed but
// never reached.
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

function coherentEvents(view: DeleverageScheduleView, input = basisInput) {
  const basis = parseScheduleBasis(input)
  expect(basis).not.toBeNull()
  return buildCoherentEvents(buildScheduleWalkthrough(view, basis!))
}

describe('buildCoherentEvents', () => {
  it('normal schedule (backstop lowest): steps fire top-down, backstop last, all reached', () => {
    const events = coherentEvents(normalSchedule, normalBasisInput)
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.kind)).toEqual(['step', 'step', 'step', 'debt-clear'])
    expect(events.map((e) => e.reached)).toEqual([true, true, true, true])
    // Steps chain multiplicatively off the surviving position.
    expect(events[0].priceUsd).toBeCloseTo(0.4, 10)
    expect(events[0].remainingFractionAfter).toBeCloseTo(0.85, 4)
    expect(events[0].loanAfterUsd).toBeCloseTo(121.18, 2)
    expect(events[2].loanAfterUsd).toBeCloseTo(62.43, 2)
    // Backstop fires last on the loan still outstanding after the steps.
    const backstop = events[3]
    expect(backstop.kind).toBe('debt-clear')
    expect(backstop.priceUsd).toBeCloseTo(0.15, 10)
    expect(backstop.sellFractionOfCurrent).toBeCloseTo(0.6912, 3)
    expect(backstop.remainingFractionAfter).toBeCloseTo(0.1896, 3)
    expect(backstop.loanAfterUsd).toBe(0)
  })

  it('backstop-above-ladder: backstop is first by price, fires on the full loan', () => {
    const events = coherentEvents(aboveLadderSchedule)
    expect(events).toHaveLength(4)
    // Sorted by price descending → backstop (32.5¢) leads, steps follow.
    expect(events[0].kind).toBe('debt-clear')
    expect(events[0].priceUsd).toBeCloseTo(0.325, 10)
    // Fires on the FULL $250 loan: 250 / 0.325 = 769.23 of 980.39 tokens = 78.5%.
    expect(events[0].tokensSold).toBeCloseTo(769.23, 2)
    expect(events[0].sellFractionOfCurrent).toBeCloseTo(0.7846, 3)
    expect(events[0].remainingFractionAfter).toBeCloseTo(0.2154, 3)
    expect(events[0].loanAfterUsd).toBe(0)
    expect(events[0].reached).toBe(true)
  })

  it('backstop-above-ladder: every step below the backstop is not reached and sells nothing', () => {
    const events = coherentEvents(aboveLadderSchedule)
    const steps = events.slice(1)
    expect(steps.map((e) => e.kind)).toEqual(['step', 'step', 'step'])
    expect(steps.every((e) => !e.reached)).toBe(true)
    expect(steps.every((e) => e.tokensSold === 0)).toBe(true)
    expect(steps.every((e) => e.sellFractionOfCurrent === 0)).toBe(true)
    // Remaining fraction and loan stay frozen at the post-backstop state.
    expect(steps.every((e) => e.remainingFractionAfter === events[0].remainingFractionAfter)).toBe(
      true,
    )
    expect(steps.every((e) => e.loanAfterUsd === 0)).toBe(true)
  })

  it('backstop-above-ladder: the debt-clear price is the authoritative printed value, unmoved', () => {
    const events = coherentEvents(aboveLadderSchedule)
    expect(events[0].priceUsd).toBe(Number(aboveLadderSchedule.debtClearPriceUsd))
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
