import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useBalance } from 'wagmi'
import type { Market, MarketLeverage } from '../api/types'
import {
  leverageMaxBps,
  maxViableLeverageBpsForCollateral,
  getSidedEligibility,
  defaultSide,
  rejectionReasonText,
} from '../api/types'
import { useTradeMachine, buildQuoteParams, withPartialFill } from '../hooks/useTradeMachine'
import { useFeeRates } from '../hooks/useFeeRates'
import { useValueTween } from '../hooks/useValueTween'
import { usePendingPositionsStore } from '../store/pendingPositions'
import {
  useApproveUsdc,
  useCheckAllowance,
  useCreatePosition,
  USDC_ADDRESS,
} from '../contract/hooks'
import { useCreatePositionPushFunded } from '../contract/pushFundedHooks'
import { useCreatePositionSmart } from '../contract/smartWalletHooks'
import { useAuthStore } from '../store/auth'
import { quoteErrorHint, hintAdjustment, type CorrectedField } from '../api/quote-error-hints'
import { maxViableLeverageBps } from '../utils/capacity'
import { CapacityGuide } from './CapacityGuide'
import { CardShell } from './CardShell'
import { ErrorBanner } from './ErrorBanner'
import { formatApiError, formatErrorMessage } from '../api/error-messages'
import { formatContractError } from '../contract/error-messages'
import { useToastStore } from '../store/toasts'
import { LeverageSlider } from './LeverageSlider'
import { PartialFillControl } from './PartialFillControl'
import { MIN_FILL_BPS_DEFAULT, partialFillErrorMessage, snapMinFillBps } from '../utils/partialFill'
import { QuoteDetails } from './QuoteDetails'
import { TradeEstimate } from './TradeEstimate'
import { QuoteErrorHint } from './QuoteErrorHint'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Input } from './ui/Input'
import { PositionIdRow } from './PositionCard'
import { CopyableTitle } from './CopyableTitle'
import { useCopyFlash } from '../hooks/useCopyFlash'

function formatCreateError(error: unknown): string {
  if (error != null && typeof error === 'object' && 'status' in error && 'code' in error) {
    return formatApiError(error)
  }
  return formatContractError(error).message
}

const PRESET_AMOUNTS = [50, 100, 500] as const
const DEFAULT_SLIPPAGE_BPS = 800 // 8%
const DEFAULT_LEVERAGE_BPS = 20000 // 2x
const SLIPPAGE_PRESETS_BPS = [200, 500, 800] as const
// Floor the slider step at 0.5x even when the API publishes something finer
// (e.g. 2500bps = 0.25x). 0.5x keeps leverage labels to a single decimal
// (2.5x, not 1.25x) and stops the dots from crowding the track. We still honour
// the API step when it's coarser than this — only the fine end is clamped.
const FORCED_LEVERAGE_STEP_BPS = 5000 // 0.5x

function leverageStepBps(market: { leverage: MarketLeverage }) {
  return Math.max(market.leverage.stepBps, FORCED_LEVERAGE_STEP_BPS)
}

function clampLeverageToMarket(target: number, market: { leverage: MarketLeverage }, side: 'yes' | 'no' = 'yes', round: 'nearest' | 'down' | 'up' = 'nearest') {
  const step = leverageStepBps(market)
  const minBps = market.leverage.minBps
  const maxBps = leverageMaxBps(market.leverage, side)
  const maxSteps = Math.max(0, Math.floor((maxBps - minBps) / step))
  const clamped = Math.min(Math.max(target, minBps), minBps + maxSteps * step)
  const snap = round === 'down' ? Math.floor : round === 'up' ? Math.ceil : Math.round
  const k = snap((clamped - minBps) / step)
  return minBps + Math.min(Math.max(k, 0), maxSteps) * step
}

export function TradePanel({
  market,
  onClose,
}: {
  market: Market
  onClose: () => void
}) {
  const eligibility = useMemo(() => getSidedEligibility(market), [market])
  // A side is only tradeable if it accepts new positions AND has viable
  // leverage capacity — a side with no leverage would render a dead slider.
  // Prefer such a side on open so we never default into a side you can't use.
  const sideTradeable = (s: 'yes' | 'no') =>
    eligibility[s].open && maxViableLeverageBps(market, s) != null
  const [side, setSide] = useState<'yes' | 'no'>(() =>
    sideTradeable('yes') ? 'yes' : sideTradeable('no') ? 'no' : defaultSide(eligibility) ?? 'yes',
  )
  const sideEligibility = eligibility[side]
  const [collateralUsd, setCollateralUsd] = useState('')
  const [leverageBps, setLeverageBps] = useState(() =>
    clampLeverageToMarket(DEFAULT_LEVERAGE_BPS, market, side),
  )
  const { isCopied, copy } = useCopyFlash()

  const sideMaxBps = leverageMaxBps(market.leverage, side)
  const capacityViableLev = useMemo(() => maxViableLeverageBps(market, side), [market, side])
  const collateralNum = Number(collateralUsd) || 0
  const notionalViableLev = useMemo(
    () => (collateralNum > 0 ? maxViableLeverageBpsForCollateral(market, side, collateralNum) : null),
    [market, side, collateralNum],
  )
  const maxViableLev = useMemo(() => {
    const candidates = [capacityViableLev, notionalViableLev].filter(
      (v): v is number => v != null,
    )
    return candidates.length > 0 ? Math.min(...candidates) : null
  }, [capacityViableLev, notionalViableLev])

  useEffect(() => {
    // Reset leverage/header when the market or side changes underneath us.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived reset on market/side change
    setLeverageBps(clampLeverageToMarket(DEFAULT_LEVERAGE_BPS, market, side))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the granular market.leverage.* fields, not the whole `market` object, so unrelated market changes don't reset leverage
  }, [market.ticker, market.leverage.minBps, market.leverage.maxBps, market.leverage.maxYesBps, market.leverage.maxNoBps, market.leverage.stepBps, side])
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [allowPartialFill, setAllowPartialFill] = useState(false)
  const [minFillBps, setMinFillBps] = useState(MIN_FILL_BPS_DEFAULT)

  const { data: feeRates } = useFeeRates(market.ticker)

  const queryClient = useQueryClient()
  const addPendingStub = usePendingPositionsStore((s) => s.add)
  const removePendingStub = usePendingPositionsStore((s) => s.remove)
  const { address, isConnected } = useAccount()
  const { data: usdcBalance } = useBalance({
    address,
    token: USDC_ADDRESS,
    query: { enabled: !!address },
  })

  // Real state (not a ref): the render output below gates on it, so it must
  // trigger a re-render when toggled. It's flipped from effects that sync the
  // trade machine's phase, hence the scoped set-state-in-effect disables.
  const [isAutoCorrecting, setIsAutoCorrecting] = useState(false)
  const [hasAutoRetriedRef] = useState(() => ({ current: false }))
  const { state: tradeState, getDraft, promote, correctAndPromote, acceptChanges, reset: resetTrade } = useTradeMachine()

  const draft = tradeState.phase === 'draft-ready' ? tradeState.draft
    : tradeState.phase === 'promoting' ? tradeState.draft
    : tradeState.phase === 'promoted' ? tradeState.draft
    : tradeState.phase === 'market-moved' ? tradeState.newDraft
    : tradeState.phase === 'error' ? tradeState.draft
    : null

  const promotedOffer = tradeState.phase === 'promoted' ? tradeState.promotedOffer : null

  const quotedAt = (tradeState.phase === 'draft-ready' || tradeState.phase === 'promoting'
    || tradeState.phase === 'promoted' || tradeState.phase === 'market-moved')
    ? tradeState.quotedAt : undefined

  const correctedFrom = tradeState.phase === 'promoted' ? tradeState.correctedFrom : undefined

  const offerLoading = tradeState.phase === 'loading-draft'
  const offerError = tradeState.phase === 'error' ? tradeState.error : null
  const isPromoting = tradeState.phase === 'promoting'
  const isMarketMoved = tradeState.phase === 'market-moved'
  const isCorrecting = isPromoting && isAutoCorrecting

  const {
    approve,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isSuccess: approveSuccess,
    simulateError: approveSimError,
    error: approveWriteError,
    receiptError: approveReceiptError,
    reset: resetApprove,
  } = useApproveUsdc()
  // Routing: a Privy AA smart wallet batches approve+createPosition in one
  // userOp; a Polymarket deposit wallet uses the push-funded relayer batch;
  // otherwise a direct createPosition. Smart-wallet mode wins when active.
  const depositWalletMode = useAuthStore((s) => s.depositWalletMode)
  const smartWalletMode = useAuthStore((s) => s.smartWalletAddress != null)
  const eoaCreate = useCreatePosition()
  const pushFundedCreate = useCreatePositionPushFunded()
  const smartCreate = useCreatePositionSmart()
  const activeCreate = smartWalletMode ? smartCreate : depositWalletMode ? pushFundedCreate : eoaCreate
  const create = activeCreate.create
  const createPending = activeCreate.isPending
  const createConfirming = activeCreate.isConfirming
  const createSuccess = activeCreate.isSuccess
  const createReceiptErrorObj = activeCreate.receiptError
  const createReceiptError = createReceiptErrorObj != null
  const createWriteError = activeCreate.error
  const verifyError = activeCreate.verifyError
  const resetCreate = activeCreate.reset
  const clearOffer = useCallback(() => {
    resetTrade()
    resetCreate()
  }, [resetTrade, resetCreate])
  const { allowance, refetch: refetchAllowance } = useCheckAllowance(
    address,
    draft?.polygonVaultContractAddress as `0x${string}` | undefined,
  )

  const requiredApproval = draft ? BigInt(draft.totalUserAmountUsdcUnits) : 0n
  const hasAllowance = allowance !== undefined && allowance >= requiredApproval && requiredApproval > 0n
  // Deposit-wallet and AA modes fund/approve inside the batch, so no separate
  // ERC-20 approval step is needed.
  const canCreate = smartWalletMode || depositWalletMode || hasAllowance || approveSuccess

  const canGetQuote = isConnected && collateralUsd && Number(collateralUsd) > 0

  // Fire exactly once per success transition. `createSuccess` stays true until
  // the mutation is reset (which doesn't happen on the success path), and
  // `onClose` gets a new identity on every parent render — without this latch
  // the effect re-invalidates positions on every re-render, spamming /positions.
  const didInvalidateRef = useRef(false)
  useEffect(() => {
    if (createSuccess) {
      if (!didInvalidateRef.current) {
        didInvalidateRef.current = true
        queryClient.invalidateQueries({ queryKey: ['dimes', 'positions'] })
        onClose()
      }
    } else {
      didInvalidateRef.current = false
    }
  }, [createSuccess, queryClient, onClose])

  const stubKey = promotedOffer?.onChainPositionKey
  useEffect(() => {
    if (!stubKey) return
    if (createWriteError || verifyError || createReceiptError) {
      removePendingStub(stubKey)
    }
  }, [stubKey, createWriteError, verifyError, createReceiptError, removePendingStub])

  const addToast = useToastStore((s) => s.add)
  const toastedErrorRef = useRef<unknown>(null)
  useEffect(() => {
    const err = verifyError ?? createWriteError ?? createReceiptErrorObj
    if (err) {
      // clearOffer() resets the drawer to its initial state, hiding the inline
      // banner — so always surface the failure as a toast as well.
      if (toastedErrorRef.current !== err) {
        toastedErrorRef.current = err
        addToast({
          title: 'Failed to create position',
          description: formatCreateError(err),
          variant: 'error',
          durationMs: 6000,
          error: err,
          context: {
            action: 'createPosition',
            market: market.ticker,
            side,
            leverageBps,
            collateralUsd,
          },
        })
      }
      clearOffer()
    } else {
      toastedErrorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on error changes only; market.ticker/side/leverageBps/collateralUsd are read as latest-value snapshots for the toast context, not triggers
  }, [verifyError, createWriteError, createReceiptError, createReceiptErrorObj, clearOffer, addToast])

  const [isOfferExpired, setIsOfferExpired] = useState(false)
  useEffect(() => {
    if (!promotedOffer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when no offer
      setIsOfferExpired(false)
      return
    }
    const check = () => setIsOfferExpired(new Date(promotedOffer.expiresAt).getTime() <= Date.now())
    check()
    const interval = setInterval(check, 500)
    return () => clearInterval(interval)
  }, [promotedOffer])

  const walletOpen = !!(promotedOffer && (createPending || createConfirming))

  // Trigger wallet signing as soon as promotion succeeds
  const prevPromotedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!promotedOffer) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync flag to a new promoted offer
    setIsAutoCorrecting(false)
    if (prevPromotedRef.current === promotedOffer.id) return
    prevPromotedRef.current = promotedOffer.id
    if (promotedOffer.onChainPositionKey) {
      addPendingStub({
        key: promotedOffer.onChainPositionKey,
        marketTicker: promotedOffer.marketTicker,
        side: promotedOffer.effectiveSide === 'no' ? 'no' : 'yes',
        leverageBps: promotedOffer.leverageBps,
        collateralUsd: promotedOffer.notionalAmountUsd
          ? (Number(promotedOffer.notionalAmountUsd) / (promotedOffer.leverageBps / 10000)).toFixed(2)
          : collateralUsd,
        createdAt: Date.now(),
      })
    }
    create(promotedOffer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new promoted offer; addPendingStub/create/collateralUsd are read as latest values, not triggers (deps here would re-fire mid-flight)
  }, [promotedOffer])

  const updateCollateral = (next: string) => {
    setCollateralUsd(next)
    clearOffer()
  }

  const addToCollateral = (delta: number) => {
    const current = Number(collateralUsd) || 0
    updateCollateral(String(current + delta))
  }

  const handleMax = () => {
    if (!usdcBalance) return
    const asDollars = Number(usdcBalance.value) / 1_000_000
    updateCollateral(asDollars.toFixed(2))
  }

  const handleGetQuote = () => {
    if (!canGetQuote) return
    hasAutoRetriedRef.current = false
    getDraft({
      marketTicker: market.ticker,
      effectiveSide: side,
      leverageBps,
      collateralUsd: Number(collateralUsd),
      slippageBps,
      allowPartialFill,
      ...(allowPartialFill ? { minFillBps } : {}),
    })
  }

  const apiErr = offerError && typeof offerError === 'object' && 'code' in offerError
    ? offerError as { code: string; params: Record<string, unknown> | null }
    : null
  const partialFillError = partialFillErrorMessage(apiErr?.code, apiErr?.params)
  const offerHint = quoteErrorHint(
    apiErr?.code ?? null,
    apiErr?.params ?? null,
    { leverageBps },
  )

  const rawAdjustment = hintAdjustment(offerHint, {
    collateralUsd: Number(collateralUsd) || 0,
    leverageBps,
    slippageBps,
    minFillBps,
  })
  // The SDK maps quote_slippage_too_high to a slippage "adjustment", but this
  // API's params mean the opposite of what that mapping assumes: currentSlippageBps
  // is the slippage the order would incur and maxSlippageBps is the tolerance the
  // user already sent. There is no safe single-field bump (the real fix is reduce
  // size or raise tolerance well past the presets), and auto-correcting here would
  // silently swallow the error — a draft-time failure has no draft to re-promote,
  // so isAutoCorrecting would stick and hide the hint. Surface the hint instead.
  const adjustment = offerHint?.kind === 'raise-slippage' ? null : rawAdjustment

  // Auto-correct inputs the moment a quote error returns a constraint hint.
  // The user still presses Get Quote again to retry — we never silently
  // re-fire the API call.
  const [correction, setCorrection] = useState<{
    field: CorrectedField
    fromValue: number
    toValue: number
    nonce: number
  } | null>(null)
  const [errorPulseNonce, setErrorPulseNonce] = useState(0)
  const correctionNonceRef = useRef(0)
  const adjustmentRef = useRef(adjustment)
  // Keep the latest adjustment in a ref so the offer-error effect can read it
  // without listing it as a dependency. Written in an effect (not during
  // render) to satisfy react-hooks/refs.
  useEffect(() => {
    adjustmentRef.current = adjustment
  })

  useEffect(() => {
    if (!offerError) return

    const adj = adjustmentRef.current
    const hasAdjustment = adj && Math.abs(adj.toValue - adj.fromValue) >= 1e-4

    if (!hasAdjustment || hasAutoRetriedRef.current) {
      setIsAutoCorrecting(false)
      setErrorPulseNonce((n) => n + 1)
      return
    }

    hasAutoRetriedRef.current = true

    let adjustedCollateral = Number(collateralUsd) || 0
    let adjustedLeverage = leverageBps
    let adjustedSlippage = slippageBps
    let adjustedMinFill = minFillBps
    let toValue = adj.toValue

    if (adj.field === 'collateral') {
      setCollateralUsd(adj.toValue.toFixed(2))
      adjustedCollateral = adj.toValue
    } else if (adj.field === 'leverage') {
      const round = adj.reason === 'clamp-max' ? 'down' : 'up'
      toValue = clampLeverageToMarket(adj.toValue, market, side, round)
      setLeverageBps(toValue)
      adjustedLeverage = toValue
    } else if (adj.field === 'slippage') {
      setSlippageBps(adj.toValue)
      setAdvancedOpen(true)
      adjustedSlippage = adj.toValue
    } else if (adj.field === 'minFill') {
      toValue = snapMinFillBps(adj.toValue)
      setMinFillBps(toValue)
      adjustedMinFill = toValue
    }
    correctionNonceRef.current += 1
    setCorrection({
      field: adj.field,
      fromValue: adj.fromValue,
      toValue,
      nonce: correctionNonceRef.current,
    })

    const errorDraft = tradeState.phase === 'error' ? tradeState.draft : undefined
    if (errorDraft) {
      // A promote-time failure carries the draft — re-promote it with the
      // corrected params. Suppress the inline error only while that async
      // retry is in flight; success flips isAutoCorrecting back off.
      setIsAutoCorrecting(true)
      correctAndPromote(errorDraft, withPartialFill(
        buildQuoteParams({
          marketTicker: market.ticker,
          side,
          leverageBps: adjustedLeverage,
          collateralUsd: adjustedCollateral,
          slippageBps: adjustedSlippage,
        }),
        { allowPartialFill, minFillBps: adjustedMinFill },
      ))
    } else {
      // A draft-time failure has no draft to re-promote. Nothing async runs, so
      // don't linger in the silent auto-correcting state — that would hide the
      // corrected-input hint (and any error) indefinitely. The user retries.
      setIsAutoCorrecting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when a new offerError arrives; all other reads are latest-value snapshots, not triggers
  }, [offerError])

  // Guaranteed fallback: any quote error we don't explain with a rich inline
  // treatment (a structured hint or a partial-fill message) gets surfaced as a
  // toast carrying the error code — so an unhandled or edge code is never
  // silently swallowed. Errors that trigger a silent auto-correct retry
  // self-heal, so we skip those. Deduped on the error object.
  const offerErrorToastedRef = useRef<unknown>(null)
  useEffect(() => {
    if (!offerError || isAutoCorrecting) {
      if (!offerError) offerErrorToastedRef.current = null
      return
    }
    // Richly handled inline — don't double-surface as a toast.
    if (offerHint != null || partialFillError != null) return
    if (offerErrorToastedRef.current === offerError) return
    offerErrorToastedRef.current = offerError

    const code = apiErr?.code
    addToast({
      title: 'Could not get a quote',
      description: code
        ? formatErrorMessage(code, apiErr?.params ?? null)
        : formatApiError(offerError),
      variant: 'error',
      durationMs: 6000,
      error: offerError,
      context: { action: 'getQuote', code, market: market.ticker, side, leverageBps, collateralUsd },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on a new offerError / correcting-state change; market/side/etc. are latest-value snapshots for the toast context, not triggers
  }, [offerError, isAutoCorrecting, offerHint, partialFillError])

  // Tween display values for whichever field is mid-correction. When the
  // tween isn't active for a given field, we fall back to the live state.
  const collateralTween = useValueTween(
    correction?.field === 'collateral' ? correction.fromValue : 0,
    correction?.field === 'collateral' ? correction.toValue : 0,
    correction?.field === 'collateral' ? correction.nonce : 0,
  )
  const leverageTween = useValueTween(
    correction?.field === 'leverage' ? correction.fromValue : 0,
    correction?.field === 'leverage' ? correction.toValue : 0,
    correction?.field === 'leverage' ? correction.nonce : 0,
  )
  const slippageTween = useValueTween(
    correction?.field === 'slippage' ? correction.fromValue : 0,
    correction?.field === 'slippage' ? correction.toValue : 0,
    correction?.field === 'slippage' ? correction.nonce : 0,
  )
  const minFillTween = useValueTween(
    correction?.field === 'minFill' ? correction.fromValue : 0,
    correction?.field === 'minFill' ? correction.toValue : 0,
    correction?.field === 'minFill' ? correction.nonce : 0,
  )

  const displayCollateral =
    correction?.field === 'collateral' && collateralTween.active
      ? collateralTween.value.toFixed(2)
      : collateralUsd
  const displaySlippagePct =
    correction?.field === 'slippage' && slippageTween.active
      ? (slippageTween.value / 100).toFixed(2).replace(/\.?0+$/, '')
      : (slippageBps / 100).toString()
  const displayMinFillBps =
    correction?.field === 'minFill' && minFillTween.active
      ? snapMinFillBps(Math.round(minFillTween.value))
      : minFillBps

  const handleApprove = async () => {
    if (!draft) return
    await approve(
      draft.polygonVaultContractAddress,
      2n ** 256n - 1n,
    )
    refetchAllowance()
  }

  const handleCreate = () => {
    if (!draft) return
    promote(draft)
  }

  const handleAcceptChanges = () => {
    if (tradeState.phase !== 'market-moved') return
    acceptChanges(tradeState.newDraft, tradeState.retryCount)
  }

  // When a quote lands, the drawer grows with the quote details + Create button
  // below the fold — especially on the mobile bottom sheet. Scroll the drawer to
  // reveal the action once the draft is ready.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tradeState.phase === 'draft-ready') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [tradeState.phase])

  const formatCents = (usd: string) => {
    const p = Number(usd)
    return p < 0.1 ? `${(p * 100).toFixed(1)}¢` : `${Math.round(p * 100)}¢`
  }

  return (
    <CardShell variant="yellow" className="trade-panel-card-shell">
      <div
        className="trade-panel"
        style={{ padding: '24px 24px 20px', position: 'relative' }}
      >
        {errorPulseNonce > 0 && (
          <span
            key={`fail-${errorPulseNonce}`}
            className="panel-fail-ring"
            aria-hidden
          />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 18,
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <CopyableTitle
              text={market.title || market.ticker}
              copyValue={market.ticker}
            />
            <PositionIdRow
              positionId={market.id}
              copied={isCopied('marketId')}
              entityLabel="Market ID"
              onCopy={(e) => {
                e.stopPropagation()
                copy(market.id, 'marketId')
              }}
            />
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

        {/* Side selector — odds shown under YES/NO when available */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginBottom: 18,
          }}
        >
          <SideButton
            label="YES"
            sub={market.prices ? formatCents(market.prices.yesBidPriceUsd) : (market.yesSubTitle ?? null)}
            variant="yes"
            active={side === 'yes'}
            disabled={!eligibility.yes.open}
            onClick={() => { setSide('yes'); clearOffer(); }}
          />
          <SideButton
            label="NO"
            sub={market.prices ? formatCents(market.prices.noBidPriceUsd) : null}
            variant="no"
            active={side === 'no'}
            disabled={!eligibility.no.open}
            onClick={() => { setSide('no'); clearOffer(); }}
          />
        </div>

        {(!sideEligibility.open || capacityViableLev == null) ? (
          <SideUnavailablePanel
            side={side}
            reasonCode={sideEligibility.reasonCode}
            noLeverage={sideEligibility.open && capacityViableLev == null}
            otherOpen={sideTradeable(side === 'yes' ? 'no' : 'yes')}
            otherSub={
              market.prices
                ? formatCents(side === 'yes' ? market.prices.noBidPriceUsd : market.prices.yesBidPriceUsd)
                : null
            }
            onSwitch={() => { setSide(side === 'yes' ? 'no' : 'yes'); clearOffer(); }}
          />
        ) : (<>


        {/* Collateral */}
        <div style={{ marginBottom: 18 }}>
          <Field label="Collateral">
            <div className="correction-host">
              <Input
                type="number"
                inputMode="decimal"
                value={displayCollateral}
                onChange={(e) => updateCollateral(e.target.value)}
                placeholder="0.00"
                leadingSlot="$"
              />
              {correction?.field === 'collateral' && !isAutoCorrecting && (
                <span
                  key={`corr-coll-${correction.nonce}`}
                  className="correction-overlay"
                  aria-hidden
                />
              )}
            </div>
          </Field>
          <div className="quick-btn-row">
            {PRESET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                className="quick-btn"
                onClick={() => addToCollateral(amount)}
              >
                +${amount}
              </button>
            ))}
            <button
              type="button"
              className="quick-btn"
              onClick={handleMax}
              disabled={!usdcBalance}
            >
              MAX
            </button>
          </div>
        </div>

        {/* Leverage card */}
        <div
          className="lev-wrap correction-host"
          data-correcting={correction?.field === 'leverage' && leverageTween.active ? 'true' : 'false'}
        >
          <LeverageSlider
            min={market.leverage.minBps}
            max={sideMaxBps}
            step={leverageStepBps(market)}
            value={leverageBps}
            onChange={(v) => { setLeverageBps(v); clearOffer(); }}
            maxViableStep={maxViableLev}
          />
          {correction?.field === 'leverage' && !isAutoCorrecting && (
            <span
              key={`corr-lev-${correction.nonce}`}
              className="correction-overlay"
              aria-hidden
            />
          )}
        </div>

        {notionalViableLev != null && leverageBps > notionalViableLev && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: '#F5A623',
              fontWeight: 500,
            }}
          >
            ⚠ At ${(collateralNum * (leverageBps / 10000)).toFixed(2)} notional, max leverage is ~{(notionalViableLev / 10000).toFixed(1).replace(/\.0$/, '')}×
          </div>
        )}

        <CapacityGuide
          market={market}
          side={side}
          leverageBps={leverageBps}
          collateralUsd={Number(collateralUsd) || 0}
        />

        {/* Advanced */}
        <div className="adv">
          <div className="adv__toggle-row">
            <button
              type="button"
              className="adv__toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <span className="adv__caret" aria-hidden />
              Advanced
            </button>
            <span className="adv__rule" aria-hidden />
          </div>
          <div className={`adv__panel${advancedOpen ? ' adv__panel--open' : ''}`}>
            <div className="adv__panel-inner">
              <div className="adv__panel-content">
                <div className="adv__row">
                  <span className="adv__label">Slippage</span>
                  <label className="adv__custom correction-host">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      value={displaySlippagePct}
                      onChange={(e) => {
                        const pct = Number(e.target.value)
                        if (Number.isNaN(pct)) return
                        setSlippageBps(Math.max(0, Math.round(pct * 100)))
                        clearOffer()
                      }}
                      placeholder="2.0"
                      aria-label="Custom slippage percent"
                    />
                    <span className="adv__custom-suffix">%</span>
                    {correction?.field === 'slippage' && !isAutoCorrecting && (
                      <span
                        key={`corr-slip-${correction.nonce}`}
                        className="correction-overlay"
                        aria-hidden
                      />
                    )}
                  </label>
                  <div className="adv__chips" role="radiogroup" aria-label="Slippage presets">
                    {SLIPPAGE_PRESETS_BPS.map((bps) => {
                      const active = slippageBps === bps
                      return (
                        <button
                          key={bps}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`adv__chip${active ? ' adv__chip--active' : ''}`}
                          onClick={() => { setSlippageBps(bps); clearOffer(); }}
                        >
                          {bps / 100}%
                        </button>
                      )
                    })}
                  </div>
                </div>
                <PartialFillControl
                  enabled={allowPartialFill}
                  minFillBps={displayMinFillBps}
                  notionalUsd={collateralNum * (leverageBps / 10000)}
                  correcting={correction?.field === 'minFill' && !isAutoCorrecting}
                  onToggle={(next) => { setAllowPartialFill(next); clearOffer() }}
                  onChangeMinFill={(bps) => { setMinFillBps(snapMinFillBps(bps)); clearOffer() }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Get quote */}
        <div style={{ marginTop: 18, position: 'relative' }}>
          <Button
            variant={draft && !createSuccess ? 'ghost' : 'primary'}
            className="get-quote-btn"
            fullWidth
            disabled={!canGetQuote || offerLoading}
            onClick={handleGetQuote}
          >
            {offerLoading
              ? 'Getting quote…'
              : isConnected
                ? 'Get quote'
                : 'Connect wallet to trade'}
          </Button>
          {correction && !isAutoCorrecting && (
            <span
              key={`cta-${correction.nonce}`}
              className="cta-breath"
              aria-hidden
            />
          )}
        </div>

        {partialFillError && !isAutoCorrecting && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '11px 13px',
              background: 'rgba(245,166,35,0.07)',
              border: '1px solid rgba(245,166,35,0.25)',
              color: '#F5A623',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.4,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{partialFillError}</span>
          </div>
        )}
        {!offerHint && !isAutoCorrecting && !partialFillError && <ErrorBanner error={offerError} onDismiss={clearOffer} />}
        {!isAutoCorrecting && (
          <QuoteErrorHint
            hint={offerHint}
            adjustment={adjustment}
            market={market}
            side={side}
            leverageBps={leverageBps}
          />
        )}
        <ErrorBanner
          error={verifyError ?? createWriteError ?? createReceiptErrorObj}
          onDismiss={resetCreate}
        />
        <ErrorBanner
          error={approveSimError ?? approveWriteError ?? approveReceiptError}
          onDismiss={resetApprove}
        />

        {offerLoading && !draft && <QuoteSkeleton />}

        {!draft && !offerLoading && feeRates && collateralNum > 0 && (
          <TradeEstimate
            market={market}
            side={side}
            collateralUsd={collateralNum}
            leverageBps={leverageBps}
            slippageBps={slippageBps}
            feeRates={feeRates}
          />
        )}

        {draft && (
          <QuoteDetails
            offer={walletOpen ? promotedOffer! : draft}
            hideExpiry={!walletOpen || createConfirming}
            previousOffer={isMarketMoved ? tradeState.originalDraft : correctedFrom}
            quotedAt={quotedAt}
            onRefresh={handleGetQuote}
          />
        )}

        {isMarketMoved && (
          <div
            style={{
              marginTop: 12,
              padding: '12px 16px',
              borderRadius: 'var(--radius)',
              background: 'rgba(245, 166, 35, 0.08)',
              border: '1px solid rgba(245, 166, 35, 0.25)',
              color: '#F5A623',
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              Market conditions changed — review the updated numbers above.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={handleAcceptChanges}>
                Accept Changes
              </Button>
              <Button variant="ghost" onClick={resetTrade}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {draft && !createSuccess && !isMarketMoved && (
          (isOfferExpired && !createPending && !createConfirming) ? (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="primary"
                fullWidth
                onClick={() => {
                  clearOffer()
                  resetApprove()
                  handleGetQuote()
                }}
              >
                Quote expired — re-quote
              </Button>
            </div>
          ) : (createPending || createConfirming) ? (
            <TxProgress step={createConfirming ? 'confirming' : 'signing'} />
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {!canCreate && (
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={handleApprove}
                  disabled={approvePending || approveConfirming}
                >
                  {approveConfirming ? 'Confirming…' : approvePending ? 'Approving…' : 'Approve pUSD'}
                </Button>
              )}
              <Button
                variant="primary"
                fullWidth
                onClick={handleCreate}
                disabled={!canCreate || isPromoting}
              >
                {isCorrecting
                  ? 'Adjusting…'
                  : isPromoting
                    ? 'Creating…'
                    : 'Create position'}
              </Button>
            </div>
          )
        )}

        </>)}

        <div ref={bottomRef} aria-hidden />
      </div>
    </CardShell>
  )
}

function SideUnavailablePanel({
  side,
  reasonCode,
  noLeverage,
  otherOpen,
  otherSub,
  onSwitch,
}: {
  side: 'yes' | 'no'
  reasonCode: string | null
  noLeverage?: boolean
  otherOpen: boolean
  otherSub: string | null
  onSwitch: () => void
}) {
  const otherLabel = side === 'yes' ? 'NO' : 'YES'

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 4,
        padding: '18px 18px 16px',
        // Neutral "closed lane" — a faint diagonal hatch over the subtle
        // surface signals intentional unavailability without alarm colour.
        background:
          'repeating-linear-gradient(135deg, transparent 0 7px, rgba(255,255,255,0.018) 7px 8px), var(--surface-subtle)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Muted no-entry glyph — grey, not red */}
        <div
          aria-hidden
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-dim)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5.5" />
            <line x1="3.1" y1="3.1" x2="10.9" y2="10.9" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 3,
            }}
          >
            {side.toUpperCase()} unavailable
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>
            {noLeverage ? 'No leverage capacity on this side right now.' : rejectionReasonText(reasonCode)}
          </div>
        </div>
      </div>

      {otherOpen && (
        <button
          type="button"
          onClick={onSwitch}
          style={{
            marginTop: 14,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 14px',
            // Neutral CTA — reads as "go here next", never as an error state
            // (a red-tinted button for "Switch to NO" looked broken).
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            fontFamily: 'var(--font)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span>
            Switch to {otherLabel}
            {otherSub && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{`  ·  ${otherSub}`}</span>
            )}
          </span>
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>→</span>
        </button>
      )}
    </div>
  )
}

function SideButton({
  label,
  sub,
  variant,
  active,
  disabled,
  onClick,
}: {
  label: string
  sub: string | null
  variant: 'yes' | 'no'
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const isYes = variant === 'yes'
  const accent = isYes ? 'var(--green)' : 'var(--red)'
  const accentSoft = isYes ? 'var(--green-soft)' : 'var(--red-soft)'
  const accentBorder = isYes ? 'var(--green-border)' : 'var(--red-border)'

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '12px 0',
        borderRadius: 'var(--radius)',
        border: `1px solid ${active ? accentBorder : 'var(--border)'}`,
        background: active ? accentSoft : 'transparent',
        color: active ? accent : 'var(--text-muted)',
        cursor: 'pointer',
        fontFamily: 'var(--font)',
        opacity: disabled && !active ? 0.4 : 1,
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em' }}>{label}</span>
      {sub ? (
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            opacity: active ? 0.85 : 0.6,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sub}
        </span>
      ) : null}
    </button>
  )
}

const TX_STEPS = [
  { key: 'signing', label: 'Confirm in wallet' },
  { key: 'confirming', label: 'Waiting for on-chain confirmation' },
] as const

function TxProgress({ step }: { step: 'signing' | 'confirming' }) {
  const activeIdx = TX_STEPS.findIndex((s) => s.key === step)

  return (
    <div
      style={{
        marginTop: 14,
        padding: '16px',
        borderRadius: 'var(--radius)',
        background: 'rgba(238,255,0,0.04)',
        border: '1px solid rgba(238,255,0,0.12)',
      }}
    >
      {TX_STEPS.map((s, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        return (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              opacity: done ? 0.5 : 1,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
                border: active
                  ? '2px solid var(--yellow)'
                  : done
                    ? '2px solid rgba(238,255,0,0.4)'
                    : '2px solid rgba(255,255,255,0.15)',
                background: done ? 'rgba(238,255,0,0.15)' : 'transparent',
                color: done ? 'var(--yellow)' : active ? 'var(--yellow)' : 'var(--text-dim)',
                animation: active ? 'txStepPulse 1.5s ease-in-out infinite' : 'none',
              }}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--yellow)' : done ? 'var(--text-muted)' : 'var(--text-dim)',
              }}
            >
              {s.label}
              {active && '…'}
            </span>
          </div>
        )
      })}
      <style>{`
        @keyframes txStepPulse {
          0%, 100% { border-color: var(--yellow); }
          50% { border-color: rgba(238,255,0,0.3); }
        }
      `}</style>
    </div>
  )
}

function QuoteSkeleton() {
  const rowWidths = [72, 92, 84, 110, 96, 88]
  return (
    <div style={{ padding: '12px 0', marginTop: 4 }}>
      <div
        style={{
          height: 12,
          width: 110,
          borderRadius: 0,
          background: 'rgba(255,255,255,0.08)',
          marginBottom: 14,
          animation: 'quoteSkeletonPulse 1.4s ease-in-out infinite',
        }}
      />
      {rowWidths.map((w, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '9px 0',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <div
            style={{
              height: 10,
              width: 74,
              borderRadius: 0,
              background: 'rgba(255,255,255,0.05)',
              animation: 'quoteSkeletonPulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 60}ms`,
            }}
          />
          <div
            style={{
              height: 10,
              width: w,
              borderRadius: 0,
              background: 'rgba(238,255,0,0.08)',
              animation: 'quoteSkeletonPulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 60 + 120}ms`,
            }}
          />
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            height: 3,
            width: '100%',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '30%',
              background: 'var(--yellow)',
              borderRadius: 0,
              animation: 'quoteSkeletonSlide 1.4s ease-in-out infinite',
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes quoteSkeletonPulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.75; }
        }
        @keyframes quoteSkeletonSlide {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
      `}</style>
    </div>
  )
}
