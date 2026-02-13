# PostFlow Backend — Core Integration Wiring

## Connections (OAuth)

### Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/connections/connect/:providerId` | Yes | Start OAuth; redirects to provider. Query: `organizationId` (or from JWT). |
| GET | `/connections/callback/:providerId` | No | OAuth callback; encrypts tokens, upserts SocialAccount, redirects to frontend. |

Example: `GET /connections/connect/linkedin?organizationId=507f1f77bcf86cd799439011`

### Flow

1. **Connect:** Client calls `GET /connections/connect/linkedin` with auth (Bearer JWT or `X-User-Id`, `X-Organization-Id`). Service gets provider from registry, calls `getAuthUrl()`, stores state (and PKCE verifier) in Redis with TTL 600s, returns 302 to LinkedIn.
2. **Callback:** LinkedIn redirects to `GET /connections/callback/linkedin?code=...&state=...`. Service loads state from Redis, calls `provider.handleCallback()`, encrypts tokens via TokenService (AES-256-GCM), upserts SocialAccount (platformUserId, displayName, avatarUrl, tokenExpiresAt, providerId as `platform`), deletes state, redirects to `FRONTEND_URL/connections?connected=1`.

### Components

- **OAuthStateStore** (Redis): `set(state, data)`, `get(state)`, `delete(state)`; key `oauth:state:{state}`, TTL 600s.
- **TokenService**: `encrypt(plaintext)`, `decrypt(ciphertext)`; AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY`.
- **SocialAccount** (Mongo): `organizationId`, `platform`, `platformUserId`, `displayName`, `avatarUrl`, encrypted `accessToken`/`refreshToken`, `tokenExpiresAt`, `status`.

---

## Publish Flow

### Trigger

- **POST /publish/:postId** (auth required, query `organizationId` or from JWT): Enqueues a BullMQ job `{ postId }` to the `publish` queue.

### Job Processor

1. Load **Post** by postId; ensure status is scheduled/queued/publishing.
2. For each **socialAccountId** on the post:
   - Load **SocialAccount**.
   - **getValidAccessToken(socialAccountId):** Decrypt access token; if expired (or within 5 min), decrypt refresh token, call `provider.refreshToken()`, encrypt new tokens, update SocialAccount. On **invalid_grant** / refresh failure → mark SocialAccount **expired**, persist failed PublishResult, exit (no retry).
   - Build **PublishPayload** from post content (and variant per account if present).
   - Call **provider.publishPost(accessToken, payload)**.
   - On success: upsert **PublishResult** (postId, socialAccountId, status published, platformPostId, platformPostUrl, publishedAt).
   - On **429 (ProviderRateLimitError):** `job.moveToDelayed(Date.now() + retryAfterSeconds * 1000, job.token)`, throw `DelayedError` (job not marked failed; runs again after delay).
   - On **5xx / ProviderServerError:** Throw → BullMQ retries with exponential backoff (attempts: 4, backoff 2s).
   - On **OAuthError / TOKEN_EXPIRED:** Already handled in getValidAccessToken (account marked expired); persist failed PublishResult, return (no retry).
3. Update **Post**: status = published or failed, publishedAt, failureReason/failureCode as needed.

### Storing platformPostId

- **PublishResult** document stores `platformPostId` and `platformPostUrl` per (postId, socialAccountId). Post document is updated with `status`, `publishedAt`, and optionally `failureReason`/`failureCode`; per-connection IDs live in PublishResult.

---

## Environment

- `MONGODB_URI`, `REDIS_URL`, `TOKEN_ENCRYPTION_KEY`, `FRONTEND_URL`
- LinkedIn: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`
- Optional: `PORT`, `NODE_ENV`

---

## Error Handling Summary

| Condition | Action |
|-----------|--------|
| 429 from platform | Requeue job with delay (retryAfterSeconds); throw DelayedError. |
| 5xx / network | Throw → BullMQ exponential backoff retry. |
| invalid_grant / refresh failed | Mark SocialAccount expired; persist failed PublishResult; no retry. |
| TOKEN_EXPIRED, no refresh token | Mark SocialAccount expired; no retry. |
