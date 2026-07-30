import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import type { ScheduleWalkthrough } from '../utils/deleverageSchedule'
import { formatCentsUsd, simulateScheduleEvents } from '../utils/deleverageSchedule'
import { useMeasuredWidth } from './useMeasuredWidth'

export type ScheduleHoverKey = number | 'debt-clear' | null

// Blue = the drawer's deleveraging accent (unwinding banner, unwind tooltips).
export const DEBT_CLEAR_COLOR = '#5B9CF5'
const HOVER_COLOR = 'var(--yellow)'
const SCRUB_COLOR = 'rgba(238,255,0,0.55)'

const PAD_LEFT = 40
const PAD_RIGHT = 34
const PAD_TOP = 8
const PAD_BOTTOM = 18
const HEIGHT = 190
const DOMAIN_PAD_FRACTION = 0.06
const BPS_PER_UNIT = 10_000

interface StaircaseDrop {
  key: number | 'debt-clear'
  priceUsd: number
  remainingBefore: number
  remainingAfter: number
}

function priceDomain(
  schedule: DeleverageScheduleView,
  entryPriceUsd: number | null,
  currentPriceUsd: number | null,
) {
  const prices = schedule.steps.map((s) => parseFloat(s.triggerPriceUsd))
  prices.push(parseFloat(schedule.debtClearPriceUsd))
  prices.push(parseFloat(schedule.entryBufferFloorPriceUsd))
  if (entryPriceUsd != null && Number.isFinite(entryPriceUsd)) prices.push(entryPriceUsd)
  if (currentPriceUsd != null && Number.isFinite(currentPriceUsd)) prices.push(currentPriceUsd)
  const rawMax = Math.max(...prices)
  const rawMin = Math.min(...prices)
  const rawRange = rawMax - rawMin || rawMax || 1
  return {
    max: rawMax + rawRange * DOMAIN_PAD_FRACTION,
    min: rawMin - rawRange * DOMAIN_PAD_FRACTION,
  }
}

function buildStaircaseDrops(
  schedule: DeleverageScheduleView,
  walkthrough: ScheduleWalkthrough | null,
): StaircaseDrop[] {
  if (walkthrough) {
    let remainingBefore = 1
    return simulateScheduleEvents(walkthrough).map((event) => {
      const drop: StaircaseDrop = {
        key: event.kind === 'debt-clear' ? 'debt-clear' : (event.stepIndex ?? 0),
        priceUsd: event.priceUsd,
        remainingBefore,
        remainingAfter: event.remainingFractionAfter,
      }
      remainingBefore = event.remainingFractionAfter
      return drop
    })
  }
  let remaining = 1
  return schedule.steps.map((step) => {
    const remainingBefore = remaining
    remaining *= 1 - step.sellFractionBps / BPS_PER_UNIT
    return {
      key: step.stepIndex,
      priceUsd: parseFloat(step.triggerPriceUsd),
      remainingBefore,
      remainingAfter: remaining,
    }
  })
}

export function DeleverageScheduleCharts({
  schedule,
  walkthrough,
  currentPriceUsd,
  scrubPriceUsd,
  hoverKey,
  onHoverKey,
}: {
  schedule: DeleverageScheduleView
  walkthrough: ScheduleWalkthrough | null
  currentPriceUsd: number | null
  scrubPriceUsd: number | null
  hoverKey: ScheduleHoverKey
  onHoverKey: (key: ScheduleHoverKey) => void
}) {
  const entryPriceUsd = walkthrough?.basis.entryPriceUsd ?? null
  const domain = priceDomain(schedule, entryPriceUsd, currentPriceUsd)
  const drops = buildStaircaseDrops(schedule, walkthrough)

  return (
    <div style={{ marginTop: 10 }}>
      <RemainingStaircaseChart
        drops={drops}
        domain={domain}
        entryPriceUsd={entryPriceUsd}
        scrubPriceUsd={scrubPriceUsd}
        walkthrough={walkthrough}
        hoverKey={hoverKey}
        onHoverKey={onHoverKey}
      />
    </div>
  )
}

export function ChartFrame({
  title,
  measureRef,
  children,
}: {
  title: string
  measureRef: (node: HTMLDivElement | null) => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 0,
        padding: '12px 14px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text)',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {title}
      </div>
      <div ref={measureRef} style={{ width: '100%' }}>
        {children}
      </div>
    </div>
  )
}


function RemainingStaircaseChart({
  drops,
  domain,
  entryPriceUsd,
  scrubPriceUsd,
  walkthrough,
  hoverKey,
  onHoverKey,
}: {
  drops: StaircaseDrop[]
  domain: { max: number; min: number }
  entryPriceUsd: number | null
  scrubPriceUsd: number | null
  walkthrough: ScheduleWalkthrough | null
  hoverKey: ScheduleHoverKey
  onHoverKey: (key: ScheduleHoverKey) => void
}) {
  const { width, measureRef } = useMeasuredWidth(300)
  const chartW = width - PAD_LEFT - PAD_RIGHT
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const range = domain.max - domain.min || 1
  // Price falls left → right.
  const toX = (priceUsd: number) => PAD_LEFT + ((domain.max - priceUsd) / range) * chartW
  const toY = (remainingFraction: number) => PAD_TOP + (1 - remainingFraction) * chartH

  let path = `M ${toX(domain.max).toFixed(1)} ${toY(1).toFixed(1)}`
  for (const drop of drops) {
    const x = toX(drop.priceUsd).toFixed(1)
    path += ` L ${x} ${toY(drop.remainingBefore).toFixed(1)} L ${x} ${toY(drop.remainingAfter).toFixed(1)}`
  }
  const finalRemaining = drops.length > 0 ? drops[drops.length - 1].remainingAfter : 1
  path += ` L ${toX(domain.min).toFixed(1)} ${toY(finalRemaining).toFixed(1)}`

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left + PAD_LEFT
    let closestKey: ScheduleHoverKey = null
    let minDist = Infinity
    for (const drop of drops) {
      const d = Math.abs(toX(drop.priceUsd) - mouseX)
      if (d < minDist) {
        minDist = d
        closestKey = drop.key
      }
    }
    onHoverKey(closestKey)
  }

  const xLabelCandidates: { priceUsd: number; text: string; color: string }[] = []
  if (entryPriceUsd != null) {
    xLabelCandidates.push({ priceUsd: entryPriceUsd, text: 'entry', color: 'var(--text-muted)' })
  }
  if (walkthrough) {
    xLabelCandidates.push({
      priceUsd: walkthrough.debtClearPriceUsd,
      text: formatCentsUsd(walkthrough.debtClearPriceUsd),
      color: DEBT_CLEAR_COLOR,
    })
  }
  if (drops.length > 0) {
    const lowest = drops[drops.length - 1]
    if (lowest.key !== 'debt-clear') {
      xLabelCandidates.push({
        priceUsd: lowest.priceUsd,
        text: formatCentsUsd(lowest.priceUsd),
        color: 'var(--text-dim)',
      })
    }
  }

  return (
    <ChartFrame title="Position Remaining" measureRef={measureRef}>
      <svg width={width} height={HEIGHT} style={{ display: 'block', overflow: 'visible' }}>
        {/* Y axis: % held */}
        {[1, 0.5, 0].map((fraction) => (
          <g key={fraction}>
            <line
              x1={PAD_LEFT}
              y1={toY(fraction)}
              x2={PAD_LEFT + chartW}
              y2={toY(fraction)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 4}
              y={toY(fraction) + 3}
              textAnchor="end"
              fontSize={9}
              fontFamily="var(--font)"
              fill="var(--text-dim)"
            >
              {(fraction * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Staircase */}
        <path d={path} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeLinejoin="miter" />

        {/* Per-drop highlights: dc drop always blue, hovered drop yellow */}
        {drops.map((drop) => {
          const isDebtClear = drop.key === 'debt-clear'
          const isHovered = hoverKey != null && hoverKey === drop.key
          if (!isDebtClear && !isHovered) return null
          const x = toX(drop.priceUsd)
          return (
            <g key={String(drop.key)}>
              <line
                x1={x}
                y1={toY(drop.remainingBefore)}
                x2={x}
                y2={toY(drop.remainingAfter)}
                stroke={isHovered ? HOVER_COLOR : DEBT_CLEAR_COLOR}
                strokeWidth={2.5}
              />
              <circle
                cx={x}
                cy={toY(drop.remainingAfter)}
                r={3}
                fill={isHovered ? HOVER_COLOR : DEBT_CLEAR_COLOR}
                stroke="rgba(12,12,12,0.9)"
                strokeWidth={1}
              />
            </g>
          )
        })}

        {/* What-if scrub marker */}
        {scrubPriceUsd != null && (
          <line
            x1={toX(scrubPriceUsd)}
            y1={PAD_TOP}
            x2={toX(scrubPriceUsd)}
            y2={PAD_TOP + chartH}
            stroke={SCRUB_COLOR}
            strokeWidth={1.25}
          />
        )}

        {/* X-axis labels (price falling to the right) */}
        {xLabelCandidates.map((label, i) => (
          <text
            key={`${label.text}-${i}`}
            x={toX(label.priceUsd)}
            y={PAD_TOP + chartH + 12}
            textAnchor="middle"
            fontSize={9}
            fontFamily="var(--font)"
            fill={label.color}
          >
            {label.text}
          </text>
        ))}
        <text
          x={PAD_LEFT + chartW}
          y={PAD_TOP + chartH + 12}
          textAnchor="end"
          fontSize={8}
          fontFamily="var(--font)"
          fill="var(--text-dim)"
        >
          price falls →
        </text>

        {/* Invisible interaction layer */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={Math.max(0, chartW)}
          height={chartH}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHoverKey(null)}
          style={{ cursor: 'crosshair' }}
        />
      </svg>
    </ChartFrame>
  )
}
