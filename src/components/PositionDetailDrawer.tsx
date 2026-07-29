import { useEffect, useState } from 'react'
import type {
  Position,
  OpenPosition,
  ClosedPosition,
  PositionUnwindList,
} from '../api/types'
import { isOpenPosition, getOriginationFeeBreakdown } from '../api/types'
import { useQueryClient } from '@tanstack/react-query'
import { useRequestClose, useRequestPartialClose } from '../contract/hooks'
import { useRequestClosePushFunded, useRequestPartialClosePushFunded } from '../contract/pushFundedHooks'
import { useRequestCloseSmart, useRequestPartialCloseSmart } from '../contract/smartWalletHooks'
import { CopyableTitle } from './CopyableTitle'
import { PartialCloseSlider } from './PartialCloseSlider'
import { PartialCloseChart } from './PartialCloseChart'
import { useCancelPosition } from '../hooks/useCancelPosition'
import { useContractInfo } from '../hooks/useContractInfo'
import { usePartialCloses } from '../hooks/usePartialCloses'
import { useAuthStore } from '../store/auth'
import { formatSlippageBps } from '../utils/format'
import { ErrorBanner } from './ErrorBanner'
import { StatRow } from './StatRow'
import { StatGroup, PnlHero } from './CardViewParts'
import { LeverageChart } from './LeverageChart'
import { getDeleverageSchedule, getShadowDeleverage } from '../api/scheduled-deleveraging.types'
import { ScheduledDeleveragingPanel } from './ScheduledDeleveragingPanel'
import { PositionIdRow } from './PositionCard'
import { useCopyFlash } from '../hooks/useCopyFlash'

export function PositionDetailDrawer({
  position,
  unwinds,
  isUnwindsLoading,
  open,
  onClose,
}: {
  position: Position | null
  unwinds?: PositionUnwindList
  isUnwindsLoading?: boolean
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <div
        className={`trade-drawer-backdrop${open ? ' trade-drawer-backdrop--open' : ''}`}
        onClick={onClose}
      />
      <div className={`trade-drawer${open ? ' trade-drawer--open' : ''}`}>
        <div className="trade-drawer__inner dimes-scroll">
          {position && isOpenPosition(position) && (
            <OpenPositionDetail
              position={position}
              unwinds={unwinds}
              isUnwindsLoading={isUnwindsLoading}
              onClose={onClose}
            />
          )}
          {position && !isOpenPosition(position) && (
            <ClosedPositionDetail
              position={position as ClosedPosition}
              unwinds={unwinds}
              isUnwindsLoading={isUnwindsLoading}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </>
  )
}

function DrawerHeader({
  title,
  marketTicker,
  positionId,
  onClose,
  badges,
}: {
  title: string
  marketTicker: string
  positionId?: string
  onClose: () => void
  badges: React.ReactNode
}) {
  const { isCopied, copy } = useCopyFlash()
  return (
    <div style={{ padding: '20px 24px 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <CopyableTitle text={title} copyValue={marketTicker} fontSize={15} lineClamp={3} />
          {positionId && (
            <PositionIdRow
              positionId={positionId}
              copied={isCopied('positionId')}
              onCopy={(e) => {
                e.stopPropagation()
                copy(positionId, 'positionId')
              }}
            />
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {badges}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            fontSize: 18,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function Badge({
  label,
  color,
  bg,
  borderColor,
}: {
  label: string
  color: string
  bg: string
  borderColor: string
}) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        padding: '2px 8px',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  )
}

function OpenPositionDetail({
  position,
  unwinds,
  isUnwindsLoading = false,
  onClose,
}: {
  position: OpenPosition
  unwinds?: PositionUnwindList
  isUnwindsLoading?: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const cancelMutation = useCancelPosition()
  const { data: contractInfo } = useContractInfo()

  // Close routing mirrors open: AA smart wallet (userOp) > deposit-wallet
  // relayer batch > direct requestClose.
  const depositWalletMode = useAuthStore((s) => s.depositWalletMode)
  const smartWalletMode = useAuthStore((s) => s.smartWalletAddress != null)
  const eoaClose = useRequestClose()
  const pushFundedClose = useRequestClosePushFunded()
  const smartClose = useRequestCloseSmart()
  const activeClose = smartWalletMode ? smartClose : depositWalletMode ? pushFundedClose : eoaClose
  const requestClose = activeClose.requestClose
  const isCloseSigning = activeClose.isPending
  const isCloseConfirming = activeClose.isConfirming
  const isCloseConfirmed = activeClose.isSuccess
  const closeChainError = activeClose.error
  const closeReceiptError = activeClose.receiptError
  const closeSimError = smartWalletMode
    ? smartClose.verifyError
    : depositWalletMode
      ? pushFundedClose.verifyError
      : eoaClose.simulateError
  const resetClose = activeClose.reset

  // Partial-close routing mirrors close: AA smart wallet > deposit-wallet > EOA.
  const eoaPartialClose = useRequestPartialClose()
  const pushFundedPartialClose = useRequestPartialClosePushFunded()
  const smartPartialClose = useRequestPartialCloseSmart()
  const activePartialClose = smartWalletMode
    ? smartPartialClose
    : depositWalletMode
      ? pushFundedPartialClose
      : eoaPartialClose
  const requestPartialClose = activePartialClose.requestPartialClose
  const isPartialCloseSigning = activePartialClose.isPending
  const isPartialCloseConfirming = activePartialClose.isConfirming
  const isPartialCloseConfirmed = activePartialClose.isSuccess
  const partialCloseChainError = activePartialClose.error
  const partialCloseReceiptError = activePartialClose.receiptError
  const partialCloseSimError = smartWalletMode
    ? smartPartialClose.verifyError
    : depositWalletMode
      ? pushFundedPartialClose.verifyError
      : eoaPartialClose.simulateError
  const resetPartialClose = activePartialClose.reset

  const displayTitle = position.marketTitle || position.marketTicker
  const isYes = position.side === 'yes'

  useEffect(() => {
    if (isCloseConfirmed) {
      queryClient.invalidateQueries({ queryKey: ['dimes', 'positions'] })
    }
  }, [isCloseConfirmed, queryClient])

  useEffect(() => {
    if (isPartialCloseConfirmed) {
      queryClient.invalidateQueries({ queryKey: ['dimes', 'positions'] })
    }
  }, [isPartialCloseConfirmed, queryClient])

  const isPendingPosition = position.status === 'pending'
  const isOpenPos = position.status === 'open'
  const isUnwindingPos = position.status === 'unwinding'
  const isVoided = position.timing.isVoided && position.timing.isSettlementPending
  const canAct = (isPendingPosition || isOpenPos) && !isUnwindingPos && !isVoided

  const cancelSucceeded = cancelMutation.isSuccess && cancelMutation.data === 'cancelled'
  const cancelAlreadyInFlight = cancelMutation.isSuccess && cancelMutation.data === 'already_cancelling'
  const isBusy = cancelMutation.isPending || cancelSucceeded || isCloseSigning || isCloseConfirming
  const [confirming, setConfirming] = useState(false)
  const actionError: unknown = isPendingPosition
    ? cancelMutation.error
    : closeSimError ?? closeChainError ?? closeReceiptError

  const handleAction = () => {
    if (isBusy) return
    if (cancelAlreadyInFlight) cancelMutation.reset()
    if (isPendingPosition) {
      cancelMutation.mutate(position.id)
      return
    }
    if (isOpenPos) {
      if (!contractInfo?.polygonVaultContractAddress) return
      requestClose(contractInfo.polygonVaultContractAddress, position.onChainPositionKey)
    }
  }

  const dismissError = () => {
    if (isPendingPosition) cancelMutation.reset()
    else resetClose()
  }

  const pendingOperation = position.pendingOperation
  const minPartialCloseTokenUnits = position.current.minPartialCloseTokenUnits
  const maxPartialCloseTokenUnits = position.current.maxPartialCloseTokenUnits
  const isPartialCloseable =
    isOpenPos &&
    pendingOperation == null &&
    minPartialCloseTokenUnits != null &&
    maxPartialCloseTokenUnits != null &&
    BigInt(maxPartialCloseTokenUnits) >= BigInt(minPartialCloseTokenUnits)

  const isPartialCloseBusy = isPartialCloseSigning || isPartialCloseConfirming
  const [reducing, setReducing] = useState(false)
  const [partialCloseUnits, setPartialCloseUnits] = useState<bigint | null>(null)
  const partialCloseError: unknown = partialCloseSimError ?? partialCloseChainError ?? partialCloseReceiptError

  const beginReduce = () => {
    if (minPartialCloseTokenUnits == null) return
    setPartialCloseUnits(BigInt(minPartialCloseTokenUnits))
    setReducing(true)
  }

  const handlePartialClose = () => {
    if (isPartialCloseBusy || partialCloseUnits == null) return
    if (!contractInfo?.polygonVaultContractAddress) return
    requestPartialClose(contractInfo.polygonVaultContractAddress, position.onChainPositionKey, partialCloseUnits)
  }

  const partialCloseButtonLabel = (() => {
    if (isPartialCloseSigning) return 'Confirm in wallet...'
    if (isPartialCloseConfirming) return 'Reducing...'
    if (isPartialCloseConfirmed) return 'Reduce requested'
    return 'Confirm reduction'
  })()

  const buttonLabel = (() => {
    if (cancelMutation.isPending) return 'Cancelling...'
    if (cancelSucceeded || cancelAlreadyInFlight) return 'Cancel requested'
    if (cancelMutation.error) return 'Retry cancel'
    if (isCloseSigning) return 'Confirm in wallet...'
    if (isCloseConfirming) return 'Closing...'
    if (isCloseConfirmed) return 'Close requested'
    return isPendingPosition ? 'Cancel Position' : 'Close Position'
  })()

  const pnlValue = parseFloat(position.current.unrealizedPnlUsd)
  const pnlColor = pnlValue >= 0 ? 'var(--green)' : 'var(--red)'
  const pnlPrefix = pnlValue >= 0 ? '+' : ''
  const roePct = (position.current.unrealizedPnlBps / 100).toFixed(1)

  const accruedFees =
    parseFloat(position.fees.accruedLifetimeFeeUsd) +
    parseFloat(position.fees.pendingLifetimeFeeUsd)
  // Lifetime (time-based) fee, sourced from the API. Express the headline as an
  // APR and a 4-hour accrual period (APR ÷ (365×24/4) = APR ÷ 2190).
  const lifetimeAprPct = position.fees.lifetimeAprBps / 100
  const lifetimeFourHrPct = (lifetimeAprPct * 4) / (365 * 24)
  const netPnlValue = pnlValue - accruedFees
  const netPnlColor = netPnlValue >= 0 ? 'var(--green)' : 'var(--red)'
  const netPnlPrefix = netPnlValue >= 0 ? '+' : ''
  const filledPrice = position.entry.effectiveEntryPriceUsd
  const slippageBps = position.entry.effectiveSlippageBps
  const slippageText = formatSlippageBps(slippageBps ?? null)
  const entryCollateral = parseFloat(position.entry.collateralUsd)
  const netRoePct = entryCollateral > 0 ? (netPnlValue / entryCollateral) * 100 : 0

  const isFullyDeleveraged = position.current.bookLeverageBps <= 10000

  const deleverageSchedule = getDeleverageSchedule(position)
  const shadowDeleverage = getShadowDeleverage(position)

  const currentPrice = parseFloat(position.current.markPriceUsd)
  const liquidationPrice = parseFloat(position.risk.currentLiquidationPriceUsd)
  // Straight gap to the liquidation barrier as a % of the current price. Guard
  // a missing/zero liquidation price (the source of false 0s) — a genuine 0%
  // only shows when the price is sitting on the barrier.
  let distancePctDisplay = '—'
  if (!isFullyDeleveraged && currentPrice > 0 && liquidationPrice > 0) {
    const pct = (Math.abs(currentPrice - liquidationPrice) / currentPrice) * 100
    distancePctDisplay = `${pct.toFixed(1)}%`
  }

  const isInFlight = position.status === 'pending' || position.status === 'closing' || position.status === 'settling' || isUnwindingPos
  const statusLabel = isVoided ? 'voided' : position.status === 'pending' ? 'created' : position.status

  return (
    <div>
      <DrawerHeader
        title={displayTitle}
        marketTicker={position.marketTicker}
        positionId={position.id}
        onClose={onClose}
        badges={
          <>
            <Badge
              label={isYes ? 'YES' : 'NO'}
              color={isYes ? 'var(--green)' : 'var(--red)'}
              bg={isYes ? 'var(--green-soft)' : 'var(--red-soft)'}
              borderColor={isYes ? 'rgba(68,255,151,0.2)' : 'rgba(224,82,82,0.2)'}
            />
            <Badge
              label={statusLabel}
              color={
                isVoided ? '#A78BFA'
                  : position.status === 'open' ? 'var(--green)'
                  : isUnwindingPos ? '#5B9CF5'
                  : isInFlight ? '#F5A623'
                  : 'var(--text-muted)'
              }
              bg={
                isVoided ? 'rgba(167,139,250,0.08)'
                  : position.status === 'open' ? 'var(--green-soft)'
                  : isUnwindingPos ? 'rgba(91,156,245,0.08)'
                  : isInFlight ? 'rgba(245,166,35,0.08)'
                  : 'rgba(136,136,136,0.08)'
              }
              borderColor={
                isVoided ? 'rgba(167,139,250,0.2)'
                  : position.status === 'open' ? 'rgba(68,255,151,0.2)'
                  : isUnwindingPos ? 'rgba(91,156,245,0.2)'
                  : isInFlight ? 'rgba(245,166,35,0.2)'
                  : 'rgba(136,136,136,0.2)'
              }
            />
          </>
        }
      />

      <div style={{ padding: '0 24px 24px' }}>
        {isVoided && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.18)',
              borderRadius: 0,
              padding: '10px 12px',
              marginBottom: 14,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <span style={{ fontSize: 12, color: '#A78BFA', lineHeight: 1.4 }}>
              Market voided — all tokens settling at $0.50
            </span>
          </div>
        )}

        {isUnwindingPos && !isVoided && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(91,156,245,0.06)',
              border: '1px solid rgba(91,156,245,0.18)',
              borderRadius: 0,
              padding: '10px 12px',
              marginBottom: 14,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B9CF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span style={{ fontSize: 12, color: '#5B9CF5', lineHeight: 1.4 }}>
              Deleveraging in progress.
            </span>
          </div>
        )}

        <StatGroup label="Pricing">
          <StatRow label="Quote Price" value={`$${position.entry.priceUsd}`} />
          <StatRow
            label="Filled Price"
            value={filledPrice ? `$${filledPrice}` : 'Pending fill'}
            valueColor={filledPrice ? undefined : 'var(--text-muted)'}
          />
          <StatRow
            label={isVoided ? 'Settlement Price' : 'Current Price'}
            value={`$${position.current.markPriceUsd}`}
            valueColor={isVoided ? '#A78BFA' : undefined}
          />
          {!isVoided && (
            <StatRow label="Last exit price" value={`$${position.current.markPriceUsd}`} />
          )}
          {!isFullyDeleveraged && !isVoided && (
            <>
              <StatRow
                label="Liquidation Price"
                value={`$${position.risk.currentLiquidationPriceUsd}`}
                valueColor="#F5A623"
              />
              <StatRow label="Distance to liquidation" value={distancePctDisplay} />
            </>
          )}
        </StatGroup>

        <StatGroup label="Position Size">
          {(() => {
            // Frozen initial fill from the API — how much of the requested size opened.
            // Does not move on partial close (that's tracked by "Remaining" below).
            const reqNotional = parseFloat(position.entry.notionalUsd)
            const initialFillPct =
              position.entry.initialFillBps != null ? position.entry.initialFillBps / 100 : null
            if (initialFillPct == null || initialFillPct >= 99.5) return null
            const openNotional = reqNotional * (initialFillPct / 100)
            return (
              <>
                <StatRow label="Requested Notional" value={`$${reqNotional.toFixed(2)}`} />
                <StatRow
                  label="Filled at open"
                  value={`${initialFillPct.toFixed(0)}% ($${openNotional.toFixed(2)})`}
                  valueColor="var(--yellow)"
                />
              </>
            )
          })()}
          {(() => {
            // Remaining size after any partial closes — expected to fall below 100%
            // and is not a fill problem.
            const remainingBps = position.current.remainingBps
            if (remainingBps == null || remainingBps >= 9950) return null
            return (
              <StatRow
                label="Remaining after partial closes"
                value={`${(remainingBps / 100).toFixed(0)}% of original`}
              />
            )
          })()}
          <StatRow
            label="Current Collateral"
            value={`$${parseFloat(position.current.collateralUsd).toFixed(2)}`}
          />
          <StatRow
            label="Current Notional"
            value={`$${parseFloat(position.current.notionalUsd).toFixed(2)}`}
          />
          {!isFullyDeleveraged && (
            <StatRow
              label="Margin Buffer"
              value={`$${parseFloat(position.risk.marginBufferUsd).toFixed(2)}`}
            />
          )}
        </StatGroup>

        <PartialCloseHistorySection position={position} />

        <StatGroup label="PnL & Fees">
          <StatRow
            label="PnL gross / ROE"
            value={`${pnlPrefix}$${Math.abs(pnlValue).toFixed(2)} (${pnlPrefix}${roePct}%)`}
            valueColor={pnlColor}
          />
          <StatRow
            label="PnL net / ROE"
            value={`${netPnlPrefix}$${Math.abs(netPnlValue).toFixed(2)} (${netPnlPrefix}${netRoePct.toFixed(1)}%)`}
            valueColor={netPnlColor}
          />
          {(() => {
            const fee = getOriginationFeeBreakdown(position)
            return (
              <>
                <StatRow
                  label="Origination Fee"
                  value={`$${fee.totalUsd.toFixed(2)} (${(fee.totalBps / 100).toFixed(2)}%)`}
                />
                {fee.partnerBps > 0 && (
                  <>
                    <StatRow
                      nested
                      label="Protocol"
                      value={`$${fee.protocolUsd.toFixed(2)} (${(fee.protocolBps / 100).toFixed(2)}%)`}
                    />
                    <StatRow
                      nested
                      label="Partner"
                      value={`$${fee.partnerUsd.toFixed(2)} (${(fee.partnerBps / 100).toFixed(2)}%)`}
                    />
                  </>
                )}
              </>
            )
          })()}
          <StatRow
            label="Time-based fees accrued"
            value={`$${accruedFees.toFixed(2)}`}
            valueColor="var(--text-muted)"
          />
          <StatRow label="Time-based fee rate" value={`${lifetimeAprPct.toFixed(2)}% APR`} />
          <StatRow label="Time-based fee rate (4-hr)" value={`${lifetimeFourHrPct.toFixed(4)}%`} />
          <StatRow
            label="Total fees paid"
            value={`$${(parseFloat(position.entry.originationFeeUsd) + accruedFees).toFixed(2)}`}
            valueColor="var(--text)"
          />
          <StatRow
            label="Execution Slippage"
            value={slippageText ?? 'Pending fill'}
            valueColor="#ffffff"
          />
        </StatGroup>

        <StatGroup label="Leverage">
          <StatRow
            label="Starting"
            value={`${(position.entry.leverageBps / 10000).toFixed(1)}x`}
          />
          <StatRow
            label="Current"
            value={`${(position.current.bookLeverageBps / 10000).toFixed(1)}x`}
          />
          <StatRow
            label="Weighted"
            value={`${(position.effectiveLeverageBps / 10000).toFixed(1)}x`}
          />
          <div style={{ marginTop: 10 }}>
            <LeverageChart unwinds={unwinds} isLoading={isUnwindsLoading} />
          </div>
        </StatGroup>

        {deleverageSchedule && (
          <ScheduledDeleveragingPanel
            schedule={deleverageSchedule}
            basis={{
              entryPriceUsd: position.entry.effectiveEntryPriceUsd ?? position.entry.priceUsd,
              notionalUsd: position.entry.notionalUsd,
              collateralUsd: position.entry.collateralUsd,
              positionTokenUnits:
                position.entry.positionTokenUnits ?? position.current.positionTokenUnits,
            }}
            side={position.side === 'no' ? 'no' : 'yes'}
            currentPriceUsd={position.current.markPriceUsd}
            shadowDeleverage={shadowDeleverage}
            unwinds={unwinds}
          />
        )}

        <StatGroup label="Timing" last>
          <StatRow label="Market Status" value={isVoided ? 'Voided' : position.timing.marketStatus} />
          {position.timing.isSettlementPending && (
            <StatRow
              label="Settlement"
              value="Pending"
              valueColor={isVoided ? '#A78BFA' : '#F5A623'}
            />
          )}
        </StatGroup>

        {canAct && !confirming && (
          <button
            onClick={() => {
              if (isBusy) return
              if (cancelMutation.error || closeSimError || closeChainError || closeReceiptError) {
                handleAction()
                return
              }
              setConfirming(true)
            }}
            disabled={isBusy}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 0,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: isBusy ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)',
              fontSize: 14,
              fontWeight: 500,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font)',
              marginTop: 16,
              transition: 'border-color 0.2s',
            }}
          >
            {buttonLabel}
          </button>
        )}

        {canAct && confirming && (
          <div
            style={{
              marginTop: 16,
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: 'var(--text)',
                marginBottom: 10,
                lineHeight: 1.4,
              }}
            >
              {isPendingPosition
                ? 'Cancel this pending position? Your collateral will be returned once the cancellation is processed.'
                : 'Close this position? This will request an on-chain unwind at the current market price.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 0,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                Keep open
              </button>
              <button
                onClick={() => {
                  setConfirming(false)
                  handleAction()
                }}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 0,
                  border: '1px solid rgba(224,82,82,0.4)',
                  background: 'rgba(224,82,82,0.08)',
                  color: 'var(--red)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                {isPendingPosition ? 'Cancel position' : 'Close position'}
              </button>
            </div>
          </div>
        )}

        {isOpenPos && pendingOperation?.type === 'partial_close' && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              border: '1px solid rgba(245,166,35,0.3)',
              background: 'rgba(245,166,35,0.06)',
              color: '#F5A623',
              fontSize: 12,
            }}
          >
            Reducing position… a slice is being sold on-chain.
          </div>
        )}

        {isPartialCloseable && !confirming && !reducing && (
          <button
            onClick={() => {
              if (partialCloseError) {
                handlePartialClose()
                return
              }
              beginReduce()
            }}
            disabled={isBusy || isPartialCloseBusy}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 0,
              border: '1px solid rgba(238,255,0,0.25)',
              background: 'transparent',
              color: isBusy || isPartialCloseBusy ? 'rgba(255,255,255,0.3)' : 'var(--yellow)',
              fontSize: 14,
              fontWeight: 500,
              cursor: isBusy || isPartialCloseBusy ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font)',
              marginTop: 10,
              transition: 'border-color 0.2s',
            }}
          >
            {isPartialCloseBusy ? partialCloseButtonLabel : 'Reduce position'}
          </button>
        )}

        {isPartialCloseable && reducing && partialCloseUnits != null && minPartialCloseTokenUnits != null && maxPartialCloseTokenUnits != null && (
          <div
            style={{
              marginTop: 16,
              border: '1px solid rgba(238,255,0,0.2)',
              padding: '14px 16px',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <PartialCloseSlider
              currentTokenUnits={BigInt(position.current.positionTokenUnits)}
              minTokenUnits={BigInt(minPartialCloseTokenUnits)}
              maxTokenUnits={BigInt(maxPartialCloseTokenUnits)}
              positionValueUsdPips={position.current.positionValueUsdPips}
              value={partialCloseUnits}
              onChange={setPartialCloseUnits}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setReducing(false)}
                disabled={isPartialCloseBusy}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 0,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isPartialCloseBusy ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                Keep size
              </button>
              <button
                onClick={() => {
                  setReducing(false)
                  handlePartialClose()
                }}
                disabled={isPartialCloseBusy}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 0,
                  border: '1px solid rgba(238,255,0,0.4)',
                  background: 'rgba(238,255,0,0.08)',
                  color: 'var(--yellow)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isPartialCloseBusy ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                {partialCloseButtonLabel}
              </button>
            </div>
          </div>
        )}

        <ErrorBanner error={actionError} onDismiss={dismissError} />
        <ErrorBanner error={partialCloseError} onDismiss={resetPartialClose} />
      </div>
    </div>
  )
}

const reasonLabels: Record<string, string> = {
  closed: 'Closed',
  settled: 'Settled',
  liquidated: 'Liquidated',
  reverted: 'Reverted',
  cancelled: 'Cancelled',
}

const FAILURE_COPY: Record<string, string> = {
  price_exceeded_tolerance:
    'Polymarket price moved or the order book thinned beyond your slippage tolerance before the order could fill. Your collateral was returned and no position was opened.',
  expired:
    'The Polymarket order expired before it could fill. Your collateral was returned and no position was opened.',
  failed:
    'The Polymarket order could not be executed. Your collateral was returned and no position was opened.',
  kalshi_order_max_retries_exhausted:
    'The Kalshi order failed after multiple retries. Your collateral was returned and no position was opened.',
}

const GENERIC_FAILURE_COPY =
  'Your position could not be opened and your collateral was returned.'

const REVERT_REASON_COPY: Record<string, string> = {
  exchange_unavailable:
    'The prediction market (Polymarket) was temporarily unavailable, so your order could not be placed. Your collateral was returned — this is safe to retry.',
  slippage_exceeded:
    'The Polymarket price moved beyond your slippage tolerance before the order could fill. Your collateral was returned and no position was opened.',
}

const BULL_RETRY_PREFIX = 'Bull job max retries: '

function describeFailureReason(code: string | null | undefined): string {
  if (!code) return GENERIC_FAILURE_COPY
  if (FAILURE_COPY[code]) return FAILURE_COPY[code]
  if (code.startsWith(BULL_RETRY_PREFIX)) {
    const cause = code.slice(BULL_RETRY_PREFIX.length).trim()
    if (cause) return `Execution failed after multiple retries: ${cause}.`
  }
  return GENERIC_FAILURE_COPY
}

function describeRevertReason(
  revertReason: string | null | undefined,
  rawFailureCode: string | null | undefined,
): string {
  if (revertReason && REVERT_REASON_COPY[revertReason]) {
    return REVERT_REASON_COPY[revertReason]
  }
  return describeFailureReason(rawFailureCode)
}

function ClosedPositionDetail({
  position,
  unwinds,
  isUnwindsLoading = false,
  onClose,
}: {
  position: ClosedPosition
  unwinds?: PositionUnwindList
  isUnwindsLoading?: boolean
  onClose: () => void
}) {
  const displayTitle = position.marketTitle || position.marketTicker

  const realizedPnl = parseFloat(position.result.realizedPnlUsd)
  const pnlColor = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)'
  const pnlPrefix = realizedPnl >= 0 ? '+' : ''
  const entryCollateral = parseFloat(position.entry.collateralUsd)
  const roePct = entryCollateral > 0 ? (realizedPnl / entryCollateral) * 100 : 0

  const filledPrice = position.entry.effectiveEntryPriceUsd
  const slippageBps = position.entry.effectiveSlippageBps
  const slippageText = formatSlippageBps(slippageBps ?? null)
  const slippageColor =
    slippageBps == null
      ? 'var(--text-muted)'
      : slippageBps > 0
      ? 'var(--red)'
      : slippageBps < 0
      ? 'var(--green)'
      : 'var(--text)'

  const reason = reasonLabels[position.closeReason] || position.closeReason
  const isLiquidated = position.closeReason === 'liquidated'
  const isReverted = position.closeReason === 'reverted'
  const rawFailureCode = position.failure?.reason ?? null
  const showFailureExplanation = isReverted
  const failureExplanation = showFailureExplanation
    ? describeRevertReason(position.revertReason, rawFailureCode)
    : null

  return (
    <div>
      <DrawerHeader
        title={displayTitle}
        marketTicker={position.marketTicker}
        positionId={position.id}
        onClose={onClose}
        badges={
          <Badge
            label={reason}
            color={isLiquidated || isReverted ? 'var(--red)' : 'var(--text-muted)'}
            bg={isLiquidated || isReverted ? 'var(--red-soft)' : 'var(--surface-subtle)'}
            borderColor={
              isLiquidated || isReverted ? 'rgba(224,82,82,0.2)' : 'var(--border)'
            }
          />
        }
      />

      <div style={{ padding: '0 24px 24px' }}>
        {failureExplanation && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: 'var(--text)',
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 0,
              padding: '8px 10px',
              marginBottom: 14,
            }}
          >
            {failureExplanation}
          </div>
        )}

        <PnlHero
          label="Realized PnL"
          value={`${pnlPrefix}$${Math.abs(realizedPnl).toFixed(2)}`}
          pctValue={`${pnlPrefix}${roePct.toFixed(1)}%`}
          color={pnlColor}
        />

        <StatGroup
          label="Pricing"
          accent="rgba(255,255,255,0.08)"
          accentText="var(--text-dim)"
        >
          <StatRow label="Quote Price" value={`$${position.entry.priceUsd}`} />
          <StatRow
            label="Filled Price"
            value={filledPrice ? `$${filledPrice}` : 'Pending fill'}
            valueColor={filledPrice ? undefined : 'var(--text-muted)'}
          />
        </StatGroup>

        <StatGroup
          label="Result"
          accent="rgba(255,255,255,0.08)"
          accentText="var(--text-dim)"
        >
          <StatRow
            label="Realized PnL / ROE"
            value={`${pnlPrefix}$${Math.abs(realizedPnl).toFixed(2)} (${pnlPrefix}${roePct.toFixed(1)}%)`}
            valueColor={pnlColor}
          />
          <StatRow label="Collateral" value={`$${entryCollateral.toFixed(2)}`} />
          <StatRow
            label="Proceeds"
            value={`$${position.result.proceedsUsd}`}
            valueColor={pnlColor}
          />
          <StatRow label="Total Fees" value={`$${position.fees.totalFeesUsd}`} />
          <StatRow label="Lifetime Fee" value={`$${position.fees.totalLifetimeFeeUsd}`} />
          <StatRow
            label="Execution Slippage"
            value={slippageText ?? 'Pending fill'}
            valueColor={slippageColor}
          />
        </StatGroup>

        <StatGroup
          label="Leverage"
          accent="rgba(255,255,255,0.08)"
          accentText="var(--text-dim)"
          last
        >
          <StatRow
            label="Starting"
            value={`${(position.entry.leverageBps / 10000).toFixed(1)}x`}
          />
          <div style={{ marginTop: 10 }}>
            <LeverageChart
              unwinds={unwinds}
              isLoading={isUnwindsLoading}
              endAt={position.result.closedAt ? new Date(position.result.closedAt) : undefined}
            />
          </div>
        </StatGroup>
      </div>
    </div>
  )
}

function PartialCloseHistorySection({ position }: { position: OpenPosition }) {
  const { data, isLoading } = usePartialCloses(position.id)
  if (!isLoading && (data?.data.length ?? 0) === 0) return null

  return (
    <PartialCloseChart
      partialCloses={data}
      originalTokenUnits={position.entry.positionTokenUnits}
      currentTokenUnits={position.current.positionTokenUnits}
      openedAt={position.entry.openedAt}
      isLoading={isLoading}
    />
  )
}
