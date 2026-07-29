import { describe, expect, it } from 'vitest'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import {
  buildScheduleWalkthrough,
  formatCentsUsd,
  parseScheduleBasis,
  scheduleStateAtPrice,
  simulateScheduleEvents,
  solveDebtClearLineUsd,
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

describe('solveDebtClearLineUsd', () => {
  it('picks the haircut band the line itself lands in', () => {
    // 250 / (980.392 × (1 − 0.08)) — the 8% band, because the line sits in 20–50¢.
    expect(solveDebtClearLineUsd(250, 980.392)).toBeCloseTo(0.2772, 4)
    // High-leverage case lands above 50¢ → 3% band.
    expect(solveDebtClearLineUsd(300, 526.3)).toBeCloseTo(0.58765, 4)
  })

  it('returns null with no loan or no tokens', () => {
    expect(solveDebtClearLineUsd(0, 100)).toBeNull()
    expect(solveDebtClearLineUsd(10, 0)).toBeNull()
  })
})

describe('simulateScheduleEvents', () => {
  it('fires steps until the sweep meets the moving exit line, then clears and stops', () => {
    const events = simulateScheduleEvents(walkthrough())
    const stepEvents = events.filter((e) => e.kind === 'step')
    const clearEvents = events.filter((e) => e.kind === 'debt-clear')
    expect(stepEvents).toHaveLength(5)
    expect(clearEvents).toHaveLength(1)
    expect(clearEvents[0].priceUsd).toBeCloseTo(0.2291, 4)
    expect(clearEvents[0].remainingFractionAfter).toBeCloseTo(0.0468, 3)
    expect(clearEvents[0].loanAfterUsd).toBe(0)
    expect(events[events.length - 1]).toBe(clearEvents[0])
  })

  it('clears almost immediately when the initial line sits just under the first step', () => {
    const highLevSchedule: DeleverageScheduleView = {
      entryBufferFloorPriceUsd: '0.7220',
      steps: [
        { stepIndex: 0, triggerPriceUsd: '0.5900', sellFractionBps: 1300 },
        { stepIndex: 1, triggerPriceUsd: '0.5640', sellFractionBps: 1300 },
        { stepIndex: 2, triggerPriceUsd: '0.5380', sellFractionBps: 1300 },
      ],
      debtClearPriceUsd: '0.5877',
      safetyDepositRequiredUsd: '25.00',
      safetyDepositCollectedUsd: '25.00',
    }
    const basis = parseScheduleBasis({
      entryPriceUsd: '0.76',
      notionalUsd: '400.00',
      collateralUsd: '100.00',
      positionTokenUnits: null,
    })!
    const events = simulateScheduleEvents(buildScheduleWalkthrough(highLevSchedule, basis))
    expect(events.map((e) => e.kind)).toEqual(['step', 'debt-clear'])
    expect(events[1].priceUsd).toBeCloseTo(0.5845, 3)
    expect(events[1].remainingFractionAfter).toBeCloseTo(0.026, 2)
  })

  it('stops all forced selling once the printed steps repay the loan in full', () => {
    const lowLoanSchedule: DeleverageScheduleView = {
      entryBufferFloorPriceUsd: '0.4750',
      steps: [
        { stepIndex: 0, triggerPriceUsd: '0.4500', sellFractionBps: 1500 },
        { stepIndex: 1, triggerPriceUsd: '0.4200', sellFractionBps: 1500 },
      ],
      debtClearPriceUsd: '0.0543',
      safetyDepositRequiredUsd: '15.00',
      safetyDepositCollectedUsd: '15.00',
    }
    const basis = parseScheduleBasis({
      entryPriceUsd: '0.50',
      notionalUsd: '100.00',
      collateralUsd: '90.00',
      positionTokenUnits: null,
    })!
    const events = simulateScheduleEvents(buildScheduleWalkthrough(lowLoanSchedule, basis))
    expect(events.map((e) => e.kind)).toEqual(['step'])
    expect(events[0].loanAfterUsd).toBe(0)
    expect(events[0].lineAfterUsd).toBeNull()
  })
})

describe('scheduleStateAtPrice', () => {
  it('reports the quiet zone above the buffer floor, with the initial live line', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.5)
    expect(state.inQuietZone).toBe(true)
    expect(state.firedStepCount).toBe(0)
    expect(state.remainingFraction).toBe(1)
    expect(state.loanRemainingUsd).toBe(250)
    expect(state.currentDebtClearLineUsd).toBeCloseTo(0.2772, 4)
    expect(state.nextEventKind).toBe('step')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.36, 10)
  })

  it('accumulates fired steps and lowers the live line at a mid-ladder price', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.33)
    expect(state.firedStepCount).toBe(2)
    expect(state.remainingFraction).toBeCloseTo(0.765, 3)
    expect(state.loanRemainingUsd).toBeCloseTo(169.75, 2)
    expect(state.debtClearFired).toBe(false)
    expect(state.currentDebtClearLineUsd).toBeCloseTo(0.246, 3)
    expect(state.nextEventKind).toBe('step')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.3016, 10)
  })

  it('does NOT fire the exit at the printed at-entry price once steps have moved the line', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.273)
    expect(state.firedStepCount).toBe(3)
    expect(state.debtClearFired).toBe(false)
    expect(state.loanRemainingUsd).toBeCloseTo(147.79, 2)
    expect(state.currentDebtClearLineUsd).toBeCloseTo(0.2372, 3)
    expect(state.nextEventKind).toBe('step')
    expect(state.nextEventPriceUsd).toBeCloseTo(0.2724, 10)
  })

  it('fires the exit where the sweep meets the moving line and reports the ride-free tail', () => {
    const state = scheduleStateAtPrice(walkthrough(), 0.12)
    expect(state.firedStepCount).toBe(5)
    expect(state.debtClearFired).toBe(true)
    expect(state.loanRemainingUsd).toBe(0)
    expect(state.remainingFraction).toBeCloseTo(0.0468, 3)
    expect(state.currentDebtClearLineUsd).toBeNull()
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
