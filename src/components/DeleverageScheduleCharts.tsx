import { useCallback, useState } from 'react'
import type { DeleverageScheduleView } from '../api/scheduled-deleveraging.types'
import type { ScheduleWalkthrough } from '../utils/deleverageSchedule'
import { formatCentsUsd, scheduleStateAtPrice } from '../utils/deleverageSchedule'

export type ScheduleHoverKey = number | 'debt-clear' | null

// Blue = the drawer's deleveraging accent (unwinding banner, unwind tooltips).
export const DEBT_CLEAR_COLOR = '#5B9CF5'
const ENTRY_MARKER_COLOR = 'rgba(255,255,255,0.45)'
const CURRENT_MARKER_COLOR = '#44FF97'
const QUIET_ZONE_FILL = 'rgba(68,255,151,0.06)'
const HOVER_COLOR = 'var(--yellow)'
const SCRUB_COLOR = 'rgba(238,255,0,0.55)'

const PAD_LEFT = 40
const PAD_RIGHT = 34
const PAD_TOP = 8
const PAD_BOTTOM = 18
const HEIGHT = 190
const MIN_LABEL_PX = 12
const DOMAIN_PAD_FRACTION = 0.06
const STEP_BASE_STROKE_PX = 1
const STEP_STROKE_PER_FULL_SELL_PX = 4
const BPS_PER_UNIT = 10_000

interface StaircaseDrop {
  key: number | 'debt-clear'
  priceUsd: number
  remainingBefore: number
  remainingAfter: number
}

function useMeasuredWidth(initial: number) {
  const [width, setWidth] = useState(initial)
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(node)
    setWidth(node.getBoundingClientRect().width || initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a constant default, not a reactive input
  }, [])
  return { width, measureRef }
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
    const events: { key: number | 'debt-clear'; priceUsd: number }[] = walkthrough.stepRows.map(
      (row) => ({ key: row.stepIndex, priceUsd: row.triggerPriceUsd }),
    )
    events.push({ key: 'debt-clear', priceUsd: walkthrough.debtClearPriceUsd })
    events.sort((a, b) => b.priceUsd - a.priceUsd)
    let remainingBefore = 1
    return events.map((event) => {
      const remainingAfter = scheduleStateAtPrice(walkthrough, event.priceUsd).remainingFraction
      const drop = { ...event, remainingBefore, remainingAfter }
      remainingBefore = remainingAfter
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 10,
        marginTop: 10,
      }}
    >
      <LadderChart
        schedule={schedule}
        domain={domain}
        entryPriceUsd={entryPriceUsd}
        currentPriceUsd={currentPriceUsd}
        scrubPriceUsd={scrubPriceUsd}
        hoverKey={hoverKey}
        onHoverKey={onHoverKey}
      />
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

function ChartFrame({
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

interface AxisLabel {
  priceUsd: number
  text: string
  color: string
  priority: number
}

function LadderChart({
  schedule,
  domain,
  entryPriceUsd,
  currentPriceUsd,
  scrubPriceUsd,
  hoverKey,
  onHoverKey,
}: {
  schedule: DeleverageScheduleView
  domain: { max: number; min: number }
  entryPriceUsd: number | null
  currentPriceUsd: number | null
  scrubPriceUsd: number | null
  hoverKey: ScheduleHoverKey
  onHoverKey: (key: ScheduleHoverKey) => void
}) {
  const { width, measureRef } = useMeasuredWidth(300)
  const chartW = width - PAD_LEFT - PAD_RIGHT
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const range = domain.max - domain.min || 1
  const toY = (priceUsd: number) => PAD_TOP + (1 - (priceUsd - domain.min) / range) * chartH

  const debtClearPrice = parseFloat(schedule.debtClearPriceUsd)
  const quietFloorPrice = parseFloat(schedule.entryBufferFloorPriceUsd)
  const hasQuietZone = entryPriceUsd != null && entryPriceUsd > quietFloorPrice

  const labelCandidates: AxisLabel[] = []
  if (entryPriceUsd != null && Number.isFinite(entryPriceUsd)) {
    labelCandidates.push({ priceUsd: entryPriceUsd, text: 'entry', color: 'var(--text-muted)', priority: 0 })
  }
  if (currentPriceUsd != null && Number.isFinite(currentPriceUsd)) {
    labelCandidates.push({ priceUsd: currentPriceUsd, text: 'now', color: CURRENT_MARKER_COLOR, priority: 0 })
  }
  labelCandidates.push({
    priceUsd: debtClearPrice,
    text: formatCentsUsd(debtClearPrice),
    color: DEBT_CLEAR_COLOR,
    priority: 0,
  })
  for (const step of schedule.steps) {
    labelCandidates.push({
      priceUsd: parseFloat(step.triggerPriceUsd),
      text: formatCentsUsd(step.triggerPriceUsd),
      color: 'var(--text-dim)',
      priority: 1,
    })
  }
  labelCandidates.sort((a, b) => a.priority - b.priority)
  const axisLabels: AxisLabel[] = []
  for (const candidate of labelCandidates) {
    const cy = toY(candidate.priceUsd)
    const hasRoom = axisLabels.every((l) => Math.abs(toY(l.priceUsd) - cy) >= MIN_LABEL_PX)
    if (hasRoom) axisLabels.push(candidate)
  }

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseY = e.clientY - rect.top + PAD_TOP
    let closestKey: ScheduleHoverKey = null
    let minDist = Infinity
    for (const step of schedule.steps) {
      const d = Math.abs(toY(parseFloat(step.triggerPriceUsd)) - mouseY)
      if (d < minDist) {
        minDist = d
        closestKey = step.stepIndex
      }
    }
    const debtClearDist = Math.abs(toY(debtClearPrice) - mouseY)
    if (debtClearDist < minDist) closestKey = 'debt-clear'
    onHoverKey(closestKey)
  }

  return (
    <ChartFrame title="Price Ladder" measureRef={measureRef}>
      <svg width={width} height={HEIGHT} style={{ display: 'block', overflow: 'visible' }}>
        {/* Quiet zone — nothing fires between entry and the buffer floor */}
        {hasQuietZone && (
          <g>
            <rect
              x={PAD_LEFT}
              y={toY(entryPriceUsd)}
              width={Math.max(0, chartW)}
              height={Math.max(0, toY(quietFloorPrice) - toY(entryPriceUsd))}
              fill={QUIET_ZONE_FILL}
            />
            <text
              x={PAD_LEFT + 6}
              y={(toY(entryPriceUsd) + toY(quietFloorPrice)) / 2 + 3}
              fontSize={9}
              fontFamily="var(--font)"
              fill="rgba(68,255,151,0.55)"
            >
              quiet zone — no sales
            </text>
          </g>
        )}

        {/* Step trigger lines — thickness scales with sell fraction */}
        {schedule.steps.map((step) => {
          const sy = toY(parseFloat(step.triggerPriceUsd))
          const isHovered = hoverKey === step.stepIndex
          const isCheckpoint = step.sellFractionBps === 0
          return (
            <g key={step.stepIndex}>
              <line
                x1={PAD_LEFT}
                y1={sy}
                x2={PAD_LEFT + chartW}
                y2={sy}
                stroke={isHovered ? HOVER_COLOR : 'rgba(255,255,255,0.7)'}
                strokeWidth={
                  STEP_BASE_STROKE_PX +
                  (step.sellFractionBps / BPS_PER_UNIT) * STEP_STROKE_PER_FULL_SELL_PX +
                  (isHovered ? 0.75 : 0)
                }
                strokeDasharray={isCheckpoint ? '2 3' : undefined}
              />
              <text
                x={PAD_LEFT + chartW + 4}
                y={sy + 3}
                textAnchor="start"
                fontSize={9}
                fontFamily="var(--font)"
                fill={isHovered ? HOVER_COLOR : 'var(--text-muted)'}
              >
                {isCheckpoint ? '–' : `sell ${(step.sellFractionBps / 100).toFixed(0)}%`}
              </text>
            </g>
          )
        })}

        {/* Entry price marker */}
        {entryPriceUsd != null && Number.isFinite(entryPriceUsd) && (
          <line
            x1={PAD_LEFT}
            y1={toY(entryPriceUsd)}
            x2={PAD_LEFT + chartW}
            y2={toY(entryPriceUsd)}
            stroke={ENTRY_MARKER_COLOR}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        {/* Current price marker */}
        {currentPriceUsd != null && Number.isFinite(currentPriceUsd) && (
          <line
            x1={PAD_LEFT}
            y1={toY(currentPriceUsd)}
            x2={PAD_LEFT + chartW}
            y2={toY(currentPriceUsd)}
            stroke={CURRENT_MARKER_COLOR}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        {/* Debt-clear exit — emphasized */}
        <g>
          <line
            x1={PAD_LEFT}
            y1={toY(debtClearPrice)}
            x2={PAD_LEFT + chartW}
            y2={toY(debtClearPrice)}
            stroke={DEBT_CLEAR_COLOR}
            strokeWidth={hoverKey === 'debt-clear' ? 2.5 : 1.75}
            strokeDasharray="6 3"
          />
          <text
            x={PAD_LEFT + chartW + 4}
            y={toY(debtClearPrice) + 3}
            textAnchor="start"
            fontSize={9}
            fontFamily="var(--font)"
            fill={DEBT_CLEAR_COLOR}
          >
            exit
          </text>
        </g>

        {/* What-if scrub marker */}
        {scrubPriceUsd != null && (
          <line
            x1={PAD_LEFT}
            y1={toY(scrubPriceUsd)}
            x2={PAD_LEFT + chartW}
            y2={toY(scrubPriceUsd)}
            stroke={SCRUB_COLOR}
            strokeWidth={1.25}
          />
        )}

        {/* Left-axis price labels */}
        {axisLabels.map((label) => (
          <text
            key={`${label.text}-${label.priceUsd}`}
            x={PAD_LEFT - 4}
            y={toY(label.priceUsd) + 3}
            textAnchor="end"
            fontSize={9}
            fontFamily="var(--font)"
            fill={label.color}
          >
            {label.text}
          </text>
        ))}

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
