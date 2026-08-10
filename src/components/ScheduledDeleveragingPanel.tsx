import type {
  DeleverageScheduleView,
  ShadowDeleverageView,
} from '../api/scheduled-deleveraging.types'
import type { PositionUnwindList } from '../api/types'
import type { ScheduleBasisInput } from '../utils/deleverageSchedule'
import { computeScheduleLeverageSteps, formatCentsUsd, formatLeverageBps } from '../utils/deleverageSchedule'
import { StatRow } from './StatRow'
import { StatGroup } from './CardViewParts'
import { DEBT_CLEAR_COLOR, ShadowDeleverageTimeline } from './ShadowDeleverageTimeline'

const LIQUIDATION_COLOR = '#F5A623'

export function ScheduledDeleveragingPanel({
  schedule,
  basis,
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
  return (
    <StatGroup label="Scheduled Deleveraging (shadow)" last={last}>
      {showComparison && liquidationPriceUsd != null && (
        <ProtectionComparison schedule={schedule} liquidationPriceUsd={liquidationPriceUsd} />
      )}

      {showComparison && liquidationPriceUsd != null && (
        <EssentialsLine schedule={schedule} basis={basis} />
      )}

      <ScheduleStepsLadder schedule={schedule} basis={basis} />

      {shadowDeleverage != null && (
        <ShadowDeleverageTimeline shadow={shadowDeleverage} unwinds={unwinds} />
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
// engine still manages every position; the schedule card previews the proposed
// mechanism the API now computes and runs in shadow on every eligible quote —
// nothing the user selected, nothing that executes.
//
// The two cards are parallel: each headlines a single price (the standard
// liquidation vs the scheduled exit). The rung ladder is deliberately dropped —
// for a naked guard, gradual cutting destroys value; the product is a
// deposit-backed backstop that repays the loan, so we present exactly that.
// ---------------------------------------------------------------------------

function ProtectionComparison({
  schedule,
  liquidationPriceUsd,
}: {
  schedule: DeleverageScheduleView
  liquidationPriceUsd: string
}) {
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
  const headlineStyle = {
    fontSize: 15,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    marginBottom: 6,
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
        <div style={{ ...headlineStyle, color: LIQUIDATION_COLOR }}>
          {formatCentsUsd(liquidationPriceUsd)} liquidation
        </div>
        <div style={bodyStyle}>
          One liquidation price. Below it, the risk engine sells for you in real time — amounts
          and timing decided in the moment. This is what actually manages your position. Its
          price includes the engine&apos;s maintenance and slippage buffers, and assumes your
          collateral only.
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
        <div style={{ ...headlineStyle, color: DEBT_CLEAR_COLOR }}>
          {formatCentsUsd(schedule.debtClearPriceUsd)} exit
        </div>
        <div style={bodyStyle}>
          One exit price. There, the schedule sells just enough to repay your loan — you keep any
          sliver of value beyond that. It&apos;s backed by a ${schedule.safetyDepositRequiredUsd}{' '}
          refundable deposit, which also buffers a gap past the exit. Worst case you lose your
          collateral and the deposit comes back — unless a crash gaps clean past the exit.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One plain-language line with the essentials: entry, deposit, exit.
// ---------------------------------------------------------------------------

function EssentialsLine({
  schedule,
  basis,
}: {
  schedule: DeleverageScheduleView
  basis: ScheduleBasisInput
}) {
  const strong = { color: 'var(--text)' } as const
  return (
    <p
      style={{
        margin: '0 0 10px',
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--text-muted)',
      }}
    >
      Entry <strong style={strong}>{formatCentsUsd(basis.entryPriceUsd)}</strong> · deposit{' '}
      <strong style={strong}>${schedule.safetyDepositRequiredUsd}</strong> refundable · exit{' '}
      <strong style={{ color: DEBT_CLEAR_COLOR }}>
        {formatCentsUsd(schedule.debtClearPriceUsd)}
      </strong>
      .
    </p>
  )
}

// ---------------------------------------------------------------------------
// The schedule's steps as a book-leverage ladder: the price each step fires at
// and the leverage it brings the position down to. Book leverage =
// (loan + collateral) / collateral, so it only steps DOWN as sales repay the
// loan — monotonic, no market-price up-and-down — landing at 1x when the
// debt-clear repays the loan in full.
// ---------------------------------------------------------------------------

const ONE_X_BPS = 10000

function ScheduleStepsLadder({
  schedule,
  basis,
}: {
  schedule: DeleverageScheduleView
  basis: ScheduleBasisInput
}) {
  const steps = computeScheduleLeverageSteps(schedule, basis)
  if (steps.length === 0) {
    return null
  }

  const entryLeverageBps = Math.round((Number(basis.notionalUsd) / Number(basis.collateralUsd)) * ONE_X_BPS)
  const maxBps = Math.max(entryLeverageBps, ...steps.map((step) => step.bookLeverageBps))
  const barWidthPct = (bps: number): number => {
    const span = maxBps - ONE_X_BPS
    return span <= 0 ? 100 : Math.round(((bps - ONE_X_BPS) / span) * 100)
  }

  const sellableRungCount = schedule.steps.filter((step) => step.sellFractionBps > 0).length
  const shownRungCount = steps.filter((step) => !step.isDebtClear).length
  const skippedRungCount = sellableRungCount - shownRungCount

  return (
    <div style={{ margin: '4px 0 12px' }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          marginBottom: 6,
        }}
      >
        Deleverage ladder — leverage steps down as it sells
      </div>
      <LadderRow
        label={`Entry ${formatCentsUsd(basis.entryPriceUsd)}`}
        leverageBps={entryLeverageBps}
        widthPct={barWidthPct(entryLeverageBps)}
        isEntry
      />
      {steps.map((step, index) => (
        <LadderRow
          key={`${step.triggerPriceUsd}-${index}`}
          label={
            step.isDebtClear
              ? `Debt-clear ${formatCentsUsd(step.triggerPriceUsd)}`
              : formatCentsUsd(step.triggerPriceUsd)
          }
          leverageBps={step.bookLeverageBps}
          widthPct={barWidthPct(step.bookLeverageBps)}
          isDebtClear={step.isDebtClear}
        />
      ))}
      <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.5, color: 'var(--text-dim)' }}>
        Leverage falls only as the loan is repaid; the debt-clear repays whatever remains.
        {skippedRungCount > 0 &&
          ` The ${skippedRungCount} lower rung${skippedRungCount === 1 ? '' : 's'} never fire here — the debt-clear clears the loan first.`}
      </div>
    </div>
  )
}

function LadderRow({
  label,
  leverageBps,
  widthPct,
  isEntry,
  isDebtClear,
}: {
  label: string
  leverageBps: number
  widthPct: number
  isEntry?: boolean
  isDebtClear?: boolean
}) {
  const valueColor = isDebtClear ? DEBT_CLEAR_COLOR : 'var(--text)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 0',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ width: 96, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${widthPct}%`,
            height: '100%',
            background: isDebtClear ? DEBT_CLEAR_COLOR : '#8FA3BF',
            opacity: isEntry ? 0.4 : 0.85,
          }}
        />
      </div>
      <span style={{ width: 44, textAlign: 'right', color: valueColor, fontWeight: 600 }}>
        {formatLeverageBps(leverageBps)}
      </span>
    </div>
  )
}


// ---------------------------------------------------------------------------
// COMMITTED MODE (merged API #5311). The quote's committedUnwinds preview and a
// position's planned unwind rows both render as the same book-leverage ladder
// the shadow panel used — but the backend now supplies the target leverage per
// rung directly (targetLeverageBps / afterLeverageBps), no client derivation.
// ---------------------------------------------------------------------------

import type { CommittedUnwindsView } from '../api/committed-unwinds.types'

export function CommittedUnwindsPanel({
  committed,
  entryLeverageBps,
  lockedMarginUsd,
  isPreview,
  last,
}: {
  isPreview?: boolean
  committed: Pick<CommittedUnwindsView, 'marginRequiredUsd' | 'debtClearPriceUsd'> & {
    rungs: { triggerPriceUsd: string; leverageBps: number }[]
  }
  entryLeverageBps: number
  lockedMarginUsd?: string | null
  last?: boolean
}) {
  const rungs = committed.rungs
  const maxBps = Math.max(entryLeverageBps, ...rungs.map((r) => r.leverageBps), ONE_X_BPS)
  const barWidthPct = (bps: number): number => {
    const span = maxBps - ONE_X_BPS
    return span <= 0 ? 100 : Math.round(((bps - ONE_X_BPS) / span) * 100)
  }

  return (
    <StatGroup label={isPreview ? "Committed unwinds (preview — quote is adaptive)" : "Committed unwinds"} last={last}>
      <div style={{ margin: '4px 0 12px' }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            marginBottom: 6,
          }}
        >
          Pre-agreed ladder — leverage steps down as rungs fire
        </div>
        <LadderRow label="Entry" leverageBps={entryLeverageBps} widthPct={barWidthPct(entryLeverageBps)} isEntry />
        {rungs.map((rung, index) => (
          <LadderRow
            key={`${rung.triggerPriceUsd}-${index}`}
            label={formatCentsUsd(rung.triggerPriceUsd)}
            leverageBps={rung.leverageBps}
            widthPct={barWidthPct(rung.leverageBps)}
          />
        ))}
        {committed.debtClearPriceUsd != null && (
          <LadderRow
            label={`Debt-clear ${formatCentsUsd(committed.debtClearPriceUsd)}`}
            leverageBps={ONE_X_BPS}
            widthPct={0}
            isDebtClear
          />
        )}
      </div>
      {committed.marginRequiredUsd != null && (
        <StatRow label="Margin required (first-loss)" value={`$${committed.marginRequiredUsd}`} />
      )}
      {lockedMarginUsd != null && <StatRow nested label="Locked" value={`$${lockedMarginUsd}`} />}
      <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.5, color: 'var(--text-dim)' }}>
        Fixed price-triggered ladder agreed at quote time; the adaptive engine stays off this
        position. The margin absorbs first losses and is released at close.
      </div>
    </StatGroup>
  )
}
