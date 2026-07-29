import { DimesClient, type AuthProvider } from '@dimes-dot-fi/sdk';
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

// Shadow-mode pivot: the API computes and returns `deleverageSchedule` on
// every eligible draft quote automatically — no request field, no opt-in, and
// no client subclass. Quote requests go through the stock SDK client.
let client: DimesClient | null = null;

export function getDimesClient(): DimesClient {
  if (!client) {
    client = new DimesClient({ baseUrl: getApiBase(), auth: new StoreAuth() });
  }
  return client;
}
