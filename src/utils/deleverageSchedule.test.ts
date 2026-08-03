import { describe, expect, it } from 'vitest'
import { computeScheduleLeverageSteps, formatCentsUsd, formatLeverageBps } from './deleverageSchedule'

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

describe('computeScheduleLeverageSteps', () => {
  // Real tennis capture: entry $0.51, 2x on $250 collateral → $500 notional, $250 loan.
  const basis = { entryPriceUsd: '0.51', notionalUsd: '500.00', collateralUsd: '250.00' }
  const schedule = {
    debtClearPriceUsd: '0.2750',
    steps: [
      { stepIndex: 0, triggerPriceUsd: '0.3600', sellFractionBps: 1404 },
      { stepIndex: 1, triggerPriceUsd: '0.3308', sellFractionBps: 1101 },
      { stepIndex: 2, triggerPriceUsd: '0.2140', sellFractionBps: 0 },
    ],
  }

  it('steps book leverage DOWN monotonically and lands at 1x on the debt-clear', () => {
    const steps = computeScheduleLeverageSteps(schedule, basis)

    // Two selling rungs (the 0-sell rung is skipped) + the debt-clear.
    expect(steps).toHaveLength(3)
    // Step 0: sell 14.04% of 980.392 tokens at $0.36 = $49.553 repaid; loan 250 → 200.447;
    // book leverage (200.447 + 250) / 250 = 1.8018x.
    expect(steps[0]).toEqual({ triggerPriceUsd: '0.3600', bookLeverageBps: 18018, isDebtClear: false })
    // Step 1: another 11.01% at $0.3308 = $35.707 repaid; loan → 164.740; (164.740 + 250)/250 = 1.6590x.
    expect(steps[1]).toEqual({ triggerPriceUsd: '0.3308', bookLeverageBps: 16590, isDebtClear: false })
    // Debt-clear repays the rest → exactly 1x.
    expect(steps[2]).toEqual({ triggerPriceUsd: '0.2750', bookLeverageBps: 10000, isDebtClear: true })

    const leverages = steps.map((step) => step.bookLeverageBps)
    expect(leverages).toEqual([...leverages].sort((a, b) => b - a))
  })

  it('collapses to a single debt-clear step when the backstop sits above the rungs', () => {
    // High leverage (3x @ 91¢ → $750 notional, $500 loan) pushes the debt-clear to 62¢, ABOVE the
    // first rung (61.5¢). As price falls it hits 62¢ first, clears the loan, and the rungs below
    // never fire — so the ladder is just entry → debt-clear, not a fake descending trajectory.
    const highLevBasis = { entryPriceUsd: '0.91', notionalUsd: '750.00', collateralUsd: '250.00' }
    const backstopAboveLadder = {
      debtClearPriceUsd: '0.6200',
      steps: [
        { stepIndex: 0, triggerPriceUsd: '0.6150', sellFractionBps: 900 },
        { stepIndex: 1, triggerPriceUsd: '0.5860', sellFractionBps: 800 },
        { stepIndex: 2, triggerPriceUsd: '0.1000', sellFractionBps: 700 },
      ],
    }

    const steps = computeScheduleLeverageSteps(backstopAboveLadder, highLevBasis)

    expect(steps).toEqual([{ triggerPriceUsd: '0.6200', bookLeverageBps: 10000, isDebtClear: true }])
  })

  it('returns no steps when the basis is incomplete', () => {
    expect(computeScheduleLeverageSteps(schedule, { entryPriceUsd: '0', notionalUsd: '500', collateralUsd: '250' })).toEqual([])
  })
})

describe('formatLeverageBps', () => {
  it.each([
    [20000, '2.00x'],
    [16590, '1.66x'],
    [10000, '1.00x'],
  ] as const)('formats %d bps as %s', (bps, expected) => {
    expect(formatLeverageBps(bps)).toBe(expected)
  })
})
