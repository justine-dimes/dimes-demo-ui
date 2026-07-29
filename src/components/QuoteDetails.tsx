import { useState, useEffect, useMemo } from 'react'
import type { Offer } from '../api/types'
import { computeMaxGain } from '../api/types'
import { formatUsd } from '../utils/format'
import { formatFillPct } from '../utils/partialFill'
import { getDeleverageSchedule } from '../api/scheduled-deleveraging.types'
import { ScheduledDeleveragingPanel } from './ScheduledDeleveragingPanel'
import { StatRow } from './StatRow'

const USDC_UNITS_PER_USD = 1e6

/**
 * Net/gross maximum gain on a winning settlement (profit over principal),
 * computed client-side from the offer's USDC-unit fields via the SDK. Mirrors
 * the server's `expand=max_gain`: full token value at $1 minus notional, then
 * minus the open trading + origination fees. Excludes time-based lifetime fees,
 * so it is an upper bound; can be negative for very high-price entries.
 */
function maxGainForOffer(offer: Offer) {
  const positionTokenUnits = Number(offer.minExpectedPositionTokenUnits)
  const notionalUsdcUnits = Number(offer.notionalUsdcUnits)
  const expectedOpenTradingFeeUsdcUnits = Number(offer.expectedOpenTradingFeeUsdcUnits)
  const originationFeeUsdcUnits = Number(offer.originationFeeUsdcUnits)

  if (
    !Number.isFinite(positionTokenUnits) ||
    !Number.isFinite(notionalUsdcUnits) ||
    !Number.isFinite(expectedOpenTradingFeeUsdcUnits) ||
    !Number.isFinite(originationFeeUsdcUnits)
  ) {
    return null
  }

  return computeMaxGain({
    positionTokenUnits,
    notionalUsdcUnits,
    expectedOpenTradingFeeUsdcUnits,
    originationFeeUsdcUnits,
  })
}

function formatUsdcUnits(usdcUnits: number): string {
  return formatUsd(usdcUnits / USDC_UNITS_PER_USD)
}

export function QuoteDetails({
  offer,
  hideExpiry = false,
  previousOffer,
  quotedAt,
  onRefresh,
}: {
  offer: Offer
  hideExpiry?: boolean
  previousOffer?: Offer
  quotedAt?: number
  onRefresh?: () => void
}) {
  const expiresAtMs = useMemo(() => new Date(offer.expiresAt).getTime(), [offer.expiresAt])

  const [totalSeconds] = useState(() =>
    Math.max(1, Math.round((expiresAtMs - Date.now()) / 1000)),
  )
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)),
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAtMs])

  const prev = previousOffer

  const maxGain = useMemo(() => maxGainForOffer(offer), [offer])
  const prevMaxGain = useMemo(() => (prev ? maxGainForOffer(prev) : null), [prev])
  const deleverageSchedule = useMemo(() => getDeleverageSchedule(offer), [offer])

  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Quote Details
        </span>
        {quotedAt != null && hideExpiry && (
          <QuoteFreshness quotedAt={quotedAt} onRefresh={onRefresh} />
        )}
      </div>

      <StatRow label="Side" value={offer.effectiveSide.toUpperCase()} />
      <StatRow
        label="Leverage"
        value={`${(offer.leverageBps / 10000).toFixed(2)}x`}
        previousValue={prev ? `${(prev.leverageBps / 10000).toFixed(2)}x` : undefined}
      />
      <StatRow
        label="Entry Price"
        value={`$${offer.entryPriceUsd}`}
        previousValue={prev ? `$${prev.entryPriceUsd}` : undefined}
      />
      <StatRow
        label="Position Value"
        value={`$${offer.notionalAmountUsd}`}
        previousValue={prev ? `$${prev.notionalAmountUsd}` : undefined}
      />
      <StatRow
        label="Liquidation Price"
        value={`$${offer.currentLiquidationPriceUsd}`}
        valueColor="#F5A623"
        previousValue={prev ? `$${prev.currentLiquidationPriceUsd}` : undefined}
        chip={deleverageSchedule ? 'superseded by schedule' : undefined}
        deemphasized={deleverageSchedule != null}
      />
      {offer.allowPartialFill && (
        <StatRow
          label="Partial fill"
          value={offer.minFillBps != null ? `Allowed · min ${formatFillPct(offer.minFillBps)}` : 'Allowed'}
          valueColor="var(--yellow)"
        />
      )}

      {deleverageSchedule && (
        <ScheduledDeleveragingPanel
          schedule={deleverageSchedule}
          basis={{
            entryPriceUsd: offer.entryPriceUsd,
            notionalUsd: offer.notionalAmountUsd,
            collateralUsd: String(Number(offer.collateralUsdcUnits) / USDC_UNITS_PER_USD),
            positionTokenUnits: offer.minExpectedPositionTokenUnits,
          }}
          side={offer.effectiveSide === 'no' ? 'no' : 'yes'}
          liquidationPriceUsd={offer.currentLiquidationPriceUsd}
          showComparison
          last
        />
      )}

      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '8px 0',
        }}
      />

      <StatRow
        label="Collateral"
        value={`$${(Number(offer.collateralUsdcUnits) / 1e6).toFixed(2)}`}
        previousValue={prev ? `$${(Number(prev.collateralUsdcUnits) / 1e6).toFixed(2)}` : undefined}
      />
      <StatRow
        label="Origination Fee"
        value={`${(offer.originationFeeBps / 100).toFixed(2)}% ($${offer.originationFeeUsd})`}
        previousValue={prev ? `${(prev.originationFeeBps / 100).toFixed(2)}% ($${prev.originationFeeUsd})` : undefined}
      />
      {offer.partnerOriginationFeeBps > 0 && (
        <>
          <StatRow
            label="  · Protocol"
            value={`${(offer.protocolOriginationFeeBps / 100).toFixed(2)}% ($${offer.protocolOriginationFeeUsd})`}
          />
          <StatRow
            label="  · Partner"
            value={`${(offer.partnerOriginationFeeBps / 100).toFixed(2)}% ($${offer.partnerOriginationFeeUsd})`}
          />
        </>
      )}
      <StatRow
        label="Polymarket Fee"
        value={`$${offer.expectedOpenTradingFeeUsd}`}
        previousValue={prev ? `$${prev.expectedOpenTradingFeeUsd}` : undefined}
      />
      <StatRow label="Time-based fee" value="0.01%" />

      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '8px 0',
        }}
      />

      <StatRow
        label="You pay"
        value={`$${offer.totalUserAmountUsd}`}
        valueColor="#ffffff"
        previousValue={prev ? `$${prev.totalUserAmountUsd}` : undefined}
      />

      {maxGain && (
        <>
          <StatRow
            label="Max gain on win"
            value={formatUsdcUnits(maxGain.netMaxGainUsdcUnits)}
            valueColor={maxGain.netMaxGainUsdcUnits >= 0 ? '#44FF97' : '#F5A623'}
            previousValue={
              prevMaxGain ? formatUsdcUnits(prevMaxGain.netMaxGainUsdcUnits) : undefined
            }
          />
          <StatRow
            label="  · Before fees"
            value={formatUsdcUnits(maxGain.grossMaxGainUsdcUnits)}
          />
        </>
      )}

      {!hideExpiry && <QuoteExpiryBar secondsLeft={secondsLeft} totalSeconds={totalSeconds} />}
    </div>
  )
}

function lerpColor(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
) {
  const c = Math.min(1, Math.max(0, t))
  return `rgb(${Math.round(r1 + (r2 - r1) * c)},${Math.round(g1 + (g2 - g1) * c)},${Math.round(b1 + (b2 - b1) * c)})`
}

function freshnessColor(age: number) {
  // 0s = green(68,255,151) → 20s = yellow(245,166,35) → 45s+ = gray(85,85,85)
  if (age <= 20) return lerpColor(68, 255, 151, 245, 166, 35, age / 20)
  return lerpColor(245, 166, 35, 85, 85, 85, (age - 20) / 25)
}

function QuoteFreshness({
  quotedAt,
  onRefresh,
}: {
  quotedAt: number
  onRefresh?: () => void
}) {
  const [age, setAge] = useState(() => Math.round((Date.now() - quotedAt) / 1000))

  useEffect(() => {
    const interval = setInterval(() => {
      setAge(Math.round((Date.now() - quotedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [quotedAt])

  const color = freshnessColor(age)
  const glowOpacity = Math.max(0, 1 - age / 20)
  const pulseSpeed = age < 10 ? 2 : age < 20 ? 3 : 0

  const label = age < 60
    ? `${age}s ago`
    : `${Math.floor(age / 60)}m ago`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color,
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 1s linear',
        }}
      >
        {label}
      </span>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          flexShrink: 0,
          boxShadow: glowOpacity > 0 ? `0 0 6px rgba(68,255,151,${glowOpacity.toFixed(2)})` : 'none',
          animation: pulseSpeed > 0 ? `quoteFreshPulse ${pulseSpeed}s ease-in-out infinite` : 'none',
          transition: 'background 1s linear, box-shadow 1s linear',
        }}
      />
      {age >= 15 && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          style={{
            background: 'none',
            border: 'none',
            color,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            fontFamily: 'var(--font)',
            transition: 'color 1s linear',
          }}
        >
          Refresh
        </button>
      )}
      <style>{`
        @keyframes quoteFreshPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

function QuoteExpiryBar({
  secondsLeft,
  totalSeconds,
}: {
  secondsLeft: number
  totalSeconds: number
}) {
  const pct = Math.max(0, Math.min(1, secondsLeft / totalSeconds))
  const expired = secondsLeft <= 0
  const urgent = secondsLeft > 0 && secondsLeft <= Math.max(3, Math.floor(totalSeconds / 3))

  const barColor = expired
    ? 'rgba(255,255,255,0.15)'
    : urgent
      ? '#F5A623'
      : 'var(--yellow)'
  const labelColor = expired
    ? 'var(--text-dim)'
    : urgent
      ? '#F5A623'
      : 'var(--text-muted)'

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: labelColor,
          }}
        >
          {expired ? 'Quote expired' : 'Quote valid'}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: labelColor,
          }}
        >
          {expired ? '0s' : `${secondsLeft}s`}
        </span>
      </div>
      <div
        style={{
          height: 3,
          width: '100%',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct * 100}%`,
            background: barColor,
            borderRadius: 0,
            transition: 'width 1s linear, background 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}
