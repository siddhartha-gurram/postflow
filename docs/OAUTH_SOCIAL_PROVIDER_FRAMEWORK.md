# PostFlow — Generic OAuth & Social Provider Framework

**Document version:** 1.0  
**Scope:** Pluggable provider architecture, common interface, token security, extensibility.  
**No platform-specific implementations** — design only.

---

## Table of Contents

1. [Overview & Principles](#1-overview--principles)
2. [SocialProvider Interface](#2-socialprovider-interface)
3. [Pluggable Provider Architecture](#3-pluggable-provider-architecture)
4. [Token Storage Model](#4-token-storage-model)
5. [Secure Token Encryption](#5-secure-token-encryption)
6. [Separation: Core vs Provider Logic](#6-separation-core-vs-provider-logic)
7. [Provider Registry & Discovery](#7-provider-registry--discovery)
8. [Adding a New Provider (Checklist)](#8-adding-a-new-provider-checklist)
9. [Folder Structure](#9-folder-structure)
10. [Error & Edge Cases](#10-error--edge-cases)

---

## 1. Overview & Principles

### Goals

- **Single contract:** All social platforms are used through one `SocialProvider` interface. Core code (auth routes, publishing worker, analytics job) never branches on platform name.
- **Pluggable:** A new platform = new provider class + config + registration; no changes to core flows.
- **Secure:** Tokens are never stored in plaintext; encryption/decryption is centralized and mandatory.
- **Testable:** Core logic can be tested with a mock provider; providers can be tested in isolation with stub HTTP.

### Out of Scope (This Document)

- Actual OAuth URLs, scopes, or API shapes for Twitter, LinkedIn, Facebook, Instagram, YouTube. Those belong in provider implementations.
- Frontend UI for “Connect account” (only backend contract and redirect URLs are implied).

---

## 2. SocialProvider Interface

Every provider (Twitter, LinkedIn, etc.) implements the same interface. All methods are async and return well-typed results or throw domain errors.

### 2.1 Interface Definition (TypeScript-style for clarity)

```ts
// ============ Types (shared) ============

type ProviderId = string;  // e.g. "twitter" | "linkedin" | "facebook"

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;     // e.g. https://api.postflow.app/v1/connections/callback/twitter
  scopes: string[];        // provider-specific scope strings
  authUrl: string;         // provider authorization endpoint
  tokenUrl: string;        // provider token endpoint
  // Optional: provider-specific (e.g. PKCE, response_type)
  extraAuthParams?: Record<string, string>;
}

interface AuthUrlResult {
  url: string;             // Full URL to redirect the user to
  state: string;           // Opaque state; must be stored and validated in callback
  pkceCodeVerifier?: string; // If PKCE, store server-side and bind to state
}

interface CallbackPayload {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
  // Provider may return extra params (e.g. scope)
  [key: string]: string | undefined;
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;   // When access token expires (if known)
  expiresIn?: number | null;  // Seconds until expiry (alternative to expiresAt)
  scope?: string;
  raw?: Record<string, unknown>; // Provider-specific (e.g. token_type)
}

interface Profile {
  platformUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  raw?: Record<string, unknown>;
}

interface PublishPayload {
  text: string;
  linkUrl?: string;
  linkTitle?: string;
  media?: Array<{ type: "image" | "video"; url: string; key?: string }>;
  // Provider-specific options (e.g. visibility, first_comment)
  options?: Record<string, unknown>;
}

interface PublishResult {
  platformPostId: string;
  platformPostUrl?: string;
  publishedAt: Date;
  raw?: Record<string, unknown>;
}

interface AnalyticsResult {
  platformPostId: string;
  metrics: {
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    clicks?: number;
    engagement?: number;
    [key: string]: number | undefined;
  };
  fetchedAt: Date;
  raw?: Record<string, unknown>;
}

// ============ SocialProvider interface ============

interface SocialProvider {
  readonly id: ProviderId;

  // ---- OAuth ----
  getAuthUrl(organizationId: string, userId: string): Promise<AuthUrlResult>;
  handleCallback(payload: CallbackPayload, storedState: StoredOAuthState): Promise<{ tokens: TokenSet; profile: Profile }>;

  // ---- Token lifecycle ----
  refreshToken(refreshToken: string): Promise<TokenSet>;

  // ---- API operations (use decrypted tokens from storage) ----
  publishPost(accessToken: string, payload: PublishPayload, options?: { accountId?: string }): Promise<PublishResult>;
  fetchAnalytics(accessToken: string, platformPostId: string, options?: { accountId?: string }): Promise<AnalyticsResult | null>;

  // ---- Optional: health / revoke ----
  revokeToken?(accessToken: string): Promise<void>;
  getProfile?(accessToken: string): Promise<Profile>;
}
```

### 2.2 Contract Rules

- **getAuthUrl(organizationId, userId):** Builds the authorization URL and generates `state` (and PKCE `code_verifier` if required). The **core** layer is responsible for persisting `state` (and optional `code_verifier`) keyed by `state`, with `organizationId` and `userId`, and TTL (e.g. 10 minutes). Provider does not touch storage.
- **handleCallback(payload, storedState):** Exchanges `code` for tokens and fetches minimal profile. Caller passes the stored state (and `code_verifier` if PKCE) so provider can complete the exchange. Provider returns tokens and profile; **core** layer encrypts tokens and writes to SocialAccounts.
- **refreshToken(refreshToken):** Uses only the refresh token (decrypted by core before calling). Returns new `TokenSet`. Core updates stored tokens and expiry.
- **publishPost / fetchAnalytics:** Receive **decrypted** `accessToken`. Provider does not see DB or encryption. For multi-account platforms (e.g. Facebook Pages), `options.accountId` can identify the target entity.

### 2.3 StoredOAuthState (core-owned)

Core stores this when redirecting to `getAuthUrl` and retrieves it in the callback by `state`.

```ts
interface StoredOAuthState {
  state: string;
  organizationId: string;
  userId: string;
  providerId: ProviderId;
  pkceCodeVerifier?: string;
  createdAt: number;  // for TTL
}
```

---

## 3. Pluggable Provider Architecture

### 3.1 Flow: Who Does What

- **Core** (connections module): HTTP routes, session/state storage, plan limits (e.g. max social accounts), DB read/write of SocialAccounts, **encryption/decryption**, calling provider methods.
- **Provider**: Only OAuth URLs, token exchange, profile fetch, refresh, publish, analytics. No DB, no encryption, no knowledge of PostFlow domains (Organization, User). Provider receives and returns DTOs only.

### 3.2 Sequence: Connect Flow

```
User                Frontend              API (core)              Provider (e.g. Twitter)
 │                      │                      │                            │
 │  Click "Connect X"   │                      │                            │
 │─────────────────────▶                      │                            │
 │                      │  GET /connections/connect/twitter?organizationId= │
 │                      │─────────────────────▶                            │
 │                      │                      │  getAuthUrl(orgId, userId)  │
 │                      │                      │────────────────────────────▶
 │                      │                      │  { url, state, codeVerifier }│
 │                      │                      │◀────────────────────────────
 │                      │                      │  save state (Redis, TTL)    │
 │                      │  302 redirect to url │                            │
 │                      │◀─────────────────────                              │
 │  302 redirect        │                      │                            │
 │◀─────────────────────                        │                            │
 │  User authorizes on platform                 │                            │
 │  Platform redirects to callback with ?code= &state=                        │
 │                      │  GET /connections/callback/twitter?code=...&state=   │
 │                      │─────────────────────▶                            │
 │                      │                      │  load state by state         │
 │                      │                      │  handleCallback(payload, state)
 │                      │                      │────────────────────────────▶
 │                      │                      │  { tokens, profile }         │
 │                      │                      │◀────────────────────────────
 │                      │                      │  encrypt(tokens)             │
 │                      │                      │  upsert SocialAccount        │
 │                      │  302 redirect to app  │                            │
 │                      │◀─────────────────────                              │
 │  Dashboard           │                      │                            │
 │◀─────────────────────                        │                            │
```

### 3.3 Sequence: Publish (core uses provider)

```
Publish Worker (core)     TokenService (core)      Provider
 │                            │                        │
 │  load Post + SocialAccounts │                        │
 │  for each account:         │                        │
 │  getDecryptedTokens(id)    │                        │
 │───────────────────────────▶                        │
 │  { accessToken }           │                        │
 │◀───────────────────────────                        │
 │  if expiresSoon(accessToken) → refreshToken() then getDecryptedTokens again
 │  provider.publishPost(accessToken, payload)         │
 │────────────────────────────────────────────────────▶
 │  PublishResult             │                        │
 │◀────────────────────────────────────────────────────
 │  persist result, update token if refreshed         │
```

---

## 4. Token Storage Model

### 4.1 Where Tokens Live

- **Persistence:** MongoDB collection **SocialAccounts** (or Connections). One document per (organizationId, provider, platformUserId).
- **Sensitive fields:** `accessToken`, `refreshToken`, and any nested token (e.g. `metadata.pageAccessToken`) are **never** stored in plaintext. They are encrypted by the **TokenService** before write and decrypted on read.

### 4.2 Document Shape (logical; matches MONGODB_SCHEMAS.md)

```ts
interface SocialAccountDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  providerId: ProviderId;           // "twitter" | "linkedin" | ...
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  avatarUrl?: string;

  // Encrypted at rest (see §5)
  accessToken: string;              // ciphertext
  refreshToken?: string | null;     // ciphertext or empty
  tokenExpiresAt?: Date | null;

  scopes?: string[];
  metadata?: Record<string, unknown>;  // Any token-like value in metadata must be encrypted

  status: "active" | "expired" | "revoked" | "error";
  lastErrorAt?: Date;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastRefreshedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
```

### 4.3 What Is Stored in Plaintext vs Encrypted

| Field               | Stored as   | Notes |
|---------------------|------------|-------|
| accessToken         | Ciphertext | Always encrypt |
| refreshToken        | Ciphertext | Always encrypt |
| tokenExpiresAt      | Plaintext  | Date only |
| metadata.pageAccessToken | Ciphertext | If present, encrypt like accessToken |
| metadata.* (non-token) | Plaintext | e.g. pageId, instagramBusinessAccountId |

### 4.4 State Storage (OAuth flow)

- **State** (and optional PKCE `code_verifier`) must be stored between redirect and callback.
- **Store:** Redis (or in-memory cache in single-instance). Key: `oauth:state:{state}`, Value: JSON of `StoredOAuthState`, TTL: 600 seconds.
- **Reason:** Stateless API; state must be retrievable by any instance. Redis is shared and supports TTL.

---

## 5. Secure Token Encryption

### 5.1 Requirements

- Tokens are encrypted **before** being sent to MongoDB and decrypted only in the application layer when needed (refresh, publish, analytics).
- Encryption key must not live in application code or in repo; use **environment / secrets manager** (e.g. AWS Secrets Manager, HashiCorp Vault, or env var in secure runtime).
- Algorithm: **AES-256-GCM** (authenticated encryption). Use a unique **IV/nonce** per encryption operation and store it with the ciphertext (or derive from a fixed context so storage stays small).

### 5.2 TokenService (core)

Single responsibility: encrypt before save, decrypt after load. Used by connections service and publish worker only; providers never call it.

**Operations:**

- `encrypt(plaintext: string): string`  
  - Input: raw token string.  
  - Output: opaque string (e.g. `base64(iv + authTag + ciphertext)` or a structured format like `v1:iv:tag:ciphertext`).  
  - Internal: generate random IV (12 bytes for GCM), encrypt with AES-256-GCM, append auth tag (16 bytes), encode for storage.

- `decrypt(ciphertext: string): string`  
  - Input: stored value.  
  - Output: raw token.  
  - Internal: decode, split IV/tag/ciphertext, decrypt, verify tag.

- **Key:** 256-bit key from env (e.g. `TOKEN_ENCRYPTION_KEY` base64) or from secrets manager. Key must be rotated via re-encryption job (out of scope here; design assumes one key per environment).

### 5.3 Encrypting Nested Tokens

If `metadata` contains tokens (e.g. `pageAccessToken`):

- **Option A:** Before save, recursively find known token keys and replace their values with `encrypt(value)`. On read, decrypt those keys. Provider-specific keys (e.g. `pageAccessToken`) are configured in a small list in TokenService or in provider config.
- **Option B:** Store encrypted blob for the whole `metadata` if it’s small and rarely queried. Simpler but prevents querying inside metadata.

Recommendation: **Option A** — encrypt only token-like fields; keep the rest queryable.

### 5.4 No Logging of Tokens

- Never log `accessToken`, `refreshToken`, or any decrypted token.
- In errors, log only `socialAccountId`, `providerId`, and maybe last 4 chars of token for debugging (optional); never full token.

---

## 6. Separation: Core vs Provider Logic

### 6.1 Core Layer (no provider knowledge)

- **ConnectionsService:**  
  - `initiateConnect(organizationId, userId, providerId)`: get provider from registry, call `getAuthUrl`, persist state, return redirect URL.  
  - `handleOAuthCallback(providerId, queryParams)`: load state, get provider, call `handleCallback`, encrypt tokens via TokenService, upsert SocialAccount, clear state, return redirect to app.  
  - `disconnect(organizationId, socialAccountId)`: delete or mark revoked; optionally call `provider.revokeToken` if present.

- **TokenRefreshService (or inside ConnectionsService):**  
  - Find accounts where `tokenExpiresAt < now + buffer`. For each: get provider, decrypt refreshToken, call `provider.refreshToken`, encrypt new tokens, update document.

- **PublishService (orchestrator):**  
  - Load post and SocialAccounts. For each account: get provider by `providerId`, get decrypted accessToken (and refresh if needed), call `provider.publishPost(accessToken, payload)`, persist result.

- **AnalyticsService:**  
  - For each post/account: get provider, decrypted accessToken, call `provider.fetchAnalytics(accessToken, platformPostId)`.

Core never imports platform-specific URLs or response shapes; it only uses the SocialProvider interface and DTOs.

### 6.2 Provider Layer (no core knowledge)

- Each provider lives in its own file (e.g. `providers/twitter.provider.js`). It implements `SocialProvider` and uses:
  - **Config:** From a central config (e.g. `config/providers/twitter.js`): clientId, clientSecret, redirectUri, scopes, authUrl, tokenUrl. Config is loaded by core and passed into provider constructor or factory.
  - **HTTP:** Own small client or use a shared `PlatformHttpClient` that only does: set Authorization header, optional retry/backoff, parse JSON. No DB, no encryption.
- Provider turns platform-specific responses into the common DTOs (`TokenSet`, `Profile`, `PublishResult`, `AnalyticsResult`). All platform quirks (e.g. different field names, pagination) are hidden inside the provider.

### 6.3 Dependency Direction

```
Core (routes, connections service, publish worker, token service)
  ↓ depends on
SocialProvider (interface)
  ↑ implemented by
Provider implementations (Twitter, LinkedIn, ...)
```

Core depends on the abstraction; providers depend only on config and HTTP. No provider depends on core modules (DB, encryption, queues).

---

## 7. Provider Registry & Discovery

### 7.1 Registry

A **ProviderRegistry** holds all available providers and returns one by id.

- **Registration:** At startup, for each provider id (e.g. from env list `ENABLED_PROVIDERS=twitter,linkedin,facebook`), require the corresponding module and call `registry.register(providerInstance)`. Or: scan a `providers/` directory and instantiate each exported provider (each file exports a factory `createProvider(config): SocialProvider`).

- **Lookup:** `registry.get(providerId): SocialProvider | null`. Core uses this in connections and publish flows.

- **List:** `registry.list(): ProviderId[]` or `registry.listMeta(): { id, name, scopes }[]` for UI (e.g. “Connect Twitter”, “Connect LinkedIn”). Metadata (display name, icon, required scopes) can live on the provider as static props or in config.

### 7.2 Config Per Provider

- Each provider has a config object: clientId, clientSecret, redirectUri, scopes, authUrl, tokenUrl, and optional provider-specific params.
- Config is loaded from env (e.g. `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`) or from a single JSON/env that maps providerId → config. Never commit secrets; use env or secrets manager.
- Core passes the relevant config into the provider when creating it (factory pattern). Provider does not read env directly if you want to keep it testable (inject config).

### 7.3 Base URL for Callbacks

- Redirect URI must be stable: e.g. `https://api.postflow.app/v1/connections/callback/:providerId`. Core route is parameterized by `providerId`; callback handler loads provider by `providerId` and delegates to `handleCallback`.

---

## 8. Adding a New Provider (Checklist)

To add a new platform (e.g. “TikTok”):

1. **Config:** Add `config/providers/tiktok.js` (or env entries): clientId, clientSecret, redirectUri, scopes, authUrl, tokenUrl. Add to the config loader.
2. **Implementation:** Create `providers/tiktok.provider.js` that implements `SocialProvider`: `getAuthUrl`, `handleCallback`, `refreshToken`, `publishPost`, `fetchAnalytics`. Map platform responses to the common DTOs.
3. **Registration:** Register the provider in the registry (e.g. add to `ENABLED_PROVIDERS` and ensure the factory is called at startup, or add one line in `providers/index.js`).
4. **Routes:** No change — existing routes are parameterized by `providerId` (e.g. `GET /connections/connect/:providerId`, `GET /connections/callback/:providerId`). Ensure the new providerId is allowed (allowlist from registry or config).
5. **Token storage:** No change — same SocialAccount document; encryption applies to all providers. If the new provider has nested tokens (e.g. page token), add that key to the “encrypt these metadata keys” list in TokenService.
6. **Optional:** Add provider-specific rate limit or retry rules in a shared `PlatformHttpClient` or in config (e.g. per-provider max requests per minute).

No changes to connections service logic, publish worker flow, or analytics job beyond “new providerId is available in registry.”

---

## 9. Folder Structure

```
backend/src/
├── config/
│   └── providers/
│       ├── index.js          # Load all provider configs; export map providerId → config
│       ├── twitter.js        # (example) exports config for twitter
│       └── ...
│
├── modules/
│   └── connections/
│       ├── connection.model.js
│       ├── connection.service.js    # Uses TokenService, ProviderRegistry; no provider impl
│       ├── connection.controller.js
│       ├── connection.routes.js     # GET /connect/:providerId, GET /callback/:providerId
│       ├── token.service.js         # encrypt/decrypt; used by connection + publish
│       └── oauth-state.store.js     # Redis get/set/delete state (TTL)
│
├── lib/
│   ├── providers/
│   │   ├── index.js                 # ProviderRegistry; register/list/get
│   │   ├── types.js                 # SocialProvider interface (JSDoc or .d.ts)
│   │   ├── base.provider.js         # Optional: base class with shared helpers (buildAuthUrl, etc.)
│   │   ├── twitter.provider.js      # Implements SocialProvider
│   │   ├── linkedin.provider.js
│   │   └── ...
│   └── platformClient.js            # Shared HTTP client (retry, backoff, no tokens in logs)
│
├── modules/publishing/
│   ├── publish.service.js           # Gets provider from registry, decrypts token, calls publishPost
│   └── publishers/                  # Optional: thin wrappers if you want per-provider publish logic
│       └── index.js                # Resolves provider and delegates to provider.publishPost
│
└── modules/analytics/
    └── analytics.service.js        # Gets provider, decrypts token, calls fetchAnalytics
```

- **Core:** `connections` (including TokenService, oauth-state), `publishing`, `analytics` — they depend on `lib/providers` (registry + interface), not on individual provider files.
- **Providers:** Under `lib/providers/`; each file is one provider. Registry can live in `lib/providers/index.js` and require/register each provider.

---

## 10. Error & Edge Cases

### 10.1 OAuth Callback

- **Missing or invalid state:** Return 400 and do not exchange code. Log for security.
- **Provider returns error in callback (e.g. access_denied):** Redirect user to app with query param `?error=access_denied` and show “Connection canceled” in UI.
- **Token exchange 4xx/5xx:** Log, redirect to app with `?error=connection_failed`. Do not save any token.

### 10.2 Token Refresh

- **Refresh token missing or null:** Mark SocialAccount as `expired` or `revoked`; notify user (email/in-app). Do not retry indefinitely.
- **Refresh returns 4xx (e.g. invalid_grant):** Same: mark expired/revoked, notify. Optional: call `revokeToken` if provider supports it.
- **Refresh returns 429:** Honor Retry-After; re-queue refresh job with delay. Do not mark expired yet.

### 10.3 Publish / Analytics

- **Expired access token:** Before calling publish/analytics, core should check `tokenExpiresAt` and refresh if within buffer. If refresh fails, mark account and fail the post with “Connection expired” (do not blame “publish failed” only).
- **Provider throws (e.g. rate limit, 5xx):** Core catches, maps to domain error (e.g. RateLimitError, PlatformError), and lets publish worker retry or persist failure accordingly. Provider should not swallow platform errors; surface them so core can decide.

### 10.4 Security

- **State:** Cryptographically random (e.g. 32 bytes hex); bind to organizationId and userId so a stolen state cannot be used for another org.
- **PKCE:** Use for public clients or whenever the provider supports it; store `code_verifier` with state and pass to `handleCallback`.
- **Redirect URI:** Exact match on provider’s developer portal; no open redirect. Callback handler validates that the redirect back to the app uses a fixed allowlist of frontend URLs.

---

## Summary

| Concern | Responsibility |
|--------|-----------------|
| OAuth URL and state | Provider: build URL; Core: persist/validate state |
| Token exchange | Provider: HTTP exchange; Core: encrypt and save |
| Token storage | Core: SocialAccount doc; TokenService: encrypt/decrypt |
| Refresh | Provider: refreshToken(); Core: decide when, decrypt/encrypt, update doc |
| Publish / Analytics | Provider: HTTP to platform; Core: resolve provider, decrypt token, call interface |
| Adding a provider | New config + new class implementing SocialProvider + register |

This gives you a **generic OAuth integration framework** with a clear **SocialProvider** contract, **pluggable providers**, **secure token handling**, and a **strict separation** between core and provider logic, making it straightforward to add new platforms later without touching core flows.
