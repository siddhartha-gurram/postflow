# LinkedIn Provider

Production-ready `SocialProvider` implementation for LinkedIn (OAuth 2.0 + API v2).

## Features

- **OAuth 2.0 Authorization Code flow** with PKCE (code_challenge S256)
- **Token refresh** via `refresh_token` grant (when LinkedIn has enabled it for your app)
- **Publish**: UGC Post API v2 (text + optional link; image/video require LinkedIn asset upload flow separately)
- **Analytics**: `memberCreatorPostAnalytics` REST API (requires `r_member_postAnalytics`; returns `null` if not available)
- **Rate limit handling**: throws `ProviderRateLimitError` with `retryAfterSeconds` for 429
- **Error mapping**: OAuth and API errors mapped to `OAuthError` / `ProviderClientError` / `ProviderServerError`

## Scopes

| Scope | Purpose |
|-------|---------|
| `openid` | OpenID Connect |
| `profile` | Name, profile picture (/v2/me or userinfo) |
| `email` | Email (userinfo) |
| `w_member_social` | Create UGC posts on behalf of the member |
| `r_member_postAnalytics` | Post analytics (optional; requires MDP product) |

## Environment Variables

See project root `backend/.env.example`:

- `LINKEDIN_CLIENT_ID` (required)
- `LINKEDIN_CLIENT_SECRET` (required)
- `LINKEDIN_REDIRECT_URI` (required, must match app redirect URL exactly)
- `LINKEDIN_SCOPES` (optional; default: openid profile email w_member_social)

## Token Expiration

- Access tokens: **60 days** (LinkedIn).
- Refresh tokens: only returned for **approved partners**; otherwise users must re-connect when the access token expires.
- The provider returns `expiresAt` and `expiresIn` in `TokenSet`; core is responsible for refreshing before expiry and marking the account expired if refresh fails.

## Rate Limits

- On 429, the provider throws `ProviderRateLimitError` with `retryAfterSeconds` (from `Retry-After` or default 60).
- The platform client retries 5xx with exponential backoff; it does **not** retry 429 (caller should re-queue the job with delay).

## Adding to the Registry

```js
const { LinkedInProvider } = require('./lib/providers/linkedin.provider');
registry.register(new LinkedInProvider());
// or with custom config:
registry.register(new LinkedInProvider(getLinkedInConfig(process.env)));
```
