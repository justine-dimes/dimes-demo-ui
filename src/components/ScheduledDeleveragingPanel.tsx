import type {
  DeleverageScheduleView,
  ShadowDeleverageView,
} from '../api/scheduled-deleveraging.types'
import type { PositionUnwindList } from '../api/types'
import type { ScheduleBasisInput } from '../utils/deleverageSchedule'
import { formatCentsUsd } from '../utils/deleverageSchedule'
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
