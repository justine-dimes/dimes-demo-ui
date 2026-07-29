import { useMemo, useState } from 'react'
import type {
  DeleverageScheduleView,
  DeleverageScheduleStep,
  ShadowDeleverageView,
} from '../api/scheduled-deleveraging.types'
import type { PositionUnwindList } from '../api/types'
import type {
  ScheduleBasisInput,
  ScheduleWalkthrough,
} from '../utils/deleverageSchedule'
import {
  buildScheduleWalkthrough,
  formatCentsUsd,
  parseScheduleBasis,
  scheduleStateAtPrice,
} from '../utils/deleverageSchedule'
import { StatRow } from './StatRow'
import { StatGroup } from './CardViewParts'
import {
  DeleverageScheduleCharts,
  DEBT_CLEAR_COLOR,
  type ScheduleHoverKey,
} from './DeleverageScheduleCharts'
import { ShadowDeleverageTimeline } from './ShadowDeleverageTimeline'

const LIQUIDATION_COLOR = '#F5A623'
const PCT_PER_FRACTION = 100
const BPS_PER_PCT = 100

const cellFont = {
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
} as const

export function ScheduledDeleveragingPanel({
  schedule,
  basis,
  side,
  currentPriceUsd,
  liquidationPriceUsd,
  showComparison,
  shadowDeleverage,
  unwinds,
  last,
}: {
  schedule: DeleverageScheduleView
  basis: ScheduleBasisInput
  side?: 'yes' | 'no'
  currentPriceUsd?: string
  liquidationPriceUsd?: string
  showComparison?: boolean
  shadowDeleverage?: ShadowDeleverageView | null
  unwinds?: PositionUnwindList
  last?: boolean
}) {
  const walkthrough = useMemo(() => {
    const parsed = parseScheduleBasis(basis)
    return parsed ? buildScheduleWalkthrough(schedule, parsed) : null
  }, [schedule, basis])

  const [hoverKey, setHoverKey] = useState<ScheduleHoverKey>(null)

  const currentPrice = currentPriceUsd != null ? parseFloat(currentPriceUsd) : null
  const usableCurrentPrice =
    currentPrice != null && Number.isFinite(currentPrice) ? currentPrice : null

  const [scrubPriceUsd, setScrubPriceUsd] = useState<number | null>(null)

  // Ladder lines the shadow run has fired, keyed the way the ladder knows
  // them: 4-decimal trigger-price strings plus 'debt-clear'.
  const shadowFiredKeys = useMemo(() => {
    if (shadowDeleverage == null || shadowDeleverage.steps.length === 0) return undefined
    const keys = new Set<string>()
    for (const step of shadowDeleverage.steps) {
      keys.add(step.triggerKind === 'debtClear' ? 'debt-clear' : step.triggerPriceUsd)
    }
    return keys
  }, [shadowDeleverage])

  return (
    <StatGroup label="Scheduled Deleveraging (shadow)" last={last}>
      {showComparison && liquidationPriceUsd != null && (
        <ProtectionComparison
          schedule={schedule}
          walkthrough={walkthrough}
          liquidationPriceUsd={liquidationPriceUsd}
        />
      )}

      {walkthrough && <PlanSummary schedule={schedule} walkthrough={walkthrough} side={side} />}

      <WalkthroughTable
        schedule={schedule}
        walkthrough={walkthrough}
        hoverKey={hoverKey}
        onHoverKey={setHoverKey}
      />

      <DeleverageScheduleCharts
        schedule={schedule}
        walkthrough={walkthrough}
        currentPriceUsd={usableCurrentPrice}
        scrubPriceUsd={scrubPriceUsd}
        hoverKey={hoverKey}
        onHoverKey={setHoverKey}
        shadowFiredKeys={shadowFiredKeys}
      />

      {shadowDeleverage != null && (
        <ShadowDeleverageTimeline shadow={shadowDeleverage} unwinds={unwinds} />
      )}

      {walkthrough && (
        <WhatIfScrubber
          walkthrough={walkthrough}
          initialPriceUsd={usableCurrentPrice}
          scrubPriceUsd={scrubPriceUsd}
          onScrub={setScrubPriceUsd}
        />
      )}

      <div style={{ marginTop: 8 }}>
        <StatRow
          label="Safety deposit (refundable)"
          value={`$${schedule.safetyDepositRequiredUsd}`}
        />
        {schedule.safetyDepositCollectedUsd != null && (
          <StatRow nested label="Collected" value={`$${schedule.safetyDepositCollectedUsd}`} />
        )}
      </div>
    </StatGroup>
  )
}

// ---------------------------------------------------------------------------
// Engine vs schedule, side by side, in plain language. Shadow framing: the
// engine still manages every position; the schedule card previews the
// proposed mechanism the API now computes and runs in shadow on every
// eligible quote — nothing the user selected, nothing that executes.
// ---------------------------------------------------------------------------

function ProtectionComparison({
  schedule,
  walkthrough,
  liquidationPriceUsd,
}: {
  schedule: DeleverageScheduleView
  walkthrough: ScheduleWalkthrough | null
  liquidationPriceUsd: string
}) {
  const stepCount = schedule.steps.length
  const firstTrigger = schedule.steps[0]?.triggerPriceUsd
  const lastTrigger = schedule.steps[stepCount - 1]?.triggerPriceUsd

  const cardStyle = {
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.02)',
    padding: '10px 12px',
    minWidth: 0,
  } as const
  const headStyle = {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 6,
  } as const
  const bodyStyle = {
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--text-muted)',
  } as const

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 8,
        margin: '4px 0 10px',
      }}
    >
      <div style={cardStyle}>
        <div style={{ ...headStyle, color: 'var(--text-dim)' }}>Standard (today)</div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: LIQUIDATION_COLOR,
            fontVariantNumeric: 'tabular-nums',
            marginBottom: 6,
          }}
        >
          {formatCentsUsd(liquidationPriceUsd)} liquidation
        </div>
        <div style={bodyStyle}>
          One liquidation price. Below it, the risk engine sells for you in real time — amounts
          and timing decided in the moment. This is what actually manages your position.
        </div>
      </div>
      <div style={{ ...cardStyle, borderColor: 'rgba(91,156,245,0.35)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ ...headStyle, color: DEBT_CLEAR_COLOR }}>Scheduled (shadow preview)</div>
          <span
            style={{
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: DEBT_CLEAR_COLOR,
              border: '1px solid rgba(91,156,245,0.4)',
              padding: '1px 5px',
              whiteSpace: 'nowrap',
              marginBottom: 6,
            }}
          >
            shadow — not yet executing
          </span>
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums',
            marginBottom: 6,
          }}
        >
          {stepCount} printed steps
          {firstTrigger != null && lastTrigger != null && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
              {' '}· {formatCentsUsd(firstTrigger)} → {formatCentsUsd(lastTrigger)}
            </span>
          )}
        </div>
        <div style={bodyStyle}>
          A preview of the proposed mechanism, computed automatically for every eligible quote
          and run in shadow alongside the engine. Only the pre-committed slices below would
          ever fire, plus a debt-clear exit at most{' '}
          <span style={{ color: DEBT_CLEAR_COLOR }}>{formatCentsUsd(schedule.debtClearPriceUsd)}</span>{' '}
          (the line falls as steps repay). Would be backed by a $
          {walkthrough ? walkthrough.safetyDepositUsd.toFixed(2) : schedule.safetyDepositRequiredUsd}{' '}
          refundable deposit — every sale visible before it could ever happen.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plain-language summary, computed from the schedule + position numbers.
// ---------------------------------------------------------------------------

function PlanSummary({
  schedule,
  walkthrough,
  side,
}: {
  schedule: DeleverageScheduleView
  walkthrough: ScheduleWalkthrough
  side?: 'yes' | 'no'
}) {
  const { basis } = walkthrough
  const firstStep = schedule.steps[0]
  const positionPhrase = side != null ? `of ${side.toUpperCase()}` : 'of the position'

  return (
    <p
      style={{
        margin: '4px 0 10px',
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--text-muted)',
      }}
    >
      Under this plan you'd put in{' '}
      <strong style={{ color: 'var(--text)' }}>${basis.collateralUsd.toFixed(2)}</strong> + a{' '}
      <strong style={{ color: 'var(--text)' }}>${walkthrough.safetyDepositUsd.toFixed(2)}</strong>{' '}
      refundable deposit and control{' '}
      <strong style={{ color: 'var(--text)' }}>${basis.notionalUsd.toFixed(2)}</strong> {positionPhrase} at{' '}
      <strong style={{ color: 'var(--text)' }}>{formatCentsUsd(basis.entryPriceUsd)}</strong>. Nothing
      happens above{' '}
      <strong style={{ color: 'var(--text)' }}>{formatCentsUsd(walkthrough.quietZoneFloorUsd)}</strong>{' '}
      (your quiet zone). If the price falls, the plan sells small pre-set slices at the{' '}
      {schedule.steps.length} printed prices below — first at{' '}
      <strong style={{ color: 'var(--text)' }}>{formatCentsUsd(firstStep.triggerPriceUsd)}</strong>{' '}
      ({(firstStep.sellFractionBps / BPS_PER_PCT).toFixed(0)}% of the position). A debt-clear exit
      sells just enough to repay the loan entirely at{' '}
      <strong style={{ color: DEBT_CLEAR_COLOR }}>
        at most {formatCentsUsd(walkthrough.debtClearPriceUsd)}
      </strong>{' '}
      — each slice repays part of the loan, so the exit line falls as steps fire. Worst case you
      lose your collateral; the deposit comes back unless a crash gaps past the exit line.
    </p>
  )
}

// ---------------------------------------------------------------------------
// The full step-by-step plan, with cumulative columns and explicit cadence.
// ---------------------------------------------------------------------------

const TABLE_GRID_COLUMNS = '22px 52px 44px 44px 40px 44px 54px 58px'

function WalkthroughTable({
  schedule,
  walkthrough,
  hoverKey,
  onHoverKey,
}: {
  schedule: DeleverageScheduleView
  walkthrough: ScheduleWalkthrough | null
  hoverKey: ScheduleHoverKey
  onHoverKey: (key: ScheduleHoverKey) => void
}) {
  if (!walkthrough) return <SimpleStepTable steps={schedule.steps} />

  const rowStyle = (key: ScheduleHoverKey) =>
    ({
      display: 'grid',
      gridTemplateColumns: TABLE_GRID_COLUMNS,
      gap: 6,
      padding: '3px 8px',
      background: hoverKey != null && hoverKey === key ? 'rgba(238,255,0,0.07)' : 'transparent',
      cursor: 'default',
    }) as const

  return (
    <div
      style={{
        margin: '6px 0',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        padding: '6px 0',
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          ...rowStyle(null),
          color: 'var(--text-dim)',
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span>#</span>
        <span>Trigger</span>
        <span>Gap</span>
        <span>Drop</span>
        <span>Sell</span>
        <span>Left</span>
        <span>Proceeds</span>
        <span>Loan after</span>
      </div>

      {walkthrough.stepRows.map((row) => (
        <div
          key={row.stepIndex}
          style={{ ...rowStyle(row.stepIndex), ...cellFont }}
          onMouseEnter={() => onHoverKey(row.stepIndex)}
          onMouseLeave={() => onHoverKey(null)}
        >
          <span style={{ color: 'var(--text-muted)' }}>{row.stepIndex + 1}</span>
          <span style={{ color: 'var(--text)' }}>{formatCentsUsd(row.triggerPriceUsd)}</span>
          <span style={{ color: 'var(--text-dim)' }}>
            {row.spacingUsd != null ? formatCentsUsd(row.spacingUsd) : '—'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            −{(row.dropFromEntryFraction * PCT_PER_FRACTION).toFixed(0)}%
          </span>
          <span style={{ color: row.sellFractionBps === 0 ? 'var(--text-dim)' : 'var(--text)' }}>
            {(row.sellFractionBps / BPS_PER_PCT).toFixed(0)}%
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {(row.remainingFractionAfter * PCT_PER_FRACTION).toFixed(0)}%
          </span>
          <span style={{ color: 'var(--text-muted)' }}>${row.proceedsUsd.toFixed(2)}</span>
          <span style={{ color: 'var(--text)' }}>${row.loanAfterUsd.toFixed(2)}</span>
        </div>
      ))}

      <div
        style={{
          ...rowStyle('debt-clear'),
          ...cellFont,
          borderTop: '1px solid rgba(91,156,245,0.25)',
          marginTop: 3,
          paddingTop: 5,
        }}
        onMouseEnter={() => onHoverKey('debt-clear')}
        onMouseLeave={() => onHoverKey(null)}
      >
        <span style={{ color: DEBT_CLEAR_COLOR }}>⏻</span>
        <span style={{ color: DEBT_CLEAR_COLOR }}>
          {formatCentsUsd(walkthrough.debtClear.triggerPriceUsd)}
        </span>
        <span style={{ color: 'var(--text-dim)' }}>—</span>
        <span style={{ color: 'var(--text-muted)' }}>
          −{(walkthrough.debtClear.dropFromEntryFraction * PCT_PER_FRACTION).toFixed(0)}%
        </span>
        <span style={{ color: DEBT_CLEAR_COLOR }}>
          {(walkthrough.debtClear.sellFractionOfCurrentBps / BPS_PER_PCT).toFixed(0)}%
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {(walkthrough.debtClear.remainingFractionAfter * PCT_PER_FRACTION).toFixed(0)}%
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          ${walkthrough.debtClear.proceedsUsd.toFixed(2)}
        </span>
        <span style={{ color: DEBT_CLEAR_COLOR }}>$0.00</span>
      </div>
      <div style={{ padding: '2px 8px 0', fontSize: 9, color: DEBT_CLEAR_COLOR, opacity: 0.8 }}>
        Debt-clear exit (at most {formatCentsUsd(walkthrough.debtClearPriceUsd)} — falls as steps
        repay) — sells just enough to repay the loan in full the moment the live exit line is
        touched. The printed price is the at-entry worst case.
      </div>

      {schedule.timeTrims?.map((trim) => (
        <div
          key={trim.triggerElapsedFraction}
          style={{
            display: 'grid',
            gridTemplateColumns: '22px 1fr 44px',
            gap: 6,
            padding: '4px 8px 1px',
            ...cellFont,
            borderTop: '1px dashed rgba(255,255,255,0.08)',
            marginTop: 3,
          }}
        >
          <span style={{ color: 'var(--text-dim)' }}>◷</span>
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'normal' }}>
            At {(trim.triggerElapsedFraction * PCT_PER_FRACTION).toFixed(0)}% of game time,
            regardless of price
          </span>
          <span style={{ color: 'var(--text)', textAlign: 'right' }}>
            sell {(trim.trimFractionBps / BPS_PER_PCT).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// Fallback when the position numbers can't be parsed — schedule-only columns.
function SimpleStepTable({ steps }: { steps: DeleverageScheduleStep[] }) {
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: '36px 1fr auto',
    gap: 8,
    padding: '3px 10px',
  }
  return (
    <div
      style={{
        margin: '6px 0',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        padding: '6px 0',
      }}
    >
      <div
        style={{
          ...gridStyle,
          color: 'var(--text-dim)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <span>Step</span>
        <span>Trigger price</span>
        <span>Sell</span>
      </div>
      {steps.map((step) => (
        <div
          key={step.stepIndex}
          style={{ ...gridStyle, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>{step.stepIndex + 1}</span>
          <span style={{ color: 'var(--text)' }}>{formatCentsUsd(step.triggerPriceUsd)}</span>
          <span style={{ color: 'var(--text)' }}>
            {(step.sellFractionBps / BPS_PER_PCT).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// "What if the price fell to X?" — a slider that narrates the cumulative state.
// ---------------------------------------------------------------------------

const SCRUB_STEP_USD = 0.001
const SCRUB_UNDERSHOOT_FRACTION = 0.15

function WhatIfScrubber({
  walkthrough,
  initialPriceUsd,
  scrubPriceUsd,
  onScrub,
}: {
  walkthrough: ScheduleWalkthrough
  initialPriceUsd: number | null
  scrubPriceUsd: number | null
  onScrub: (priceUsd: number) => void
}) {
  const maxPrice = walkthrough.basis.entryPriceUsd
  const lowestTrigger = Math.min(
    walkthrough.debtClearPriceUsd,
    ...walkthrough.stepRows.map((row) => row.triggerPriceUsd),
  )
  const minPrice = Math.max(
    SCRUB_STEP_USD,
    lowestTrigger - (maxPrice - lowestTrigger) * SCRUB_UNDERSHOOT_FRACTION,
  )

  const clamp = (value: number) => Math.min(maxPrice, Math.max(minPrice, value))
  const price = clamp(scrubPriceUsd ?? initialPriceUsd ?? maxPrice)
  const state = scheduleStateAtPrice(walkthrough, price)

  return (
    <div
      style={{
        marginTop: 10,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.04)',
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          What if the price fell to…
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--yellow)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatCentsUsd(price)}
        </span>
      </div>

      <input
        type="range"
        min={minPrice}
        max={maxPrice}
        step={SCRUB_STEP_USD}
        value={price}
        onChange={(e) => onScrub(clamp(Number(e.target.value)))}
        aria-label="What-if price"
        style={{ width: '100%', accentColor: 'var(--yellow)' }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 9,
          color: 'var(--text-dim)',
          marginTop: 2,
        }}
      >
        <span>{formatCentsUsd(minPrice)}</span>
        <span>entry {formatCentsUsd(maxPrice)}</span>
      </div>

      <p
        style={{
          margin: '8px 0 0',
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--text-muted)',
        }}
      >
        <ScrubNarration walkthrough={walkthrough} price={price} state={state} />
      </p>
    </div>
  )
}

function ScrubNarration({
  walkthrough,
  price,
  state,
}: {
  walkthrough: ScheduleWalkthrough
  price: number
  state: ReturnType<typeof scheduleStateAtPrice>
}) {
  const atPrice = <strong style={{ color: 'var(--text)' }}>At {formatCentsUsd(price)}:</strong>
  const nextEvent =
    state.nextEventPriceUsd != null ? (
      <>
        {' '}Next:{' '}
        {state.nextEventKind === 'debt-clear' ? (
          <span style={{ color: DEBT_CLEAR_COLOR }}>
            debt-clear exit at {formatCentsUsd(state.nextEventPriceUsd)} at the latest
          </span>
        ) : (
          <>step at {formatCentsUsd(state.nextEventPriceUsd)}</>
        )}
        .
      </>
    ) : null
  // The printed debt-clear price is the at-entry worst case; once slices have
  // repaid part of the loan the live exit line sits below it.
  const exitLineNote =
    state.firedStepCount > 0 && !state.debtClearFired ? (
      <>
        {' '}The repayments so far have pulled the{' '}
        <span style={{ color: DEBT_CLEAR_COLOR }}>
          exit line now below {formatCentsUsd(walkthrough.debtClearPriceUsd)}
        </span>
        .
      </>
    ) : null

  if (state.inQuietZone) {
    return (
      <>
        {atPrice} inside your quiet zone — nothing has fired, you still hold 100% of your tokens
        and the loan is unchanged at ${state.loanRemainingUsd.toFixed(2)}.{nextEvent}
      </>
    )
  }

  const holdPct = (state.remainingFraction * PCT_PER_FRACTION).toFixed(0)
  const approx = walkthrough.basis.tokensAreEstimated ? '≈' : ''
  const tokens = `${approx}${state.tokensRemaining.toFixed(0)}`
  const totalTokens = `${approx}${walkthrough.basis.positionTokens.toFixed(0)}`

  if (state.debtClearFired) {
    return (
      <>
        {atPrice} {state.firedStepCount} step{state.firedStepCount === 1 ? '' : 's'} plus the{' '}
        <span style={{ color: DEBT_CLEAR_COLOR }}>debt-clear exit</span> have fired — the loan is
        fully repaid. You'd hold <strong style={{ color: 'var(--text)' }}>{holdPct}%</strong> of
        your tokens ({tokens} of {totalTokens}), owned outright.
        {nextEvent}
      </>
    )
  }

  return (
    <>
      {atPrice} {state.firedStepCount} of {state.totalStepCount} steps have fired. You'd hold{' '}
      <strong style={{ color: 'var(--text)' }}>{holdPct}%</strong> of your tokens ({tokens} of{' '}
      {totalTokens}), loan down to{' '}
      <strong style={{ color: 'var(--text)' }}>${state.loanRemainingUsd.toFixed(2)}</strong>.
      {exitLineNote}
      {nextEvent}
    </>
  )
}
