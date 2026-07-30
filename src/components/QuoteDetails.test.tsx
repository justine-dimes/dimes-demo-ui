import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Offer } from '../api/types'
import { QuoteDetails } from './QuoteDetails'

// Minimal-but-complete offer, mirroring the preview page fixture. Entry $0.33
// at 5x on $10 collateral.
const offer: Offer = {
  id: 'dm_off_1',
  authorityPublicKey: '0x1234',
  collateralUsdcUnits: '10000000',
  contractSignature: '0xabc',
  currentLiquidationPriceUsd: '0.18',
  currentLiquidationPriceUsdPips: '1800',
  effectiveSide: 'yes',
  entryPriceUsd: '0.33',
  entryPriceUsdPips: '3300',
  evmChainId: '137',
  expectedOpenTradingFeeUsd: '0.02',
  expectedOpenTradingFeeUsdPips: '200',
  expectedOpenTradingFeeUsdcUnits: '20000',
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  leverageBps: 50000,
  lifetimeFeeAprBps: 500,
  liquidationFeeBps: 200,
  marketTicker: 'BTC-100K-JUN',
  minExpectedPositionTokenUnits: '9900000',
  notionalAmountUsd: '50.00',
  notionalAmountUsdPips: '500000',
  notionalUsdcUnits: '50000000',
  originationFeeBps: 125,
  originationFeeUsd: '0.63',
  originationFeeUsdPips: '6250',
  originationFeeUsdcUnits: '625000',
  partnerOriginationFeeBps: 25,
  partnerOriginationFeeUsd: '0.13',
  partnerOriginationFeeUsdPips: '1250',
  partnerOriginationFeeUsdcUnits: '125000',
  partnerTradingFeeBps: 25,
  partnerTradingFeeUsd: '0.13',
  partnerTradingFeeUsdPips: '1250',
  partnerTradingFeeUsdcUnits: '125000',
  polygonVaultContractAddress: '0xvault',
  polymarketMarketId: '0xmarket',
  polymarketTokenId: '123456',
  polymarketTradingFeeBps: 100,
  positionSeed: 'seed1',
  positionSeedHex: '0xseed1',
  onChainPositionKey: '0xkey1',
  protocolOriginationFeeBps: 100,
  protocolOriginationFeeUsd: '0.50',
  protocolOriginationFeeUsdPips: '5000',
  protocolOriginationFeeUsdcUnits: '500000',
  provider: 'polymarket',
  signatureExpiry: '9999999999',
  slippageBps: 200,
  totalUserAmountUsd: '10.50',
  totalUserAmountUsdPips: '105000',
  totalUserAmountUsdcUnits: '10500000',
}

const MOCK_SESSION_KEY = 'dimes.mockDeleverageSchedule'

afterEach(() => {
  window.sessionStorage.removeItem(MOCK_SESSION_KEY)
})

describe('QuoteDetails scheduled-deleveraging integration', () => {
  it('renders the schedule panel as a shadow preview when the QA mock is enabled', () => {
    window.sessionStorage.setItem(MOCK_SESSION_KEY, '1')
    render(<QuoteDetails offer={offer} />)

    expect(screen.getByText('Scheduled Deleveraging (shadow)')).toBeInTheDocument()
    expect(screen.getByText('Standard (today)')).toBeInTheDocument()
    expect(screen.getByText('Scheduled (shadow preview)')).toBeInTheDocument()
    expect(screen.getByText('shadow — not yet executing')).toBeInTheDocument()
    expect(screen.getByText('Position Remaining')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'What-if price' })).toBeInTheDocument()
    // The engine is still the real manager — its liquidation price stays a
    // first-class stat, with no superseded chip and no strike-through.
    expect(screen.getByText('Liquidation Price')).toBeInTheDocument()
    expect(screen.queryByText('superseded by schedule')).not.toBeInTheDocument()
    expect(screen.getByText('$0.18')).toBeInTheDocument()
  })

  it('keeps the current quote view untouched when no schedule exists', () => {
    render(<QuoteDetails offer={offer} />)

    expect(screen.queryByText('Scheduled Deleveraging (shadow)')).not.toBeInTheDocument()
    expect(screen.queryByText('Standard (today)')).not.toBeInTheDocument()
    expect(screen.queryByText('superseded by schedule')).not.toBeInTheDocument()
    expect(screen.getByText('Liquidation Price')).toBeInTheDocument()
    expect(screen.getByText('$0.18')).toBeInTheDocument()
  })
})
