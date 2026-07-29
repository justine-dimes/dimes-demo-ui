import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildQuoteParams } from '@dimes-dot-fi/sdk'
import { getDimesClient } from './dimesClient'

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
  vi.unstubAllGlobals()
})

const quoteParams = buildQuoteParams({
  marketTicker: 'TEST-MARKET',
  side: 'yes',
  collateralUsd: 10,
  leverageBps: 20000,
  slippageBps: 800,
})

// Shadow-mode contract: the API attaches the schedule to every eligible draft
// quote on its own, so the client must send the stock SDK body — the retired
// opt-in field must never reappear on the wire.
describe('quote requests under shadow mode', () => {
  it('sends the plain SDK draft-quote body with no scheduled-deleverage field', async () => {
    await getDimesClient().createDraftQuote(quoteParams)

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain('/v1/prediction-markets/draft-quotes')
    expect('use_scheduled_deleverage' in requests[0].body).toBe(false)
    expect(requests[0].body.market_ticker).toBe('TEST-MARKET')
  })

  it('sends the plain body on direct quotes too (the auto-correct path)', async () => {
    await getDimesClient().createQuote(quoteParams)

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain('/v1/prediction-markets/quotes')
    expect('use_scheduled_deleverage' in requests[0].body).toBe(false)
    expect(requests[0].body.market_ticker).toBe('TEST-MARKET')
  })
})
