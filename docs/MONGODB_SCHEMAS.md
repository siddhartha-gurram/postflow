# PostFlow — MongoDB Schema Design

**Target scale:** Millions of users · High read/write · Production-ready  
**Document version:** 1.0

---

## Design Principles for Scale

- **Reference over embed** for large or unbounded relationships (users, posts, analytics).
- **Shard key** on high-cardinality, frequently queried fields (e.g. `organizationId`, `userId`).
- **Compound indexes** aligned to query patterns; avoid index proliferation.
- **Bounded arrays** or separate collections for list-like data that grows (e.g. no unbounded `posts[]` in org).
- **TTL and retention** for ephemeral or audit data to control size.
- **Validation** at application layer (Mongoose/Joi) plus optional JSON Schema in MongoDB for critical fields.
- **Denormalization** only where it avoids expensive joins on hot paths (e.g. `organizationId` on every post).

---

## Collection Overview & Relationships

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Users     │────▶│  Organizations    │◀────│ SubscriptionPlans (ref)
└──────┬──────┘     └────────┬─────────┘     └─────────────────┘
       │                     │
       │  memberships        │  1:N
       ▼                     ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Memberships │     │  SocialAccounts  │     │  BillingRecords │
│ (embed or   │     │  (per org)       │     │  (per org)      │
│  separate)  │     └────────┬─────────┘     └─────────────────┘
└─────────────┘              │
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Posts     │     │     Queues       │     │   Schedules     │
│ (ref org,   │     │ (config per      │     │ (slot/rule      │
│  accounts)  │     │  SocialAccount)  │     │  or ref post)   │
└──────┬──────┘     └──────────────────┘     └─────────────────┘
       │
       ▼
┌─────────────┐
│  Analytics  │
│ (per post   │
│  or account)│
└─────────────┘
```

---

## 1. Users

Stores platform users (not org memberships; those are in organization context).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | Primary key |
| `email` | string | yes* | Lowercase; unique. *Optional if OAuth-only and email not yet provided |
| `emailVerified` | boolean | yes | Default false |
| `passwordHash` | string | no | Null if OAuth-only |
| `name` | string | no | Display name |
| `avatarUrl` | string | no | URL (CDN) |
| `locale` | string | no | e.g. "en-US" |
| `timezone` | string | no | IANA, e.g. "America/New_York" |
| `role` | string | yes | Platform role: "user" \| "admin" \| "support" |
| `lastLoginAt` | Date | no | Last successful login |
| `loginCount` | int32 | no | Optional; for analytics |
| `status` | string | yes | "active" \| "suspended" \| "deleted" |
| `deletedAt` | Date | no | Soft delete; set when status = deleted |
| `createdAt` | Date | yes | Immutable |
| `updatedAt` | Date | yes | Set on every update |

### Relationships

- **Users → Organizations:** N:M via **Memberships** (stored in Organizations as embedded array or separate collection). For scale, prefer **separate `memberships` collection** (see below).
- **Users → BillingRecords:** Indirect (billing is org-level; user is billing contact only if needed).

### Indexes

```javascript
// Unique: one account per email
{ "email": 1 }, { unique: true }   // sparse if email optional

// Lookup by status (admin lists active users)
{ "status": 1, "createdAt": -1 }

// Soft delete / retention
{ "deletedAt": 1 }, { sparse: true }

// Optional: compound for admin search
{ "status": 1, "email": 1 }
```

### Validation Rules (application + optional MongoDB JSON Schema)

- `email`: format email; max 255; lowercase.
- `name`: max 200.
- `avatarUrl`: max 2048; valid URL format.
- `timezone`: IANA timezone string (validate against list).
- `role`: enum ["user", "admin", "support"].
- `status`: enum ["active", "suspended", "deleted"].

### Scalability (millions of users)

- **Sharding:** Not required for "users" alone at millions if reads are mostly by `_id` or `email`. If you need to shard: `email` or `_id` (hashed) as shard key.
- **Writes:** Single-doc updates (lastLoginAt, updatedAt); low write volume per user.
- **Avoid:** Storing org list in user doc (unbounded array). Use separate **memberships** collection with `userId` + `organizationId`.
- **Projection:** Always project only needed fields; avoid returning `passwordHash` in any API.

---

## 2. Organizations

Tenant / workspace. Billing and plan are org-level.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | Primary key |
| `name` | string | yes | Display name |
| `slug` | string | yes | Unique URL-safe identifier (e.g. "acme-corp") |
| `logoUrl` | string | no | CDN URL |
| `timezone` | string | yes | IANA default for scheduling |
| `planId` | ObjectId | yes | Ref: SubscriptionPlans |
| `stripeCustomerId` | string | no | Stripe customer ID |
| `stripeSubscriptionId` | string | no | Current subscription |
| `subscriptionStatus` | string | no | "active" \| "past_due" \| "canceled" \| "trialing" \| "incomplete" |
| `trialEndsAt` | Date | no | For trialing |
| `settings` | object | no | Feature flags, preferences (bounded keys) |
| `status` | string | yes | "active" \| "suspended" \| "canceled" |
| `createdAt` | Date | yes | Immutable |
| `updatedAt` | Date | yes | |

### Relationships

- **Organizations → SubscriptionPlans:** N:1 via `planId`.
- **Organizations → Users:** N:M via **Memberships** (separate collection recommended).
- **Organizations → SocialAccounts:** 1:N.
- **Organizations → Posts:** 1:N (posts hold `organizationId`).
- **Organizations → BillingRecords:** 1:N.
- **Organizations → Queues:** Via SocialAccounts (queue per SocialAccount).

### Indexes

```javascript
// Unique slug for URLs and API
{ "slug": 1 }, { unique: true }

// Billing / support: find by Stripe
{ "stripeCustomerId": 1 }, { sparse: true }
{ "stripeSubscriptionId": 1 }, { sparse: true }

// Filter by status and plan (admin / analytics)
{ "status": 1, "planId": 1 }
{ "updatedAt": -1 }
```

### Validation Rules

- `name`: length 1–200.
- `slug`: regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`; length 2–80.
- `timezone`: IANA.
- `subscriptionStatus`: enum (Stripe values).
- `status`: enum ["active", "suspended", "canceled"].

### Scalability

- **Sharding:** If you shard by org, use `_id` or `slug` as shard key so all org data (posts, social accounts) can be co-located by **compound shard key** in other collections: `{ organizationId: 1, ... }`.
- **Hot path:** Dashboard loads org by `_id` or `slug`; single doc read. Keep doc small; do not embed full member list if large (use memberships collection with `organizationId` index).

---

## 3. Memberships (recommended separate collection)

Links Users to Organizations with a role. Prefer this over embedding in Organizations for scale (unbounded members per org).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `userId` | ObjectId | yes | Ref: Users |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `role` | string | yes | "owner" \| "admin" \| "member" \| "viewer" |
| `invitedBy` | ObjectId | no | Ref: Users |
| `invitedAt` | Date | no | |
| `joinedAt` | Date | no | Null until accepted |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Indexes

```javascript
// Unique: one membership per user per org
{ "userId": 1, "organizationId": 1 }, { unique: true }

// List members of an org (high volume)
{ "organizationId": 1, "role": 1 }
{ "organizationId": 1, "joinedAt": -1 }

// List orgs for a user (dashboard)
{ "userId": 1, "joinedAt": -1 }
```

### Validation

- `role`: enum ["owner", "admin", "member", "viewer"].
- Exactly one owner per org (enforce in application).

### Scalability

- **Sharding:** Shard by `organizationId` if you have huge orgs; otherwise `userId` for "my orgs" queries. For millions of users, `userId` as shard key gives good distribution.
- **Queries:** "Members of org X" → index on `organizationId`. "Orgs for user Y" → index on `userId`.

---

## 4. SocialAccounts

Connected social platforms per organization. Tokens must be encrypted at rest.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `platform` | string | yes | "twitter" \| "linkedin" \| "facebook" \| "instagram" \| "pinterest" \| "tiktok" \| "youtube" |
| `platformUserId` | string | yes | ID on the platform |
| `platformUsername` | string | no | @handle or display username |
| `displayName` | string | no | For UI |
| `avatarUrl` | string | no | Profile image URL |
| `accessToken` | string | yes | Encrypted at rest |
| `refreshToken` | string | no | Encrypted; not all platforms have |
| `tokenExpiresAt` | Date | no | When access token expires |
| `scopes` | array of string | no | Granted OAuth scopes |
| `metadata` | object | no | Platform-specific: pageId, pageAccessToken (encrypted), instagramBusinessAccountId, etc. |
| `status` | string | yes | "active" \| "expired" \| "revoked" \| "error" |
| `lastErrorAt` | Date | no | Last API error |
| `lastErrorCode` | string | no | |
| `lastErrorMessage` | string | no | Truncated; no PII |
| `lastRefreshedAt` | Date | no | Token refresh time |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **SocialAccounts → Organizations:** N:1 via `organizationId`.
- **SocialAccounts → Posts:** N:M (posts reference `socialAccountIds[]`).
- **SocialAccounts → Queues:** 1:1 (one queue config per SocialAccount).
- **SocialAccounts → Schedules:** Used when computing next slot; schedule can reference `socialAccountId`.

### Indexes

```javascript
// Unique: one connection per platform user per org
{ "organizationId": 1, "platform": 1, "platformUserId": 1 }, { unique: true }

// List accounts for org (dashboard, compose)
{ "organizationId": 1, "status": 1 }
{ "organizationId": 1, "updatedAt": -1 }

// Token refresh job: find expiring soon
{ "tokenExpiresAt": 1 }, { sparse: true }
{ "status": 1, "tokenExpiresAt": 1 }
```

### Validation Rules

- `platform`: enum (supported platforms).
- `platformUserId`, `platformUsername`: max lengths (e.g. 128).
- `status`: enum ["active", "expired", "revoked", "error"].

### Scalability

- **Sharding:** Shard by `organizationId` so org-scoped queries stay on one shard.
- **Security:** Encrypt `accessToken`, `refreshToken`, and any token-like fields in `metadata` (e.g. KMS or AES with key in secrets manager). Never log tokens.
- **Size:** Keep `metadata` bounded; avoid storing large payloads. Token size is typically small; encryption adds some overhead.

---

## 5. Posts

Content to be published (or already published) to one or more SocialAccounts.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `createdBy` | ObjectId | yes | Ref: Users |
| `status` | string | yes | "draft" \| "scheduled" \| "queued" \| "publishing" \| "published" \| "failed" |
| `content` | object | yes | See subfields |
| `content.text` | string | no | Main caption/body; max length per platform enforced in app |
| `content.linkUrl` | string | no | |
| `content.linkTitle` | string | no | |
| `content.linkDescription` | string | no | |
| `content.linkImageUrl` | string | no | |
| `variants` | array | no | Per-account overrides; bounded by number of connected accounts |
| `variants[].socialAccountId` | ObjectId | yes | |
| `variants[].text` | string | no | |
| `variants[].linkUrl` | string | no | |
| `media` | array | no | Bounded (e.g. max 10 items) |
| `media[].type` | string | yes | "image" \| "video" |
| `media[].url` | string | yes | CDN URL |
| `media[].key` | string | no | S3 key |
| `media[].width` | int | no | |
| `media[].height` | int | no | |
| `media[].duration` | int | no | Video seconds |
| `socialAccountIds` | array of ObjectId | yes | Ref: SocialAccounts; target accounts |
| `scheduledAt` | Date | no | UTC; when to publish (null for draft) |
| `timezone` | string | no | Override for this post (IANA) |
| `queuePosition` | int | no | Order in queue when using queue flow |
| `publishedAt` | Date | no | Set when status → published |
| `failureReason` | string | no | When status = failed |
| `failureCode` | string | no | |
| `idempotencyKey` | string | no | Client-provided; dedupe |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **Posts → Organizations:** N:1 via `organizationId`.
- **Posts → Users:** N:1 via `createdBy`.
- **Posts → SocialAccounts:** N:M via `socialAccountIds[]`.
- **Posts → Schedules:** Optional: a Schedule document can reference `postId` for "scheduled at slot" history; or schedule is implicit from `scheduledAt`.
- **Posts → Analytics:** 1:1 or 1:N (one analytics doc per post, or per post per account).

### Indexes

```javascript
// Scheduler: find due posts (scheduled scan job)
{ "status": 1, "scheduledAt": 1 }
// Filter: status in ["scheduled","queued"], scheduledAt <= now

// Org dashboard: recent posts
{ "organizationId": 1, "createdAt": -1 }
{ "organizationId": 1, "status": 1, "scheduledAt": 1 }

// User's posts
{ "organizationId": 1, "createdBy": 1, "createdAt": -1 }

// Idempotency
{ "idempotencyKey": 1 }, { unique: true, sparse: true }

// Calendar / list by date
{ "organizationId": 1, "scheduledAt": 1 }
{ "organizationId": 1, "publishedAt": -1 }
```

### Validation Rules

- `status`: enum as above.
- `content.text`: max length (e.g. 5000); platform-specific limits enforced in app.
- `media`: array length max (e.g. 10).
- `variants`: array length max (e.g. 20).
- `socialAccountIds`: non-empty when status not draft; refs must exist and belong to org.

### Scalability (millions of users → many posts)

- **Sharding:** Shard by `organizationId`. All posts for an org live on same shard; scheduler scan is the hot path—use compound index `{ status: 1, scheduledAt: 1 }` and run scan with `scheduledAt` range.
- **Write volume:** High (many posts per org over time). Avoid unbounded growth of `media`/`variants` (already bounded).
- **Pagination:** Always use cursor-based pagination on `createdAt` or `scheduledAt` (with `_id` tie-break) for infinite scroll.
- **Projection:** List views should project only list-needed fields (e.g. exclude full `content` and `media` if not needed).
- **TTL:** Do not TTL posts; use archival or move old posts to cold storage if needed (application-level).

---

## 6. Queues

Queue configuration per SocialAccount (when to post, how many per day, etc.). One document per SocialAccount.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `socialAccountId` | ObjectId | yes | Ref: SocialAccounts; unique per queue |
| `name` | string | no | e.g. "Default Queue" |
| `enabled` | boolean | yes | Default true |
| `timeSlots` | array | no | Preferred times (local to timezone) |
| `timeSlots[].hour` | int | yes | 0–23 |
| `timeSlots[].minute` | int | yes | 0–59 |
| `daysOfWeek` | array of int | no | 0 (Sun) – 6 (Sat); empty = all |
| `maxPostsPerDay` | int | no | Cap; default from plan |
| `timezone` | string | yes | IANA for timeSlots |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **Queues → Organizations:** N:1 via `organizationId`.
- **Queues → SocialAccounts:** 1:1 via `socialAccountId`.

### Indexes

```javascript
// One queue per social account
{ "socialAccountId": 1 }, { unique: true }

// List queues for org
{ "organizationId": 1 }
{ "organizationId": 1, "enabled": 1 }
```

### Validation Rules

- `timeSlots[].hour`: 0–23; `minute`: 0–59.
- `daysOfWeek`: each element 0–6; no duplicates.
- `maxPostsPerDay`: min 1, max (e.g. 50 or plan limit).

### Scalability

- **Volume:** One queue per SocialAccount; document count ≈ SocialAccounts. Low write rate (config changes only).
- **Sharding:** Shard by `organizationId` to align with Posts and SocialAccounts.

---

## 7. Schedules

Represents a scheduled slot or a concrete scheduled instance. Two possible models:

- **Option A (slot/rule only):** Schedules define recurring slots; actual schedule is `Posts.scheduledAt`. Then this collection could be omitted or used for "schedule templates."
- **Option B (explicit schedule record):** One document per "scheduled post instance" (post + time + account), used for history and conflict detection.

Below is **Option B** for audit and clarity: one schedule record per post scheduled to a given account at a given time.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `postId` | ObjectId | yes | Ref: Posts |
| `socialAccountId` | ObjectId | yes | Ref: SocialAccounts |
| `scheduledAt` | Date | yes | UTC |
| `timezone` | string | no | IANA used for display |
| `status` | string | yes | "pending" \| "published" \| "failed" \| "canceled" |
| `publishedAt` | Date | no | Actual publish time |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **Schedules → Organizations:** N:1.
- **Schedules → Posts:** N:1.
- **Schedules → SocialAccounts:** N:1.

### Indexes

```javascript
// Unique: one schedule per (post, account) — if one post can go to multiple accounts, one schedule per (post, account)
{ "postId": 1, "socialAccountId": 1 }, { unique: true }

// Scheduler: find pending by time
{ "status": 1, "scheduledAt": 1 }
{ "organizationId": 1, "scheduledAt": 1 }

// Calendar view
{ "organizationId": 1, "socialAccountId": 1, "scheduledAt": 1 }
```

### Validation Rules

- `status`: enum ["pending", "published", "failed", "canceled"].
- `scheduledAt`: must be future when status = pending (app logic).

### Scalability

- **Volume:** One schedule per (post, socialAccount). Grows with posts. Consider **TTL or archival** for old "published" schedules (e.g. move to cold storage after 90 days) to keep collection size bounded.
- **Sharding:** `organizationId` as shard key.

---

## 8. Analytics

Cached metrics per post (and optionally per SocialAccount). High read, periodic write (sync jobs).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `postId` | ObjectId | yes | Ref: Posts |
| `socialAccountId` | ObjectId | yes | Ref: SocialAccounts |
| `platformPostId` | string | no | ID on platform (for re-fetch) |
| `platformPostUrl` | string | no | |
| `metrics` | object | yes | Flattened; platform-dependent |
| `metrics.impressions` | int | no | |
| `metrics.likes` | int | no | |
| `metrics.comments` | int | no | |
| `metrics.shares` | int | no | |
| `metrics.clicks` | int | no | |
| `metrics.engagement` | int | no | |
| `metrics.reach` | int | no | |
| `fetchedAt` | Date | yes | Last sync from platform |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **Analytics → Organizations:** N:1.
- **Analytics → Posts:** N:1 (one row per post per account).
- **Analytics → SocialAccounts:** N:1.

### Indexes

```javascript
// One analytics row per (post, account)
{ "postId": 1, "socialAccountId": 1 }, { unique: true }

// Org analytics dashboard
{ "organizationId": 1, "fetchedAt": -1 }
{ "organizationId": 1, "metrics.impressions": -1 }

// Sync job: find stale
{ "fetchedAt": 1 }
```

### Validation Rules

- `metrics.*`: non-negative numbers.
- `fetchedAt`: not future.

### Scalability

- **Volume:** One doc per (post, socialAccount). Grows with published posts. Updates are in place (metrics + fetchedAt); no unbounded arrays.
- **Sharding:** `organizationId` as shard key.
- **Aggregations:** For org-level dashboards, run aggregations with `organizationId` filter; use `fetchedAt` to avoid re-syncing too often. Consider a separate **aggregated analytics** collection (e.g. daily rollup per org) if real-time per-post is too heavy for dashboard.
- **Retention:** Optional TTL or archive old analytics (e.g. keep last 2 years).

---

## 9. SubscriptionPlans

Catalog of plans (reference data; low write volume).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `slug` | string | yes | "free" \| "pro" \| "business" \| "enterprise" |
| `name` | string | yes | Display name |
| `description` | string | no | |
| `stripePriceId` | string | no | Monthly price ID |
| `stripePriceIdYearly` | string | no | Yearly price ID |
| `amountCents` | int | no | Fallback if no Stripe |
| `interval` | string | no | "month" \| "year" |
| `limits` | object | yes | Feature limits |
| `limits.socialAccounts` | int | yes | Max connected accounts |
| `limits.postsPerMonth` | int | yes | -1 = unlimited |
| `limits.teamMembers` | int | no | |
| `limits.workspaces` | int | no | Or use 1 for MVP |
| `features` | array of string | no | ["analytics", "queue", "best_time"] |
| `sortOrder` | int | no | For display order |
| `active` | boolean | yes | Default true |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

### Relationships

- **SubscriptionPlans → Organizations:** 1:N via `Organizations.planId`.
- **SubscriptionPlans → BillingRecords:** Referenced in billing (plan snapshot at time of record).

### Indexes

```javascript
{ "slug": 1 }, { unique: true }
{ "active": 1, "sortOrder": 1 }
```

### Validation Rules

- `slug`: enum or allowlist.
- `limits.*`: non-negative; -1 for unlimited where applicable.

### Scalability

- Small, static collection. No sharding. Cache in application (e.g. Redis) and invalidate on plan update.

---

## 10. BillingRecords

Invoices, payments, usage snapshots per organization. Append-only for history.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `type` | string | yes | "subscription" \| "invoice" \| "usage" \| "refund" \| "credit" |
| `stripeInvoiceId` | string | no | |
| `stripePaymentIntentId` | string | no | |
| `stripeSubscriptionId` | string | no | |
| `planId` | ObjectId | no | Ref: SubscriptionPlans (snapshot) |
| `planSlug` | string | no | Denormalized for display |
| `amountCents` | int | yes | Positive charge; negative for refund/credit |
| `currency` | string | yes | "usd" |
| `status` | string | yes | "pending" \| "paid" \| "failed" \| "refunded" \| "void" |
| `periodStart` | Date | no | Billing period |
| `periodEnd` | Date | no | |
| `usageSnapshot` | object | no | At time of record: postsCount, socialAccountsCount, etc. |
| `metadata` | object | no | Arbitrary (bounded keys) |
| `createdAt` | Date | yes | Immutable |
| `updatedAt` | Date | yes | |

### Relationships

- **BillingRecords → Organizations:** N:1.
- **BillingRecords → SubscriptionPlans:** N:1 via `planId` (historical snapshot).

### Indexes

```javascript
// Org billing history
{ "organizationId": 1, "createdAt": -1 }
{ "organizationId": 1, "type": 1, "createdAt": -1 }

// Stripe idempotency / webhooks
{ "stripeInvoiceId": 1 }, { sparse: true }
{ "stripePaymentIntentId": 1 }, { sparse: true }
```

### Validation Rules

- `type`: enum as above.
- `status`: enum as above.
- `amountCents`: integer (can be negative for credits/refunds).
- `currency`: length 3.

### Scalability

- **Volume:** Grows with billing events (invoices, usage). Append-only; no updates except status (e.g. paid/failed).
- **Sharding:** `organizationId` as shard key.
- **Retention:** Keep for compliance (e.g. 7 years); archive to cold storage if needed. No TTL on main collection.
- **Idempotency:** Use `stripeInvoiceId` / `stripePaymentIntentId` to dedupe webhook processing.

---

## Cross-Collection Reference Summary

| From          | To                | Field(s)           | Cardinality |
|---------------|-------------------|--------------------|-------------|
| Memberships   | Users             | userId             | N:1         |
| Memberships   | Organizations     | organizationId     | N:1         |
| Organizations | SubscriptionPlans | planId             | N:1         |
| SocialAccounts| Organizations     | organizationId     | N:1         |
| Posts         | Organizations     | organizationId     | N:1         |
| Posts         | Users             | createdBy          | N:1         |
| Posts         | SocialAccounts    | socialAccountIds[] | N:M         |
| Queues        | Organizations     | organizationId     | N:1         |
| Queues        | SocialAccounts    | socialAccountId     | 1:1         |
| Schedules     | Organizations     | organizationId     | N:1         |
| Schedules     | Posts             | postId             | N:1         |
| Schedules     | SocialAccounts    | socialAccountId     | N:1         |
| Analytics     | Organizations     | organizationId     | N:1         |
| Analytics     | Posts             | postId             | N:1         |
| Analytics     | SocialAccounts    | socialAccountId     | N:1         |
| BillingRecords| Organizations     | organizationId     | N:1         |
| BillingRecords| SubscriptionPlans | planId             | N:1         |

---

## Sharding Strategy (at millions of users)

- **Shard key choice:** Use `organizationId` for all tenant-scoped collections: **SocialAccounts, Posts, Queues, Schedules, Analytics, BillingRecords, Memberships.** This keeps all data for one org on the same shard (locality) and distributes load by org.
- **Users:** Can remain unsharded or shard by `_id` (hashed) if you need to distribute user doc reads. Avoid sharding by `email` if you need range queries on it.
- **SubscriptionPlans:** Do not shard (small, read-heavy, cacheable).
- **Scheduler:** The scan query `{ status: 1, scheduledAt: 1 }` with `scheduledAt <= now` is scatter-gather across shards if you shard by `organizationId`. That is acceptable if the scan runs every 1–2 minutes and only fetches a batch of due post IDs; then load full posts by `_id` (which can be on any shard). Alternatively, keep **Posts** sharded by `organizationId` and run the scan per shard, or use a small "due posts" cache populated by the scan.

---

## Optional: MongoDB JSON Schema (server-side)

You can add schema validation at the collection level for critical invariants (e.g. required fields, enums). Example for **Users**:

```javascript
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "status", "role", "createdAt", "updatedAt"],
      properties: {
        email: { bsonType: "string", maxLength: 255 },
        status: { enum: ["active", "suspended", "deleted"] },
        role: { enum: ["user", "admin", "support"] }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
```

Use sparingly; keep complex rules (references, business logic) in the application.

---

## Document History

| Version | Date   | Changes |
|---------|--------|---------|
| 1.0     | Feb 26 | Initial schema design for 9 collections + Memberships |
