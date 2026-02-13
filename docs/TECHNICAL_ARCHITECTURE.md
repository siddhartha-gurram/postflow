# PostFlow — Technical Architecture

**Document version:** 1.0  
**Stack:** Node.js (Express) · React (Vite) · MongoDB · Redis + BullMQ · JWT + OAuth · AWS  
**Focus:** Production-ready structure, schemas, scheduler, queue publishing, and rate limits.

---

## Table of Contents

1. [Backend Folder Structure](#1-backend-folder-structure)
2. [Frontend Folder Structure](#2-frontend-folder-structure)
3. [Database Schema (MongoDB)](#3-database-schema-mongodb)
4. [Scheduler Architecture](#4-scheduler-architecture)
5. [Queue-Based Publishing System](#5-queue-based-publishing-system)
6. [Post Flow: Creation → Queue → Publish → Analytics](#6-post-flow-creation--queue--publish--analytics)
7. [Rate Limit Handling for Social APIs](#7-rate-limit-handling-for-social-apis)

---

## 1. Backend Folder Structure

```
backend/
├── src/
│   ├── app.js                    # Express app (no listen)
│   ├── server.js                 # Entry: load env, connect DB/Redis, start app + workers
│   ├── config/
│   │   ├── index.js              # Config loader (env, validation)
│   │   ├── database.js           # MongoDB connection
│   │   ├── redis.js              # Redis client (cache + Bull)
│   │   ├── queue.js              # BullMQ queue/worker definitions
│   │   └── platforms/            # Per-platform API config (base URLs, scopes, limits)
│   │       ├── index.js
│   │       ├── twitter.js
│   │       ├── linkedin.js
│   │       ├── facebook.js
│   │       └── instagram.js
│   ├── middleware/
│   │   ├── auth.js               # JWT verify, attach user/org
│   │   ├── rbac.js               # Role check (owner, admin, member)
│   │   ├── validate.js           # Request validation (e.g. Joi/express-validator)
│   │   ├── rateLimit.js         # API rate limit (express-rate-limit + Redis store)
│   │   ├── errorHandler.js      # Central error handler (4-arg middleware)
│   │   └── idempotency.js       # Idempotency key for publish/schedule
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.validation.js
│   │   │   ├── strategies/       # Passport: local, google, facebook, linkedin, twitter
│   │   │   │   ├── index.js
│   │   │   │   ├── local.strategy.js
│   │   │   │   └── oauth.strategies.js
│   │   │   └── auth.utils.js     # JWT sign/verify, refresh
│   │   ├── users/
│   │   │   ├── user.model.js
│   │   │   ├── user.service.js
│   │   │   ├── user.controller.js
│   │   │   └── user.routes.js
│   │   ├── organizations/
│   │   │   ├── organization.model.js
│   │   │   ├── organization.service.js
│   │   │   ├── organization.controller.js
│   │   │   ├── organization.routes.js
│   │   │   └── membership.model.js   # Org membership + role
│   │   ├── connections/
│   │   │   ├── connection.model.js
│   │   │   ├── connection.service.js   # OAuth, token refresh, encrypt/decrypt
│   │   │   ├── connection.controller.js
│   │   │   ├── connection.routes.js
│   │   │   └── oauth/                 # Platform-specific OAuth handlers
│   │   │       ├── twitter.oauth.js
│   │   │       ├── linkedin.oauth.js
│   │   │       ├── facebook.oauth.js
│   │   │       └── instagram.oauth.js
│   │   ├── content/
│   │   │   ├── post.model.js
│   │   │   ├── media.model.js
│   │   │   ├── content.service.js
│   │   │   ├── content.controller.js
│   │   │   └── content.routes.js
│   │   ├── scheduling/
│   │   │   ├── schedule.model.js      # Optional if embedded in Post
│   │   │   ├── queueRule.model.js     # Per-connection queue rules
│   │   │   ├── scheduling.service.js  # Enqueue job at scheduledAt
│   │   │   ├── scheduling.controller.js
│   │   │   └── scheduling.routes.js
│   │   ├── publishing/
│   │   │   ├── publish.service.js      # Orchestration: get post, call platform
│   │   │   ├── publish.controller.js  # Trigger "publish now" (enqueue)
│   │   │   ├── publish.routes.js
│   │   │   ├── publishers/             # One per platform
│   │   │   │   ├── index.js
│   │   │   │   ├── twitter.publisher.js
│   │   │   │   ├── linkedin.publisher.js
│   │   │   │   ├── facebook.publisher.js
│   │   │   │   └── instagram.publisher.js
│   │   │   ├── rateLimitStore.js       # Per-platform rate state (Redis)
│   │   │   └── auditLog.model.js       # Publish attempt log
│   │   ├── analytics/
│   │   │   ├── analytics.service.js    # Fetch from platform APIs, aggregate
│   │   │   ├── analytics.controller.js
│   │   │   ├── analytics.routes.js
│   │   │   └── metrics.model.js        # Cached post/account metrics
│   │   ├── billing/
│   │   │   ├── billing.service.js      # Stripe, usage, limits
│   │   │   ├── billing.controller.js
│   │   │   └── billing.routes.js
│   │   ├── notifications/
│   │   │   ├── notification.model.js
│   │   │   ├── notification.service.js
│   │   │   └── channels/
│   │   │       ├── email.channel.js
│   │   │       └── inApp.channel.js
│   │   └── admin/
│   │       ├── admin.controller.js
│   │       └── admin.routes.js
│   ├── jobs/                       # BullMQ job processors (workers)
│   │   ├── index.js                # Start all workers
│   │   ├── publish.job.js           # Process publish job
│   │   ├── tokenRefresh.job.js      # Refresh connection tokens
│   │   ├── analyticsSync.job.js     # Periodic fetch metrics
│   │   └── scheduledScan.job.js     # Optional: cron to enqueue due posts
│   ├── queues/
│   │   ├── index.js                # Queue definitions (BullMQ)
│   │   ├── publish.queue.js
│   │   ├── tokenRefresh.queue.js
│   │   ├── analyticsSync.queue.js
│   │   └── scheduledScan.queue.js
│   ├── utils/
│   │   ├── logger.js               # Structured logger (pino/winston)
│   │   ├── errors.js               # AppError classes, error codes
│   │   ├── encryption.js           # Token encryption (KMS or AES)
│   │   └── idempotency.js          # Redis idempotency key check
│   └── lib/
│       ├── platformClient.js       # Base HTTP client + retry/backoff
│       └── rateLimitHandler.js     # Parse platform rate headers, wait
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── scripts/
│   ├── migrate.js
│   └── seed.js
├── .env.example
├── package.json
└── Dockerfile
```

**Design principles:**

- **Module-per-domain:** Each domain (auth, users, organizations, connections, content, scheduling, publishing, analytics, billing, notifications, admin) has `model`, `service`, `controller`, `routes`. Dependencies flow: routes → controller → service → model / queue.
- **Shared config and middleware:** Centralized in `config/` and `middleware/`. Platform-specific API config (URLs, scopes, rate limits) lives under `config/platforms/`.
- **Workers separate from HTTP:** Job processors live in `jobs/`; queue definitions in `queues/`. `server.js` can start API and workers in the same process (MVP) or separate processes (production).
- **Production:** Use `config` validation (e.g. `joi`), structured logging, central error handler, and middleware for auth, RBAC, rate limit, and idempotency.

---

## 2. Frontend Folder Structure

**Choice: Vite + React** for a fast SPA with clear separation; API calls to a separate backend. Next.js alternative is noted at the end.

```
frontend/
├── public/
│   └── favicon.ico
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css                    # Global styles, CSS variables
│   ├── config/
│   │   ├── env.js                   # VITE_API_URL, etc.
│   │   └── constants.js
│   ├── api/                         # Backend API client
│   │   ├── client.js                # Axios/fetch instance (base URL, auth header, interceptors)
│   │   ├── auth.api.js
│   │   ├── connections.api.js
│   │   ├── posts.api.js
│   │   ├── scheduling.api.js
│   │   ├── analytics.api.js
│   │   └── billing.api.js
│   ├── store/                       # Global state (Zustand or Redux)
│   │   ├── index.js
│   │   ├── authStore.js
│   │   ├── orgStore.js
│   │   └── uiStore.js
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useOrg.js
│   │   ├── usePagination.js
│   │   └── useDebounce.js
│   ├── routes/
│   │   ├── index.jsx                # React Router config
│   │   ├── ProtectedRoute.jsx
│   │   ├── PublicRoute.jsx
│   │   └── layouts/
│   │       ├── AppLayout.jsx        # Sidebar + header + outlet
│   │       ├── AuthLayout.jsx       # Centered card for login/signup
│   │       └── OnboardingLayout.jsx
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── SignupPage.jsx
│   │   │   ├── ForgotPasswordPage.jsx
│   │   │   └── OAuthCallbackPage.jsx
│   │   ├── dashboard/
│   │   │   └── DashboardPage.jsx
│   │   ├── connections/
│   │   │   └── ConnectionsPage.jsx
│   │   ├── compose/
│   │   │   ├── ComposePage.jsx
│   │   │   └── ComposeEditor.jsx
│   │   ├── calendar/
│   │   │   └── CalendarPage.jsx
│   │   ├── queue/
│   │   │   └── QueuePage.jsx
│   │   ├── analytics/
│   │   │   └── AnalyticsPage.jsx
│   │   ├── settings/
│   │   │   ├── SettingsPage.jsx
│   │   │   ├── ProfileSettings.jsx
│   │   │   └── BillingSettings.jsx
│   │   └── NotFoundPage.jsx
│   ├── components/
│   │   ├── ui/                      # Primitives (design system)
│   │   │   ├── Button.jsx
│   │   │   ├── Input.jsx
│   │   │   ├── Modal.jsx
│   │   │   ├── Spinner.jsx
│   │   │   ├── Toast.jsx
│   │   │   └── index.js
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Header.jsx
│   │   │   └── OrgSwitcher.jsx
│   │   ├── connections/
│   │   │   ├── ConnectionCard.jsx
│   │   │   └── ConnectButton.jsx
│   │   ├── compose/
│   │   │   ├── Composer.jsx
│   │   │   ├── MediaUpload.jsx
│   │   │   ├── NetworkSelector.jsx
│   │   │   └── CharacterCount.jsx
│   │   ├── calendar/
│   │   │   ├── Calendar.jsx
│   │   │   ├── CalendarEvent.jsx
│   │   │   └── ScheduleModal.jsx
│   │   ├── queue/
│   │   │   ├── QueueList.jsx
│   │   │   └── QueueSlot.jsx
│   │   └── analytics/
│   │       ├── MetricsCard.jsx
│   │       └── SimpleChart.jsx
│   ├── utils/
│   │   ├── formatDate.js
│   │   ├── formatNumber.js
│   │   └── storage.js               # localStorage wrapper (tokens)
│   └── types/                       # JSDoc or PropTypes
│       └── index.js
├── index.html
├── vite.config.js
├── package.json
└── Dockerfile                       # Build static → serve via nginx or S3+CloudFront
```

**Production notes:**

- **API client:** Single axios instance; attach `Authorization: Bearer <accessToken>`; 401 → refresh token or redirect to login; retry with backoff for 5xx.
- **Auth:** Store access token in memory or short-lived cookie; refresh in httpOnly cookie or secure storage; clear on logout.
- **Env:** `VITE_*` only for non-secret config (API URL); no secrets in frontend.
- **Next.js alternative:** Use `app/` (App Router) or `pages/`; put API client in `lib/` or `services/`; same feature-based page/component structure; use Next auth or custom JWT in cookies for SSR if needed.

---

## 3. Database Schema (MongoDB)

All IDs are `ObjectId` unless noted. Indexes are listed with each collection; compound indexes support org-scoped queries and time-based scans.

---

### 3.1 `users`

```javascript
{
  _id: ObjectId,
  email: String,           // unique, lowercase
  passwordHash: String,    // null if only OAuth
  name: String,
  avatarUrl: String,
  emailVerified: Boolean,
  role: String,            // 'user' (platform-level; org role in memberships)
  lastLoginAt: Date,
  createdAt: Date,
  updatedAt: Date
}
// Indexes: { email: 1 } unique, { updatedAt: 1 }
```

---

### 3.2 `organizations`

```javascript
{
  _id: ObjectId,
  name: String,
  slug: String,            // unique, URL-safe
  logoUrl: String,
  timezone: String,       // IANA e.g. 'America/New_York'
  planId: String,         // 'free' | 'pro' | 'business'
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  createdAt: Date,
  updatedAt: Date
}
// Indexes: { slug: 1 } unique, { updatedAt: 1 }
```

---

### 3.3 `memberships` (user ↔ organization, role)

```javascript
{
  _id: ObjectId,
  userId: ObjectId,        // ref: users
  organizationId: ObjectId, // ref: organizations
  role: String,           // 'owner' | 'admin' | 'member' | 'viewer'
  invitedBy: ObjectId,
  invitedAt: Date,
  joinedAt: Date,         // null until accepted
  createdAt: Date,
  updatedAt: Date
}
// Indexes:
// { userId: 1, organizationId: 1 } unique
// { organizationId: 1, role: 1 }
// { userId: 1 }
```

---

### 3.4 `connections` (linked social accounts)

```javascript
{
  _id: ObjectId,
  organizationId: ObjectId,
  platform: String,       // 'twitter' | 'linkedin' | 'facebook' | 'instagram' | ...
  platformUserId: String,
  platformUsername: String,
  displayName: String,
  avatarUrl: String,
  // Encrypted at rest; decrypt in service layer
  accessToken: String,
  refreshToken: String,
  tokenExpiresAt: Date,
  // Optional platform-specific (e.g. Facebook Page ID, Instagram Business Account ID)
  platformMetadata: {
    pageId: String,
    pageAccessToken: String,  // encrypted if different from connection
    instagramBusinessAccountId: String
  },
  status: String,         // 'active' | 'expired' | 'revoked' | 'error'
  lastErrorAt: Date,
  lastErrorCode: String,
  lastRefreshedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
// Indexes:
// { organizationId: 1, platform: 1, platformUserId: 1 } unique
// { organizationId: 1, status: 1 }
// { tokenExpiresAt: 1 }  // for refresh job
```

---

### 3.5 `posts`

```javascript
{
  _id: ObjectId,
  organizationId: ObjectId,
  createdBy: ObjectId,    // user
  status: String,        // 'draft' | 'scheduled' | 'queued' | 'publishing' | 'published' | 'failed'
  // Content: global or per-network variants
  content: {
    text: String,
    linkUrl: String,
    linkTitle: String,
    linkDescription: String,
    linkImageUrl: String
  },
  variants: [             // optional; override per connection
    {
      connectionId: ObjectId,
      text: String,
      linkUrl: String
    }
  ],
  media: [
    {
      type: String,       // 'image' | 'video'
      url: String,        // S3 or CDN URL
      key: String,        // S3 key
      width: Number,
      height: Number,
      duration: Number    // video seconds
    }
  ],
  scheduledAt: Date,      // when to publish (null for draft / queue-next)
  timezone: String,       // override for this post (default org timezone)
  connectionIds: [ ObjectId ],  // which connections to publish to
  queuePosition: Number,  // for queue order when using queue (optional)
  publishedAt: Date,     // set when status → published
  failureReason: String,  // when status = failed
  failureCode: String,
  idempotencyKey: String, // optional, for dedupe
  createdAt: Date,
  updatedAt: Date
}
// Indexes:
// { organizationId: 1, status: 1, scheduledAt: 1 }
// { organizationId: 1, createdBy: 1, createdAt: -1 }
// { scheduledAt: 1 } where status in ('scheduled','queued')  // for scheduler scan
// { idempotencyKey: 1 } unique, sparse
```

---

### 3.6 `publishResults` (per-connection result of a publish)

Stored when a post is published to multiple connections; one doc per (post, connection).

```javascript
{
  _id: ObjectId,
  postId: ObjectId,
  connectionId: ObjectId,
  organizationId: ObjectId,
  status: String,         // 'published' | 'failed'
  platformPostId: String, // id on Twitter/LinkedIn/etc.
  platformPostUrl: String,
  publishedAt: Date,
  errorCode: String,
  errorMessage: String,
  retryCount: Number,
  createdAt: Date
}
// Indexes:
// { postId: 1, connectionId: 1 } unique
// { organizationId: 1, publishedAt: -1 }
// { connectionId: 1, publishedAt: -1 }
```

---

### 3.7 `publishAuditLog` (immutable history of every attempt)

```javascript
{
  _id: ObjectId,
  postId: ObjectId,
  connectionId: ObjectId,
  organizationId: ObjectId,
  action: String,        // 'publish_attempt' | 'publish_success' | 'publish_failed'
  statusCode: Number,     // HTTP from platform
  requestPayload: Object, // redacted if needed (no tokens)
  responsePayload: Object,
  errorMessage: String,
  jobId: String,          // Bull job id
  attemptedAt: Date,
  createdAt: Date
}
// Indexes: { postId: 1, attemptedAt: -1 }, { organizationId: 1, attemptedAt: -1 }
// TTL or archive policy for retention (e.g. 90 days)
```

---

### 3.8 `queueRules` (per-connection queue config)

```javascript
{
  _id: ObjectId,
  organizationId: ObjectId,
  connectionId: ObjectId,
  enabled: Boolean,
  timeSlots: [            // e.g. 9am, 2pm, 6pm
    { hour: Number, minute: Number }
  ],
  daysOfWeek: [ Number ], // 0-6
  maxPostsPerDay: Number,
  timezone: String,
  createdAt: Date,
  updatedAt: Date
}
// Indexes: { connectionId: 1 } unique, { organizationId: 1 }
```

---

### 3.9 `postMetrics` (cached analytics per post per connection)

```javascript
{
  _id: ObjectId,
  postId: ObjectId,
  connectionId: ObjectId,
  organizationId: ObjectId,
  platformPostId: String,
  metrics: {
    impressions: Number,
    likes: Number,
    comments: Number,
    shares: Number,
    clicks: Number,
    engagement: Number
  },
  fetchedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
// Indexes:
// { postId: 1, connectionId: 1 } unique
// { organizationId: 1, fetchedAt: -1 }
```

---

### 3.10 `notifications`

```javascript
{
  _id: ObjectId,
  organizationId: ObjectId,
  userId: ObjectId,      // recipient
  type: String,          // 'publish_failed' | 'token_expired' | 'post_published'
  title: String,
  body: String,
  data: Object,          // { postId, connectionId, ... }
  read: Boolean,
  readAt: Date,
  createdAt: Date
}
// Indexes: { userId: 1, read: 1, createdAt: -1 }, { organizationId: 1 }
```

---

### 3.11 `refreshTokens` (for JWT refresh)

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  tokenHash: String,     // hash of refresh token
  deviceInfo: String,
  expiresAt: Date,
  revokedAt: Date,
  createdAt: Date
}
// Indexes: { tokenHash: 1 }, { userId: 1 }, { expiresAt: 1 } TTL
```

---

### 3.12 `idempotencyKeys` (optional; or use Redis only)

```javascript
{
  _id: String,           // idempotency key
  organizationId: ObjectId,
  responseStatus: Number,
  responseBody: Object,
  expiresAt: Date,
  createdAt: Date
}
// Index: { _id: 1 } unique, TTL on expiresAt
```

---

## 4. Scheduler Architecture

Two complementary mechanisms: **scheduled jobs** (BullMQ delayed jobs) and an optional **scheduled scan** (cron-style) for resilience.

### 4.1 Primary: Delayed BullMQ Job per Post

When a post is **scheduled** (or added to queue with a specific time):

1. **API** writes the post with `status: 'scheduled'` and `scheduledAt: <timestamp>`.
2. **Scheduling service** adds a job to the **publish queue** with `delay = scheduledAt - now` (capped to Bull’s max delay or use a repeat pattern—see below).
3. **Worker** runs at or after `scheduledAt`, loads the post, verifies `status` is still `scheduled` (or `queued`), then runs publish logic.

**BullMQ delay limits:** Redis-based delay is limited (e.g. ~2^31 ms). For very long delays (e.g. months), either:

- Use **repeatable job** with cron expression (e.g. every minute) that finds “due” posts and enqueues them, or  
- Use a **scheduled scan** (below) and only enqueue when within a window (e.g. next 24 hours).

### 4.2 Optional: Scheduled Scan (Cron) for Due Posts

A **repeatable** BullMQ job or system cron runs every 1–5 minutes:

1. Query MongoDB: `status IN ('scheduled','queued') AND scheduledAt <= now + buffer` (e.g. buffer = 1 minute).
2. For each due post, add a **publish job** with no delay (or delay 0).
3. Optionally set `status` to `queued` when enqueueing to avoid double-enqueue (with unique jobId).

This covers:

- Restarts (no in-memory delayed jobs lost).
- Clock skew.
- Jobs that were never added (e.g. bug fix).

### 4.3 Queue-Based “Next Slot” Scheduling

For “add to queue” (no fixed time):

1. **Queue rule** for the connection defines time slots (e.g. 9:00, 14:00, 18:00) and days.
2. **Scheduling service** computes the **next available** slot from now (in connection timezone), sets `post.scheduledAt = nextSlot`, then either:
   - Adds a **delayed** publish job for `nextSlot`, or  
   - Relies on **scheduled scan** to pick it up when `scheduledAt <= now`.

### 4.4 Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SCHEDULER ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User schedules post at 2026-02-15 14:00 UTC                            │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐     ┌──────────────────────────────────────────┐  │
│  │ Scheduling      │     │ BullMQ: publish queue                     │  │
│  │ Service         │────▶│ Job: { postId, scheduledAt }              │  │
│  │                 │     │ delay = scheduledAt - now (or 0 if scan)  │  │
│  └─────────────────┘     └──────────────────────────────────────────┘  │
│           │                                    │                         │
│           │                                    │  At scheduled time      │
│           ▼                                    ▼                         │
│  ┌─────────────────┐     ┌──────────────────────────────────────────┐  │
│  │ MongoDB         │     │ Publish Worker                            │  │
│  │ post.scheduledAt│◀────│ 1. Get job postId                         │  │
│  │ post.status     │     │ 2. Check rate limit (Redis)               │  │
│  └─────────────────┘     │ 3. Load post + connections                 │  │
│                          │ 4. Call platform APIs                      │  │
│                          │ 5. Update post + publishResults + audit    │  │
│                          └──────────────────────────────────────────┘  │
│                                                                         │
│  Optional: Cron / Repeatable job every 1–5 min                          │
│  ┌─────────────────┐     Query: status in (scheduled,queued)            │
│  │ Scheduled Scan  │     AND scheduledAt <= now + 1min                 │
│  │ Job             │────▶ Enqueue publish job (jobId = postId+scheduledAt)
│  └─────────────────┘     Prevents missed jobs after restart            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Timezone Handling

- **Organization** has `timezone` (IANA).
- **Post** can override with `timezone`; otherwise use org.
- **Queue rules** have `timezone` per connection.
- All **scheduledAt** stored in **UTC** in DB. Convert from user’s chosen local time (e.g. “Feb 15, 2026 2:00 PM EST”) to UTC before saving and when enqueueing.

---

## 5. Queue-Based Publishing System

### 5.1 Queues (BullMQ + Redis)

| Queue name         | Concurrency | Purpose                          | Job data example                    |
|--------------------|------------|-----------------------------------|-------------------------------------|
| `publish`           | 5–10       | Publish a post to its connections | `{ postId, scheduledAt, idempotencyKey? }` |
| `tokenRefresh`      | 2          | Refresh connection tokens         | `{ connectionId }`                  |
| `analyticsSync`     | 1–2        | Fetch metrics for posts/accounts  | `{ organizationId }` or `{ postId }` |
| `scheduledScan`     | 1          | Find due posts and enqueue        | `{}`                               |
| `notifications`     | 3          | Send email / in-app               | `{ type, userId, payload }`         |

### 5.2 Publish Job Lifecycle

1. **Enqueue:**  
   - **Schedule:** API creates post with `scheduledAt`; scheduling service adds job with `delay` or scan adds job when due.  
   - **Publish now:** API sets `scheduledAt = now`, adds job with `delay: 0`.  
   - **JobId:** `publish:${postId}:${scheduledAt.getTime()}` to avoid duplicate jobs for same post/time.

2. **Worker (publish.job.js):**  
   - Receive job `{ postId, scheduledAt, idempotencyKey? }`.  
   - **Idempotency:** If `idempotencyKey` present, check Redis (or DB); if already processed, return stored response and skip.  
   - **Load post:** Fetch post by `postId`; if not found or status not in `['scheduled','queued','publishing']`, mark job complete (or failed if already published/failed).  
   - **Load connections:** Resolve `connectionIds`; filter by `status === 'active'`; decrypt tokens.  
   - **Rate limit:** For each connection (or per platform), check Redis rate limit state; if over limit, re-queue job with delay (backoff).  
   - **Publish:** For each connection, call the right **publisher** (Twitter, LinkedIn, etc.).  
   - **Persist:** Update `post.status` to `published` or `failed`, set `publishedAt` / `failureReason`; write `publishResults` and `publishAuditLog`.  
   - **Notifications:** Enqueue notification job on failure (and optionally on success).  
   - **Analytics:** Enqueue `analyticsSync` for this post (or org) after a delay (e.g. 1 hour) so platform has metrics.

3. **Retries:**  
   - BullMQ: `attempts: 3`, `backoff: { type: 'exponential', delay: 60000 }`.  
   - On platform 429/5xx, re-throw so Bull retries; on 4xx (except 429) do not retry.  
   - Optionally move to a “dead letter” queue after max attempts for manual review.

### 5.3 Idempotency

- **Publish now / schedule** requests can send `Idempotency-Key: <key>`.  
- Key format: e.g. `org_<orgId>_<random>` or `org_<orgId>_<clientId>`.  
- Store in Redis: `idempotency:<key>` → `{ statusCode, body }` with TTL (e.g. 24h).  
- First request: process and store response. Subsequent same key: return stored response and do not run publish again.

### 5.4 Flow Summary

```
Client                API                    Scheduling Svc       BullMQ Publish Queue    Publish Worker
  │                     │                            │                        │                    │
  │  POST /posts        │                            │                        │                    │
  │  (schedule / now)   │                            │                        │                    │
  │────────────────────▶│                            │                        │                    │
  │                     │  save post                 │                        │                    │
  │                     │  status=scheduled          │                        │                    │
  │                     │  scheduledAt=...           │                        │                    │
  │                     │────────────────────────────▶                        │                    │
  │                     │                            │  add job (delay)       │                    │
  │                     │                            │────────────────────────▶                    │
  │                     │                            │                        │  when due          │
  │                     │                            │                        │───────────────────▶
  │                     │                            │                        │                    │  process
  │                     │                            │                        │                    │  (rate limit,
  │                     │                            │                            │  call APIs,
  │                     │                            │                        │                    │  update DB)
  │ 200                 │                            │                        │                    │
  │◀────────────────────│                            │                        │                    │
```

---

## 6. Post Flow: Creation → Queue → Publish → Analytics

End-to-end flow with status transitions and side effects.

### 6.1 State Diagram (Post)

```
                    ┌─────────┐
                    │  draft  │
                    └────┬────┘
                         │ schedule or add to queue
                         ▼
                    ┌──────────┐     optional: assign next slot
                    │scheduled │◀─────────────────────────────── queue rules
                    └────┬─────┘
                         │ worker picks up (at scheduledAt)
                         ▼
                    ┌──────────┐
                    │ queued   │  (optional; can go scheduled → publishing)
                    └────┬─────┘
                         │ worker starts
                         ▼
                    ┌────────────┐
                    │ publishing │
                    └──────┬─────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │published │   │  failed  │   │(partial) │  some connections ok, some failed
      └──────────┘   └──────────┘   │published │  → post status = published; failures in publishResults
                                    └──────────┘
```

### 6.2 Step-by-Step Flow

| Step | Actor | Action | DB / Side effects |
|------|--------|--------|--------------------|
| 1 | User | Creates post (content, media, connectionIds), chooses “Schedule at 15 Feb 2pm” or “Add to queue” | — |
| 2 | Frontend | POST `/v1/posts` with body + `scheduledAt` or `queue: true` | — |
| 3 | API | Validate org limits (plan), connectionIds belong to org | — |
| 4 | Content/Scheduling service | If `queue: true`, compute next slot from queue rules; set `scheduledAt`. Insert `posts` doc: `status: 'scheduled'`, `scheduledAt`, `connectionIds` | `posts` inserted |
| 5 | Scheduling service | Add BullMQ job to `publish` queue with `delay = scheduledAt - now` (or 0 for “now”), `jobId = publish:postId:ts` | Redis (Bull) |
| 6 | API | Return 201 + post | — |
| 7 | (At scheduled time) | BullMQ runs publish job | — |
| 8 | Publish worker | Load post; verify status in (`scheduled`,`queued`); load connections; check rate limit (Redis); for each connection call platform API | — |
| 9 | Publisher (e.g. Twitter) | POST to platform; handle 429 (rate limit) → re-queue with delay | — |
| 10 | Publish worker | On success: update `post.status = 'published'`, `publishedAt`; insert `publishResults` per connection; insert `publishAuditLog`. On failure: `post.status = 'failed'`, `failureReason`; audit; enqueue notification | `posts`, `publishResults`, `publishAuditLog`, `notifications` queue |
| 11 | (Later) | Analytics sync job runs (triggered by cron or after publish delay) | — |
| 12 | Analytics worker | For post (or org), call platform APIs (e.g. Twitter metrics, LinkedIn analytics); upsert `postMetrics` | `postMetrics` |

### 6.3 Sequence Diagram

```
User          Frontend       API           MongoDB        Scheduling Svc    Publish Queue    Publish Worker    Platform API
 │                │            │                │                │                │                │                │
 │  Compose       │            │                │                │                │                │                │
 │  Schedule      │            │                │                │                │                │                │
 │────────────────▶            │                │                │                │                │                │
 │                │  POST      │                │                │                │                │                │
 │                │  /posts    │                │                │                │                │                │
 │                │────────────▶                │                │                │                │                │
 │                │            │  insert post  │                │                │                │                │
 │                │            │  (scheduled)  │                │                │                │                │
 │                │            │───────────────▶                │                │                │                │
 │                │            │                │  add job       │                │                │                │
 │                │            │────────────────────────────────▶                │                │                │
 │                │            │                │                │  enqueue       │                │                │
 │                │            │                │                │  (delay)       │                │                │
 │                │            │                │                │───────────────▶                │                │
 │                │  201       │                │                │                │  process      │                │
 │                │◀────────────                │                │                │  (at time)    │                │
 │                │            │                │                │                │───────────────▶                │
 │                │            │                │                │                │                │  POST /2/tweets
 │                │            │                │                │                │                │───────────────▶
 │                │            │                │                │                │                │  201
 │                │            │                │  update post   │                │                │◀───────────────
 │                │            │                │  publishResults                │                │
 │                │            │                │◀────────────────────────────────────────────────│                │
 │                │            │                │                │  analyticsSync │                │                │
 │                │            │                │                │  (delayed job)  │                │                │
 │                │            │                │                │                │  ─────────────▶ (later)         │
 │                │            │                │  postMetrics   │                │                │  fetch metrics  │
 │                │            │                │◀─────────────────────────────────────────────────────────────────
```

---

## 7. Rate Limit Handling for Social APIs

Platforms return rate limit info in headers (e.g. `x-rate-limit-remaining`, `x-rate-limit-reset`). We centralize handling so publishers stay within limits and back off when needed.

### 7.1 Per-Platform Rate State (Redis)

Store **per connection** (or per platform app, depending on how limits apply):

- **Key:** `ratelimit:connection:<connectionId>` or `ratelimit:platform:<platform>:<appId>`  
- **Value (hash or JSON):**  
  - `remaining` (number)  
  - `limit` (number)  
  - `resetAt` (Unix timestamp or ISO string)  
- **TTL:** Set to `resetAt` so key expires when the window resets.

On every **response** from the platform:

1. Parse headers (e.g. `x-rate-limit-remaining`, `x-rate-limit-limit`, `x-rate-limit-reset`).
2. Update Redis with new remaining/limit/reset.
3. If `remaining === 0` (or &lt; threshold), **do not** enqueue more publish jobs for that connection until `resetAt`; existing job should re-queue with delay `resetAt - now`.

### 7.2 In-Request Handling (429)

When the platform returns **429 Too Many Requests**:

1. Read `Retry-After` header (seconds) or `x-rate-limit-reset` (timestamp).
2. **Do not** mark the job as failed; **re-throw** a custom error (e.g. `RateLimitError`) with `retryAfter` (seconds).
3. BullMQ job can catch this and use `job.moveToDelayed(Date.now() + retryAfter * 1000)` to run again later, or use a custom backoff in the worker that re-queues with delay.
4. Update Redis rate state from 429 response if headers are present.

### 7.3 Proactive Throttling (Before Calling API)

Before the worker calls the platform:

1. Get from Redis: `remaining`, `resetAt` for that connection.
2. If `remaining <= 0` and `resetAt > now`, **delay** the job: `moveToDelayed(resetAt)` or re-queue with delay `resetAt - now`, then return (job will run again later).
3. If `remaining > 0`, proceed; after the call, update Redis from response headers.

This avoids unnecessary 429s and keeps traffic within limits.

### 7.4 Platform-Specific Headers (Reference)

| Platform   | Limit remaining      | Limit total   | Reset                    |
|-----------|-----------------------|---------------|---------------------------|
| Twitter v2 | `x-rate-limit-remaining` | `x-rate-limit-limit` | `x-rate-limit-reset` (Unix) |
| LinkedIn  | (in body or headers)   | —             | —                         |
| Facebook  | (in body)              | —             | —                         |

Implementation should live in `lib/rateLimitHandler.js` and `config/platforms/*.js` (header names per platform). Use a **token bucket** or **sliding window** in Redis only if the platform does not send reset time; otherwise “remaining + resetAt” is enough.

### 7.5 Worker Concurrency and Global Limits

- **Publish queue concurrency:** Limit to 5–10 so you don’t blast one platform with many parallel requests. Optionally use **BullMQ rate limiter** (e.g. max N jobs per minute per queue).
- **Per-connection serialization:** For a given `connectionId`, process one publish at a time (use a **child queue** or **job option** “connectionId” and limit concurrency per connection in the worker with a lock in Redis) to avoid racing on the same connection’s rate limit.

### 7.6 Summary

- **Store** rate state in Redis per connection (or per app) from response headers.
- **Before** calling API: check remaining; if 0, delay job until reset.
- **On 429:** Use `Retry-After` or `x-rate-limit-reset` to re-queue with delay; do not fail job immediately.
- **Update** Redis after every successful and 429 response.
- **Limit** concurrency and optionally serialize per connection to avoid thundering herd.

---

## Document History

| Version | Date       | Changes |
|---------|------------|--------|
| 1.0     | Feb 2026   | Initial technical architecture |
