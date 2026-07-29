import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import { ScheduledDeleveragingPanel } from './ScheduledDeleveragingPanel'

// Same real capture as the utils tests: tennis market, entry $0.51 at 2x on
// $250 collateral → $500 notional, $250 loan.
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
  timeTrims: [{ triggerElapsedFraction: 0.5, trimFractionBps: 2000 }],
  debtClearPriceUsd: '0.2750',
  safetyDepositRequiredUsd: '75.76',
  safetyDepositCollectedUsd: '75.76',
}

const basis = {
  entryPriceUsd: '0.51',
  notionalUsd: '500.00',
  collateralUsd: '250.00',
  positionTokenUnits: null,
}

function paragraphMatching(pattern: RegExp) {
  return screen.getByText(
    (_, element) => element?.tagName === 'P' && pattern.test(element.textContent ?? ''),
  )
}

function renderPanel(extraProps: Partial<Parameters<typeof ScheduledDeleveragingPanel>[0]> = {}) {
  return render(
    <ScheduledDeleveragingPanel schedule={schedule} basis={basis} side="yes" {...extraProps} />,
  )
}

describe('ScheduledDeleveragingPanel', () => {
  it('renders the computed plain-language summary', () => {
    renderPanel()
    const summary = paragraphMatching(/Nothing happens above/)
    expect(summary.textContent).toContain('$250.00')
    expect(summary.textContent).toContain('$75.76')
    expect(summary.textContent).toContain('$500.00 of YES at 51¢')
    expect(summary.textContent).toContain('Nothing happens above 48.5¢')
    expect(summary.textContent).toContain('first at 36¢ (14% of the position)')
    expect(summary.textContent).toContain('reaches 27.5¢')
  })

  it('renders every printed step with cumulative columns plus debt-clear and time-trim rows', () => {
    renderPanel()
    expect(screen.getByText('Loan after')).toBeInTheDocument()
    // First step: proceeds $49.55, loan remaining $200.45, cadence gap for step 2 is 2.9¢.
    expect(screen.getByText('$49.55')).toBeInTheDocument()
    expect(screen.getByText('$200.45')).toBeInTheDocument()
    expect(screen.getAllByText('2.9¢').length).toBeGreaterThan(0)
    // Debt-clear final row: repays the $109.67 left after all nine slices.
    expect(screen.getByText(/Debt-clear exit — fires the moment the price touches 27\.5¢/)).toBeInTheDocument()
    expect(screen.getAllByText('$109.67').length).toBeGreaterThan(0)
    expect(screen.getByText(/At 50% of game time, regardless of price/)).toBeInTheDocument()
    expect(screen.getByText('sell 20%')).toBeInTheDocument()
  })

  it('renders both charts and the refundable deposit rows', () => {
    renderPanel()
    expect(screen.getByText('Price Ladder')).toBeInTheDocument()
    expect(screen.getByText('Position Remaining')).toBeInTheDocument()
    expect(screen.getByText('quiet zone — no sales')).toBeInTheDocument()
    expect(screen.getByText('Safety deposit (refundable)')).toBeInTheDocument()
  })

  it('narrates the cumulative what-if state as the scrubber moves', () => {
    renderPanel()
    const slider = screen.getByRole('slider')

    fireEvent.change(slider, { target: { value: '0.33' } })
    const midLadder = paragraphMatching(/At 33¢:/)
    expect(midLadder.textContent).toContain('2 of 9 steps have fired')
    expect(midLadder.textContent).toContain('76%')
    expect(midLadder.textContent).toContain('$169.75')
    expect(midLadder.textContent).toContain('step at 30.2¢')

    fireEvent.change(slider, { target: { value: '0.5' } })
    expect(paragraphMatching(/inside your quiet zone/).textContent).toContain(
      'loan is unchanged at $250.00',
    )

    fireEvent.change(slider, { target: { value: '0.2' } })
    const belowExit = paragraphMatching(/debt-clear exit/)
    expect(belowExit.textContent).toContain('loan is fully repaid')
  })

  it('shows the engine-vs-schedule comparison only when asked to', () => {
    const { unmount } = renderPanel({ liquidationPriceUsd: '0.42', showComparison: true })
    expect(screen.getByText('Standard (today)')).toBeInTheDocument()
    expect(screen.getByText('Scheduled (this quote)')).toBeInTheDocument()
    expect(screen.getByText('42¢ liquidation')).toBeInTheDocument()
    expect(screen.getByText('9 printed steps')).toBeInTheDocument()
    unmount()

    renderPanel()
    expect(screen.queryByText('Standard (today)')).not.toBeInTheDocument()
  })

  it('falls back to the schedule-only table when the position numbers are unusable', () => {
    renderPanel({ basis: { ...basis, entryPriceUsd: 'not-a-number' } })
    expect(screen.getByText('Trigger price')).toBeInTheDocument()
    expect(screen.queryByText('Loan after')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})
