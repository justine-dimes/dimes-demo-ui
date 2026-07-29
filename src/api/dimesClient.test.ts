import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildQuoteParams } from '@dimes-dot-fi/sdk'
import { getDimesClient, setScheduledDeleverageOptIn } from './dimesClient'

// The SDK client binds globalThis.fetch at construction, and the module
// constructs its singleton lazily — stubbing in beforeEach (before the first
// getDimesClient() call in any test) captures every request body.
const requests: { url: string; body: Record<string, unknown> }[] = []

const fetchStub = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
  return new Response(JSON.stringify({ id: 'dm_off_test' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

beforeEach(() => {
  requests.length = 0
  vi.stubGlobal('fetch', fetchStub)
})

afterAll(() => {
  setScheduledDeleverageOptIn(false)
  vi.unstubAllGlobals()
})

const quoteParams = buildQuoteParams({
  marketTicker: 'TEST-MARKET',
  side: 'yes',
  collateralUsd: 10,
  leverageBps: 20000,
  slippageBps: 800,
})

describe('scheduled-deleveraging quote opt-in', () => {
  it('sends use_scheduled_deleverage: true on draft quotes while opted in', async () => {
    setScheduledDeleverageOptIn(true)
    await getDimesClient().createDraftQuote(quoteParams)

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain('/v1/prediction-markets/draft-quotes')
    expect(requests[0].body.use_scheduled_deleverage).toBe(true)
    expect(requests[0].body.market_ticker).toBe('TEST-MARKET')
  })

  it('sends it on direct quotes too (the auto-correct path)', async () => {
    setScheduledDeleverageOptIn(true)
    await getDimesClient().createQuote(quoteParams)

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain('/v1/prediction-markets/quotes')
    expect(requests[0].body.use_scheduled_deleverage).toBe(true)
  })

  it('omits the field entirely while opted out — current behaviour untouched', async () => {
    setScheduledDeleverageOptIn(false)
    await getDimesClient().createDraftQuote(quoteParams)

    expect(requests).toHaveLength(1)
    expect('use_scheduled_deleverage' in requests[0].body).toBe(false)
    expect(requests[0].body.market_ticker).toBe('TEST-MARKET')
  })
})
