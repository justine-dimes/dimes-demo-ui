import {
  DimesClient,
  type AuthProvider,
  type CreateQuoteParams,
  type Quote,
} from '@dimes-dot-fi/sdk';
import { useAuthStore } from '../store/auth';
import { getApiBase } from '../runtimeConfig';
import { requestAuthToken } from './auth';

// Single shared DimesClient for every JWT-authenticated REST call. The auth
// provider reads the JWT from the auth store at call time, so the same client
// instance follows wallet/key changes — `useAutoAuth` still owns minting and
// refresh scheduling; this just lets the SDK consume the token it stores.
class StoreAuth implements AuthProvider {
  async getHeaders(): Promise<Record<string, string>> {
    const { jwt } = useAuthStore.getState();
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }

  getToken(): string | null {
    return useAuthStore.getState().jwt;
  }

  // Called by HttpClient on a 401. Mint a fresh token for the active wallet and
  // store it so the retried request (and any in-flight WebSocket) picks it up.
  async refresh(): Promise<void> {
    const { walletAddress, setAuth } = useAuthStore.getState();
    if (!walletAddress) {
      return;
    }
    const result = await requestAuthToken(walletAddress);
    setAuth(result.token, walletAddress, result.expiresAt);
  }
}

// Scheduled-deleveraging preview opt-in. The trade panel writes this right
// before requesting a quote; while set, every draft/quote request carries
// `use_scheduled_deleverage: true` (the SDK decamelizes request bodies). The
// API field is being added in parallel — sending it is harmless if ignored.
// A request-layer flag (rather than a param) because the SDK's quote machine
// rebuilds `CreateQuoteParams` internally and would drop unknown fields.
let scheduledDeleverageOptIn = false;

export function setScheduledDeleverageOptIn(enabled: boolean): void {
  scheduledDeleverageOptIn = enabled;
}

function withScheduledDeleverage(params: CreateQuoteParams): CreateQuoteParams {
  if (!scheduledDeleverageOptIn) return params;
  return { ...params, useScheduledDeleverage: true } as CreateQuoteParams;
}

class DemoDimesClient extends DimesClient {
  override createDraftQuote(params: CreateQuoteParams): Promise<Quote> {
    return super.createDraftQuote(withScheduledDeleverage(params));
  }

  override createQuote(params: CreateQuoteParams): Promise<Quote> {
    return super.createQuote(withScheduledDeleverage(params));
  }
}

let client: DimesClient | null = null;

export function getDimesClient(): DimesClient {
  if (!client) {
    client = new DemoDimesClient({ baseUrl: getApiBase(), auth: new StoreAuth() });
  }
  return client;
}
