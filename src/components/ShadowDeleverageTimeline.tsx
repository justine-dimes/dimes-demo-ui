import { useState } from 'react'
import type {
  ShadowDeleverageView,
  ShadowDeleverageStepView,
} from '../api/scheduled-deleveraging.types'
import type { PositionUnwind, PositionUnwindList } from '../api/types'
import { formatCentsUsd } from '../utils/deleverageSchedule'
import { ChartFrame, DEBT_CLEAR_COLOR } from './DeleverageScheduleCharts'
import { useMeasuredWidth } from './useMeasuredWidth'

// ---------------------------------------------------------------------------
// Engine vs shadow, over time. Engine unwinds carry timestamps and leverage
// but no price, so a shared price axis would be dishonest — instead the two
// streams sit on aligned event lanes over one time axis: what the engine
// actually did (orange) against what the printed schedule would have done in
// shadow (blue). Prices appear only where they are real: on the shadow
// markers, whose trigger price and recorded bid come from the API.
// ---------------------------------------------------------------------------

// Orange = the engine/liquidation accent used across the app.
const ENGINE_COLOR = '#F5A623'
const LANE_LINE_COLOR = 'rgba(255,255,255,0.08)'

const PAD_LEFT = 10
const PAD_RIGHT = 10
const PAD_TOP = 20
const PAD_BOTTOM = 18
const HEIGHT = 128
const ENGINE_LANE_FRACTION = 0.28
const SHADOW_LANE_FRACTION = 0.72
const MARKER_RADIUS = 4
const HOVER_HIT_RADIUS = 14
const DOMAIN_PAD_FRACTION = 0.06
const SINGLE_EVENT_PAD_MS = 30 * 60 * 1000

interface TimelineEvent {
  kind: 'engine' | 'shadow'
  at: Date
  engine?: PositionUnwind
  shadow?: ShadowDeleverageStepView
}

interface TooltipState {
  clientX: number
  clientY: number
  event: TimelineEvent
}

function buildEvents(
  shadow: ShadowDeleverageView,
  unwinds: PositionUnwindList | undefined,
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const unwind of unwinds?.data ?? []) {
    events.push({ kind: 'engine', at: new Date(unwind.executedAt), engine: unwind })
  }
  for (const step of shadow.steps) {
    events.push({ kind: 'shadow', at: new Date(step.triggeredAt), shadow: step })
  }
  return events.filter((event) => Number.isFinite(event.at.getTime()))
}

function formatEventTime(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function shadowStepTitle(step: ShadowDeleverageStepView): string {
  return step.triggerKind === 'debtClear'
    ? 'Shadow debt-clear exit'
    : `Shadow step ${step.stepIndex + 1}`
}

export function ShadowDeleverageTimeline({
  shadow,
  unwinds,
}: {
  shadow: ShadowDeleverageView
  unwinds?: PositionUnwindList
}) {
  const events = buildEvents(shadow, unwinds)

  return (
    <div style={{ marginTop: 10 }}>
      {events.length > 0 ? (
        <TimelineChart events={events} />
      ) : (
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            padding: '12px 14px',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          No deleverage activity yet — neither the engine nor the shadow schedule has fired.
        </div>
      )}
      {shadow.settlement != null ? (
        <SettlementStrip settlement={shadow.settlement} />
      ) : (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 10,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
          }}
        >
          Shadow steps are recorded, not executed — the engine remains the position's real
          manager.
        </p>
      )}
    </div>
  )
}

function TimelineChart({ events }: { events: TimelineEvent[] }) {
  const { width, measureRef } = useMeasuredWidth(300)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const chartW = width - PAD_LEFT - PAD_RIGHT
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const engineLaneY = PAD_TOP + chartH * ENGINE_LANE_FRACTION
  const shadowLaneY = PAD_TOP + chartH * SHADOW_LANE_FRACTION

  const times = events.map((event) => event.at.getTime())
  const rawMin = Math.min(...times)
  const rawMax = Math.max(...times)
  const rawRange = rawMax - rawMin || 2 * SINGLE_EVENT_PAD_MS
  const domainMin = rawMin - rawRange * DOMAIN_PAD_FRACTION
  const domainMax = rawMax + rawRange * DOMAIN_PAD_FRACTION
  const toX = (d: Date) =>
    PAD_LEFT + ((d.getTime() - domainMin) / (domainMax - domainMin)) * chartW
  const laneY = (event: TimelineEvent) => (event.kind === 'engine' ? engineLaneY : shadowLaneY)

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left + PAD_LEFT
    const mouseY = e.clientY - rect.top + PAD_TOP
    let closest: TimelineEvent | null = null
    let minDist = Infinity
    for (const event of events) {
      const dx = toX(event.at) - mouseX
      const dy = laneY(event) - mouseY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < minDist) {
        minDist = dist
        closest = event
      }
    }
    if (closest && minDist <= HOVER_HIT_RADIUS) {
      setTooltip({ clientX: e.clientX, clientY: e.clientY, event: closest })
    } else {
      setTooltip(null)
    }
  }

  return (
    <>
      <ChartFrame title="Engine vs Shadow Timeline" measureRef={measureRef}>
        <svg width={width} height={HEIGHT} style={{ display: 'block', overflow: 'visible' }}>
          {/* Lane guides + labels */}
          {[
            { y: engineLaneY, label: 'Engine (actual)', color: ENGINE_COLOR },
            { y: shadowLaneY, label: 'Schedule (shadow)', color: DEBT_CLEAR_COLOR },
          ].map((lane) => (
            <g key={lane.label}>
              <line
                x1={PAD_LEFT}
                y1={lane.y}
                x2={PAD_LEFT + chartW}
                y2={lane.y}
                stroke={LANE_LINE_COLOR}
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT}
                y={lane.y - 8}
                textAnchor="start"
                fontSize={9}
                fontFamily="var(--font)"
                fill={lane.color}
              >
                {lane.label}
              </text>
            </g>
          ))}

          {/* Event markers — square = shadow debt-clear, circle = everything else */}
          {events.map((event, i) => {
            const x = toX(event.at)
            const y = laneY(event)
            const color = event.kind === 'engine' ? ENGINE_COLOR : DEBT_CLEAR_COLOR
            const isDebtClear = event.shadow?.triggerKind === 'debtClear'
            const isHovered = tooltip?.event === event
            const r = MARKER_RADIUS + (isHovered ? 1.5 : 0)
            return isDebtClear ? (
              <rect
                key={i}
                x={x - r}
                y={y - r}
                width={r * 2}
                height={r * 2}
                fill={color}
                stroke="rgba(12,12,12,0.9)"
                strokeWidth={1}
              />
            ) : (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={r}
                fill={color}
                stroke="rgba(12,12,12,0.9)"
                strokeWidth={1}
              />
            )
          })}

          {/* Time axis bounds */}
          <text
            x={PAD_LEFT}
            y={PAD_TOP + chartH + 13}
            textAnchor="start"
            fontSize={9}
            fontFamily="var(--font)"
            fill="var(--text-dim)"
          >
            {formatEventTime(new Date(rawMin))}
          </text>
          {rawMax > rawMin && (
            <text
              x={PAD_LEFT + chartW}
              y={PAD_TOP + chartH + 13}
              textAnchor="end"
              fontSize={9}
              fontFamily="var(--font)"
              fill="var(--text-dim)"
            >
              {formatEventTime(new Date(rawMax))}
            </text>
          )}

          {/* Invisible interaction layer */}
          <rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={Math.max(0, chartW)}
            height={chartH}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
            style={{ cursor: 'crosshair' }}
          />
        </svg>
      </ChartFrame>

      {tooltip && <EventTooltip tooltip={tooltip} />}
    </>
  )
}

function EventTooltip({ tooltip }: { tooltip: TooltipState }) {
  const { event } = tooltip
  const color = event.kind === 'engine' ? ENGINE_COLOR : DEBT_CLEAR_COLOR

  return (
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
        maxWidth: 240,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color, fontFamily: 'var(--font)' }}>
        {event.engine != null
          ? 'Engine deleverage'
          : event.shadow != null
            ? shadowStepTitle(event.shadow)
            : ''}
      </div>
      {event.engine != null && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
          {(event.engine.beforeLeverageBps / 10000).toFixed(1)}x →{' '}
          {(event.engine.afterLeverageBps / 10000).toFixed(1)}x
        </div>
      )}
      {event.shadow != null && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
          trigger {formatCentsUsd(event.shadow.triggerPriceUsd)} · recorded bid{' '}
          {formatCentsUsd(event.shadow.shadowRecordedBidUsd)} · target sell ≈
          {event.shadow.tokensToSellTarget.toFixed(0)} tokens
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font)', marginTop: 1 }}>
        {formatEventTime(event.at)}
        {event.kind === 'shadow' && <span style={{ marginLeft: 4 }}>· recorded, not executed</span>}
      </div>
      {event.engine?.reasonDetail != null && (
        <div
          style={{
            fontSize: 10,
            lineHeight: 1.35,
            color: '#F7D49C',
            fontFamily: 'var(--font)',
            marginTop: 4,
            whiteSpace: 'normal',
          }}
        >
          {event.engine.reasonDetail}
        </div>
      )}
    </div>
  )
}

function SettlementStrip({
  settlement,
}: {
  settlement: NonNullable<ShadowDeleverageView['settlement']>
}) {
  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid rgba(91,156,245,0.25)',
        background: 'rgba(91,156,245,0.05)',
        padding: '8px 12px',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.5,
        }}
      >
        Engine ended:{' '}
        <strong style={{ color: ENGINE_COLOR }}>${settlement.engineEndValueUsd}</strong>
        {' · '}Schedule would have ended:{' '}
        <strong style={{ color: DEBT_CLEAR_COLOR }}>
          ~${settlement.shadowEstimatedEndValueUsd}
        </strong>
        <span style={{ color: 'var(--text-muted)' }}>
          {' '}({settlement.shadowStepsFired} shadow step
          {settlement.shadowStepsFired === 1 ? '' : 's'} fired)
        </span>
      </div>
      <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.5, color: 'var(--text-dim)' }}>
        Estimate assumes every shadow step filled at its recorded bid — order-book depth and
        slippage are not modelled.
      </div>
    </div>
  )
}
