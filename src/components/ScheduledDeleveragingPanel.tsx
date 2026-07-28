import { useRef, useState, useCallback, useEffect } from 'react'
import type {
  DeleverageScheduleStep,
  DeleverageScheduleView,
} from '../api/scheduled-deleveraging.types'
import { StatRow } from './StatRow'
import { StatGroup } from './CardViewParts'

// Blue = the drawer's deleveraging accent (unwinding banner, unwind tooltips).
const DEBT_CLEAR_COLOR = '#5B9CF5'
const ENTRY_MARKER_COLOR = 'rgba(255,255,255,0.45)'
const CURRENT_MARKER_COLOR = '#44FF97'

export function ScheduledDeleveragingPanel({
  schedule,
  entryPriceUsd,
  currentPriceUsd,
  last,
}: {
  schedule: DeleverageScheduleView
  entryPriceUsd?: string
  currentPriceUsd?: string
  last?: boolean
}) {
  return (
    <StatGroup label="Scheduled Deleveraging" last={last}>
      <StatRow
        label="Entry buffer floor"
        value={`$${schedule.entryBufferFloorPriceUsd}`}
      />
      <StepTable steps={schedule.steps} />
      <StatRow
        label="Debt-clear exit"
        value={`$${schedule.debtClearPriceUsd}`}
        valueColor={DEBT_CLEAR_COLOR}
      />
      <StatRow
        label="Safety deposit (refundable)"
        value={`$${schedule.safetyDepositRequiredUsd}`}
      />
      {schedule.safetyDepositCollectedUsd != null && (
        <StatRow
          nested
          label="Collected"
          value={`$${schedule.safetyDepositCollectedUsd}`}
        />
      )}
      {schedule.timeTrims?.map((trim) => (
        <StatRow
          key={trim.triggerElapsedFraction}
          label={`Time trim at ${(trim.triggerElapsedFraction * 100).toFixed(0)}% elapsed`}
          value={`sell ${(trim.trimFractionBps / 100).toFixed(0)}%`}
        />
      ))}
      <div style={{ marginTop: 10 }}>
        <DeleverageLadderChart
          schedule={schedule}
          entryPriceUsd={entryPriceUsd}
          currentPriceUsd={currentPriceUsd}
        />
      </div>
    </StatGroup>
  )
}

function StepTable({ steps }: { steps: DeleverageScheduleStep[] }) {
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
      <div style={{ ...gridStyle, color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
          <span style={{ color: 'var(--text)' }}>${step.triggerPriceUsd}</span>
          <span style={{ color: 'var(--text)' }}>
            {(step.sellFractionBps / 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

const PAD_LEFT = 40
const PAD_RIGHT = 34
const PAD_TOP = 8
const PAD_BOTTOM = 8
const HEIGHT = 150
const MIN_LABEL_PX = 12
const Y_DOMAIN_PAD_FRACTION = 0.06
const STEP_BASE_STROKE_PX = 1
const STEP_STROKE_PER_FULL_SELL_PX = 4

interface TooltipState {
  clientX: number
  clientY: number
  step: DeleverageScheduleStep
}

interface AxisLabel {
  priceUsd: number
  text: string
  color: string
  priority: number
}

function DeleverageLadderChart({
  schedule,
  entryPriceUsd,
  currentPriceUsd,
}: {
  schedule: DeleverageScheduleView
  entryPriceUsd?: string
  currentPriceUsd?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [svgWidth, setSvgWidth] = useState(300)

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setSvgWidth(w)
    })
    ro.observe(node)
    setSvgWidth(node.getBoundingClientRect().width || 300)
  }, [])

  useEffect(() => {
    if (!tooltip) return
    const dismiss = () => setTooltip(null)
    window.addEventListener('scroll', dismiss, true)
    return () => window.removeEventListener('scroll', dismiss, true)
  }, [tooltip])

  const chartW = svgWidth - PAD_LEFT - PAD_RIGHT
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM

  const stepPrices = schedule.steps.map((s) => parseFloat(s.triggerPriceUsd))
  const debtClearPrice = parseFloat(schedule.debtClearPriceUsd)
  const entryPrice = entryPriceUsd != null ? parseFloat(entryPriceUsd) : null
  const currentPrice = currentPriceUsd != null ? parseFloat(currentPriceUsd) : null

  const domainPrices = [...stepPrices, debtClearPrice]
  if (entryPrice != null && Number.isFinite(entryPrice)) domainPrices.push(entryPrice)
  if (currentPrice != null && Number.isFinite(currentPrice)) domainPrices.push(currentPrice)

  const rawMax = Math.max(...domainPrices)
  const rawMin = Math.min(...domainPrices)
  const rawRange = rawMax - rawMin || rawMax || 1
  const yMax = rawMax + rawRange * Y_DOMAIN_PAD_FRACTION
  const yMin = rawMin - rawRange * Y_DOMAIN_PAD_FRACTION
  const yRange = yMax - yMin || 1

  const toY = (priceUsd: number) => PAD_TOP + (1 - (priceUsd - yMin) / yRange) * chartH

  // Left-axis labels: markers first (entry / current / debt-clear), then step
  // triggers, dropping any label within MIN_LABEL_PX of an already-placed one.
  const labelCandidates: AxisLabel[] = []
  if (entryPrice != null && Number.isFinite(entryPrice)) {
    labelCandidates.push({ priceUsd: entryPrice, text: 'entry', color: 'var(--text-muted)', priority: 0 })
  }
  if (currentPrice != null && Number.isFinite(currentPrice)) {
    labelCandidates.push({ priceUsd: currentPrice, text: 'now', color: CURRENT_MARKER_COLOR, priority: 0 })
  }
  labelCandidates.push({ priceUsd: debtClearPrice, text: `$${debtClearPrice.toFixed(2)}`, color: DEBT_CLEAR_COLOR, priority: 0 })
  for (const p of stepPrices) {
    labelCandidates.push({ priceUsd: p, text: `$${p.toFixed(2)}`, color: 'var(--text-dim)', priority: 1 })
  }
  labelCandidates.sort((a, b) => a.priority - b.priority)
  const axisLabels: AxisLabel[] = []
  for (const candidate of labelCandidates) {
    const cy = toY(candidate.priceUsd)
    const hasRoom = axisLabels.every((l) => Math.abs(toY(l.priceUsd) - cy) >= MIN_LABEL_PX)
    if (hasRoom) axisLabels.push(candidate)
  }

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mouseY = e.clientY - rect.top
    let closest = schedule.steps[0]
    let minDist = Infinity
    for (const step of schedule.steps) {
      const d = Math.abs(toY(parseFloat(step.triggerPriceUsd)) - mouseY)
      if (d < minDist) {
        minDist = d
        closest = step
      }
    }
    setTooltip({ clientX: e.clientX, clientY: e.clientY, step: closest })
  }

  const hoverPrice = tooltip ? parseFloat(tooltip.step.triggerPriceUsd) : null

  return (
    <>
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 0,
          padding: '12px 14px',
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
          Deleverage Ladder
        </div>

        <div ref={measureRef} style={{ width: '100%' }}>
          <svg
            ref={svgRef}
            width={svgWidth}
            height={HEIGHT}
            style={{ display: 'block', overflow: 'visible' }}
          >
            {/* Step trigger lines — thickness scales with sell fraction */}
            {schedule.steps.map((step) => {
              const sy = toY(parseFloat(step.triggerPriceUsd))
              return (
                <g key={step.stepIndex}>
                  <line
                    x1={PAD_LEFT}
                    y1={sy}
                    x2={PAD_LEFT + chartW}
                    y2={sy}
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth={
                      STEP_BASE_STROKE_PX +
                      (step.sellFractionBps / 10000) * STEP_STROKE_PER_FULL_SELL_PX
                    }
                  />
                  <text
                    x={PAD_LEFT + chartW + 4}
                    y={sy + 3}
                    textAnchor="start"
                    fontSize={9}
                    fontFamily="var(--font)"
                    fill="var(--text-muted)"
                  >
                    {(step.sellFractionBps / 100).toFixed(0)}%
                  </text>
                </g>
              )
            })}

            {/* Entry price marker */}
            {entryPrice != null && Number.isFinite(entryPrice) && (
              <line
                x1={PAD_LEFT}
                y1={toY(entryPrice)}
                x2={PAD_LEFT + chartW}
                y2={toY(entryPrice)}
                stroke={ENTRY_MARKER_COLOR}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )}

            {/* Current price marker */}
            {currentPrice != null && Number.isFinite(currentPrice) && (
              <line
                x1={PAD_LEFT}
                y1={toY(currentPrice)}
                x2={PAD_LEFT + chartW}
                y2={toY(currentPrice)}
                stroke={CURRENT_MARKER_COLOR}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )}

            {/* Debt-clear exit marker */}
            <line
              x1={PAD_LEFT}
              y1={toY(debtClearPrice)}
              x2={PAD_LEFT + chartW}
              y2={toY(debtClearPrice)}
              stroke={DEBT_CLEAR_COLOR}
              strokeWidth={1}
              strokeDasharray="6 3"
            />

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

            {/* Hover highlight */}
            {tooltip && hoverPrice != null && (
              <circle
                cx={PAD_LEFT + chartW / 2}
                cy={toY(hoverPrice)}
                r={3.5}
                fill="#ffffff"
                stroke="rgba(12,12,12,0.9)"
                strokeWidth={1}
                pointerEvents="none"
              />
            )}

            {/* Invisible interaction layer */}
            <rect
              x={PAD_LEFT}
              y={PAD_TOP}
              width={chartW}
              height={chartH}
              fill="transparent"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'crosshair' }}
            />
          </svg>
        </div>
      </div>

      {/* Tooltip — fixed position follows mouse */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.clientX + 12,
            top: tooltip.clientY - 40,
            background: 'rgba(20,20,20,0.96)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 0,
            padding: '5px 9px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              fontFamily: 'var(--font)',
            }}
          >
            ${tooltip.step.triggerPriceUsd}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              marginTop: 1,
              fontFamily: 'var(--font)',
            }}
          >
            Step {tooltip.step.stepIndex + 1} · sell{' '}
            {(tooltip.step.sellFractionBps / 100).toFixed(0)}%
          </div>
        </div>
      )}
    </>
  )
}
