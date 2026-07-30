import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  DeleverageScheduleView,
  ShadowDeleverageView,
} from '../api/scheduled-deleveraging.types'
import type { PositionUnwindList } from '../api/types'
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

// Two shadow-fired steps + settlement, matching the schedule's first two
// triggers, and one real engine unwind between them.
const shadowDeleverage: ShadowDeleverageView = {
  steps: [
    {
      stepIndex: 0,
      triggerKind: 'scheduleStep',
      triggerPriceUsd: '0.3600',
      shadowRecordedBidUsd: '0.3580',
      tokensToSellTarget: 137.65,
      triggeredAt: '2026-07-28T18:04:12.000Z',
    },
    {
      stepIndex: 1,
      triggerKind: 'scheduleStep',
      triggerPriceUsd: '0.3308',
      shadowRecordedBidUsd: '0.3287',
      tokensToSellTarget: 92.79,
      triggeredAt: '2026-07-28T18:21:47.000Z',
    },
  ],
  settlement: {
    shadowStepsFired: 2,
    shadowEstimatedEndValueUsd: '203.45',
    engineEndValueUsd: '187.12',
    shadowSummaryComputedAt: '2026-07-28T20:00:00.000Z',
  },
}

const unwinds: PositionUnwindList = {
  data: [
    {
      executedAt: '2026-07-28T18:10:00.000Z',
      beforeLeverageBps: 20000,
      afterLeverageBps: 16000,
      reason: 'price_drop_moderate',
      reasonDetail: 'Price fell through a risk band.',
    },
  ],
  hasMore: false,
  currentLeverageBps: 16000,
  originatedAt: '2026-07-28T17:00:00.000Z',
  originationLeverageBps: 20000,
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
  it('frames the comparison as two parallel single-price cards, exit vs liquidation', () => {
    const { unmount } = renderPanel({ liquidationPriceUsd: '0.42', showComparison: true })
    expect(screen.getByText('Standard (today)')).toBeInTheDocument()
    expect(screen.getByText('Scheduled (shadow preview)')).toBeInTheDocument()
    expect(screen.getByText('shadow — not yet executing')).toBeInTheDocument()
    // Both cards headline a single price: standard liquidation vs scheduled exit.
    expect(screen.getByText('42¢ liquidation')).toBeInTheDocument()
    expect(screen.getByText('27.5¢ exit')).toBeInTheDocument()
    unmount()

    renderPanel()
    expect(screen.queryByText('Standard (today)')).not.toBeInTheDocument()
  })

  it('renders the short essentials line (entry, deposit, exit) under the cards', () => {
    renderPanel({ liquidationPriceUsd: '0.42', showComparison: true })
    const essentials = paragraphMatching(/Entry .*deposit .*exit/)
    expect(essentials.textContent).toContain('Entry 51¢')
    expect(essentials.textContent).toContain('$75.76 refundable')
    expect(essentials.textContent).toContain('exit 27.5¢')
  })

  it('renders the refundable deposit rows', () => {
    renderPanel()
    expect(screen.getByText('Safety deposit (refundable)')).toBeInTheDocument()
    // Deposit required + collected are both $75.76 in this fixture.
    expect(screen.getAllByText('$75.76')).toHaveLength(2)
    expect(screen.getByText(/Collected/)).toBeInTheDocument()
  })

  it('no longer renders the step table, ladder chart, or what-if scrubber', () => {
    renderPanel({ liquidationPriceUsd: '0.42', showComparison: true })
    expect(screen.queryByText('Loan after')).not.toBeInTheDocument()
    expect(screen.queryByText('Position Remaining')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByText(/What if the price fell to/)).not.toBeInTheDocument()
    expect(screen.queryByText(/printed steps/)).not.toBeInTheDocument()
  })

  it('renders the engine-vs-shadow timeline on positions', () => {
    renderPanel({ shadowDeleverage, unwinds })

    expect(screen.getByText('Engine vs Shadow Timeline')).toBeInTheDocument()
    expect(screen.getByText('Engine (actual)')).toBeInTheDocument()
    expect(screen.getByText('Schedule (shadow)')).toBeInTheDocument()
    // Settlement strip, with the fill assumption spelled out.
    expect(screen.getByText('$187.12')).toBeInTheDocument()
    expect(screen.getByText('~$203.45')).toBeInTheDocument()
    expect(screen.getByText('(2 shadow steps fired)')).toBeInTheDocument()
    expect(
      screen.getByText(/assumes every shadow step filled at its recorded bid/i),
    ).toBeInTheDocument()
  })

  it('shows the shadow caveat instead of the strip while there is no settlement yet', () => {
    renderPanel({
      shadowDeleverage: { ...shadowDeleverage, settlement: null },
      unwinds,
    })

    expect(screen.queryByText(/Schedule would have ended/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/recorded, not executed — the engine remains the position's real manager/),
    ).toBeInTheDocument()
  })

  it('renders no timeline when the position carries no shadow record', () => {
    renderPanel()
    expect(screen.queryByText('Engine vs Shadow Timeline')).not.toBeInTheDocument()
    expect(screen.queryByText(/fired in shadow/)).not.toBeInTheDocument()
  })
})
