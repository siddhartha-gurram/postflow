# PostFlow — Product & Technical Architecture

**Document version:** 1.0  
**Author:** CTO / Product Architecture  
**Last updated:** February 2026

---

## 1. Core Modules

PostFlow is decomposed into the following core modules. Each module owns a bounded context and can evolve toward a microservice if needed.

| Module | Purpose | Key Responsibilities |
|--------|---------|----------------------|
| **Identity & Access (IAM)** | Users, auth, orgs, teams | Registration, login, SSO, org/workspace management, invitations, RBAC |
| **Connections** | Social account linking | OAuth flows, token storage/refresh, account metadata, connection health |
| **Content** | Posts and media | Create/edit posts, media upload, drafts, content library, templates |
| **Scheduling & Queue** | When and where to publish | Calendar, queue rules, time slots, timezone handling, optimal-time logic |
| **Publishing** | Execution of posts | Job queue, API calls to platforms, retries, status sync, webhooks |
| **Analytics & Reporting** | Performance and usage | Post performance, account metrics, exports, dashboards |
| **Billing & Entitlements** | Monetization and limits | Plans, usage metering, feature flags, upgrade/downgrade |
| **Notifications & Inbox** | User communication | In-app notifications, email digests, platform mentions (optional) |
| **Admin & Platform** | Internal operations | Tenant management, feature toggles, audit logs, support tools |

---

## 2. Major Features (by Module)

### 2.1 Identity & Access
- Email/password signup and login
- Social login (Google, Apple)
- Organization/workspace creation and switching
- Team members: invite by email, assign roles
- Password reset, email verification
- (Advanced) SSO / SAML / SCIM for enterprises

### 2.2 Connections
- Connect: Facebook (Pages), Instagram (Business/Creator), X/Twitter, LinkedIn (Pages/Profile), Pinterest, TikTok (Business), YouTube (Channel)
- Per-connection: display name, avatar, connection status
- Disconnect / reconnect with token refresh
- Connection health checks and expiry warnings
- (Advanced) Multi-location / multi-page management per platform

### 2.3 Content
- **Compose:** Rich editor (text, emoji, hashtags, mentions), character counts per network, link preview
- **Media:** Image/video upload, crop, multi-image carousels where supported
- **Variants:** Different copy per network (e.g. short for X, long for LinkedIn)
- **Drafts:** Save and resume; version history (advanced)
- **Library:** Reusable media assets, saved captions, hashtag sets
- **Templates:** Pre-defined post templates (advanced)
- **AI assist (advanced):** Suggest copy, hashtags, optimal length per platform

### 2.4 Scheduling & Queue
- **Calendar view:** Month/week/day; drag-and-drop; bulk select
- **Queue:** Default queue per connection with rules (e.g. 3 posts/week, time slots)
- **Best time:** Suggested send times from analytics (advanced)
- **Recurring posts (advanced):** Weekly/monthly repeats
- **Timezone:** User/workspace timezone; per-connection timezone override
- **Scheduling limits:** Enforced by plan (posts per month, queue size)

### 2.5 Publishing
- **Publish now** or **schedule** for a specific time
- **Queue drain:** Publish next queued item when slot is free
- **Status:** Scheduled → Queued → Publishing → Published / Failed
- **Retries:** Configurable retries with backoff for transient API errors
- **Platform webhooks:** Incoming events (e.g. Instagram comments) for future inbox/analytics
- **Audit:** Immutable log of every publish attempt (id, time, platform, result)

### 2.6 Analytics & Reporting
- **Post-level:** Impressions, engagement, clicks (where API allows)
- **Account-level:** Follower growth, aggregate engagement
- **Reports:** Date range, export CSV/PDF (advanced)
- **Dashboards:** Overview widgets, top posts, comparison (advanced)
- **Limitation:** Metrics depend on each platform’s API and rate limits

### 2.7 Billing & Entitlements
- **Plans:** Free, Pro, Business, Enterprise (names TBD)
- **Meters:** Connected accounts, scheduled posts per month, team members, workspaces
- **Feature flags:** Per-plan feature access (e.g. analytics, AI, SSO)
- **Stripe (or equivalent):** Subscriptions, invoices, usage-based add-ons
- **Lifecycle:** Trial, upgrade, downgrade, cancel; grace period and data retention

### 2.8 Notifications & Inbox
- In-app notification center (scheduled post published, failed publish, connection expired)
- Email: digest (daily/weekly), immediate for failures and security
- (Advanced) Unified inbox: view/reply to comments from supported platforms

### 2.9 Admin & Platform
- Super-admin: list tenants, impersonate, feature flags
- Audit logs: auth, connection changes, billing events
- Support: view user’s connections and recent posts (with consent)
- Health: dependency status, queue depth, error rates

---

## 3. User Roles

| Role | Scope | Capabilities |
|------|--------|--------------|
| **Owner** | Organization | Full control: billing, delete org, manage all members and roles, all content and connections |
| **Admin** | Organization | Manage members and roles, connections, content, queue; no billing or delete org |
| **Member** | Organization | Create/edit/delete own posts, schedule, view analytics; cannot manage team or connections |
| **Viewer** (optional) | Organization | Read-only: calendar, analytics, content; no edits |
| **Super Admin** | Platform | Internal only; tenant management, feature flags, support tools |

**Invitation flow:** Owner/Admin invites by email → invitee accepts → assigned role. Pending invites revocable.

---

## 4. MVP vs Advanced Features

### 4.1 MVP (Phase 1–2)

**Must have for launch:**
- **IAM:** Signup/login (email + optional Google), single workspace per user, no teams yet (or single “owner” only)
- **Connections:** 2–3 networks for MVP (e.g. **X/Twitter**, **LinkedIn**, **Facebook Page**) — OAuth, store tokens, refresh, show status
- **Content:** Single composer; one post, multiple networks; image upload; character count per network; drafts
- **Scheduling:** Calendar (month/week), pick date/time, schedule; simple queue (e.g. “next available slot”)
- **Publishing:** Schedule + publish-now; background worker; retries; status (scheduled/published/failed)
- **Billing:** One paid plan + free tier; Stripe subscription; enforce “connected accounts” and “posts per month”
- **Notifications:** Email for failed publish and token expiry; minimal in-app toasts
- **Analytics:** Optional MVP: basic “published count” and “failed count”; full metrics in Phase 2

**Out of MVP:** Teams/roles, SSO, AI, recurring posts, best-time, full analytics, multi-workspace, Pinterest/TikTok/YouTube, inbox/reply.

### 4.2 Advanced (Post-MVP)

- **IAM:** Teams, roles (Admin/Member/Viewer), SSO/SAML, SCIM, multiple workspaces
- **Connections:** Instagram, Pinterest, TikTok, YouTube; multi-page; connection health dashboard
- **Content:** Variants per network, library, templates, version history, AI suggestions
- **Scheduling:** Best time, recurring posts, queue rules, per-connection timezone
- **Publishing:** Webhooks from platforms, richer audit and retry policies
- **Analytics:** Full dashboards, post/account metrics, exports, reports
- **Billing:** Multiple plans, usage-based, trials, enterprise contracts
- **Notifications:** Digest emails, in-app center, optional unified inbox
- **Admin:** Full tenant and feature-flag tooling, audit logs, support views

---

## 5. Proposed Architecture (Node.js + Express + MongoDB + React + AWS)

### 5.1 High-Level Stack

| Layer | Technology | Notes |
|-------|------------|--------|
| **Frontend** | React 18+ | SPA; React Query, React Router; optional state (Zustand/Redux) |
| **API** | Node.js 20 LTS + Express | REST-first; OpenAPI spec; optional GraphQL later for complex UIs |
| **Database** | MongoDB Atlas | Primary store: users, orgs, connections, posts, schedules, audit |
| **Cache** | Redis (ElastiCache) | Sessions, rate limiting, job locks, optional API response cache |
| **Queue** | AWS SQS or BullMQ (Redis) | Publish jobs, webhooks, emails; prefer one queue system for MVP |
| **Background workers** | Node.js (same repo or separate) | Consume queue: publish posts, refresh tokens, send emails |
| **File storage** | AWS S3 | Media uploads (images/video); presigned URLs for upload/download |
| **CDN** | CloudFront | Static assets and optionally S3 media |
| **Auth** | JWT (access + refresh) or session in Redis | Stateless API; refresh rotation |
| **Hosting** | **API/workers:** ECS Fargate or Elastic Beanstalk; **Frontend:** S3 + CloudFront or Vercel | Prefer container (ECS) for control |
| **Secrets** | AWS Secrets Manager or Parameter Store | API keys, OAuth client secrets, Stripe keys |
| **Monitoring** | CloudWatch + optional (Datadog/Sentry) | Logs, metrics, alerts, error tracking |

### 5.2 Monolith-First (Recommended for MVP)

- **Single codebase:** `api` (Express), `workers` (queue consumers), `web` (React).
- **Single MongoDB:** Multiple collections (users, organizations, connections, posts, schedules, jobs, audit_logs, etc.).
- **Single Redis:** Sessions, rate limit, and if using BullMQ, queue backend.
- **Clear module boundaries:** Same as §1; folders by domain (auth, connections, content, scheduling, publishing, billing, notifications).
- **Benefits:** Simpler deploy, one DB, easier transactions, fewer network hops. Scale vertically and with background workers; split later if needed.

### 5.3 Key Design Decisions

- **REST API:** Resource-oriented; versioned (`/v1/...`). Pagination (cursor or offset), consistent error format (code, message, details).
- **Idempotency:** Publish and billing actions accept idempotency keys to avoid duplicates.
- **Idempotent jobs:** Publish job keyed by `postId + scheduledTime`; dedupe in worker.
- **Connections:** Encrypt tokens at rest (e.g. AWS KMS or app-level with key in Secrets Manager). Store minimal platform metadata (id, username, avatar URL).
- **Multi-tenancy:** All queries scoped by `organizationId` (and `userId` where relevant). Indexes on `organizationId`, `userId`, `scheduledAt`, `status`.
- **Idempotent scheduling:** Creating a “scheduled post” writes to DB and enqueues a job with `scheduledAt`; worker runs at or after that time and checks post still “scheduled” before calling platform API.

---

## 6. Microservice Breakdown (When to Split)

Start as a **modular monolith**. Consider extracting services when:

- A team owns a domain and needs independent deploy/release.
- A part has very different scaling (e.g. workers 10x API nodes).
- A part needs a different runtime or stack.
- Regulatory or security requires isolation (e.g. billing/payment in separate boundary).

### 6.1 Candidate Services (Post-MVP)

| Service | Trigger | Responsibility | Data |
|---------|---------|----------------|------|
| **Publishing Service** | High volume, retries, platform-specific logic | Dequeue jobs, call platform APIs, write status/audit | Own copy of “publish events”; reads post/connection from API or events |
| **Analytics Service** | Heavy reads, aggregations, different SLAs | Ingest platform webhooks/metrics, compute aggregates, serve reports | Own DB or read replica; metrics, snapshots |
| **Billing Service** | Compliance, payment isolation | Stripe integration, usage ingestion, invoices, plan checks | Billing DB; minimal PII |
| **Notification Service** | Many channels, templates, deliverability | In-app, email, push; templates and batching | Can use existing DB for “notifications” or own store |
| **Connections Service** | Token security, OAuth complexity | OAuth flows, token refresh, connection health | Encrypted token store; connection metadata |

### 6.2 Integration Between Services

- **Sync:** REST from frontend/API to each service (e.g. “schedule post” → API writes DB and pushes to Publishing via queue).
- **Async:** SQS/SNS or internal queue: “Post published” → event to Analytics and Notifications.
- **Data:** Each service owns its data; no shared DB. Duplicate only what’s needed (e.g. post id, org id, user id on events); avoid distributed transactions; use eventual consistency and idempotent handlers.

---

## 7. Third-Party Integrations

### 7.1 Social Platforms (OAuth + Publish APIs)

| Platform | OAuth | Publish API | Notes |
|----------|--------|-------------|--------|
| **X (Twitter)** | OAuth 2.0 PKCE | Twitter API v2 (Posts) | Strict rate limits; need approved developer access for production |
| **LinkedIn** | OAuth 2.0 | Share API, UGC Post API | Pages vs personal; different products |
| **Facebook** | OAuth 2.0 | Graph API (Page posts) | Pages required for business; Instagram via Facebook Graph |
| **Instagram** | Via Facebook | Graph API (Content Publishing) | Business/Creator accounts; often through Facebook Page connection |
| **Pinterest** | OAuth 2.0 | Pins API | Pins creation, boards |
| **TikTok** | OAuth 2.0 | Content Posting API | Business accounts; review process |
| **YouTube** | OAuth 2.0 | Data API v3 | Upload to channel; different flow (upload vs “post”) |

**Common needs:** Official SDKs or well-maintained libraries; token refresh before expiry; webhook subscriptions where offered (e.g. Instagram, Facebook) for comments and metrics.

### 7.2 Infrastructure & Services

| Provider | Use |
|----------|-----|
| **AWS** | Compute (ECS/EB), S3, SQS, Secrets Manager, CloudWatch, (optional) ElastiCache |
| **MongoDB Atlas** | Managed MongoDB; backups, indexes |
| **Redis** | Upstash or ElastiCache for cache and BullMQ |
| **Stripe** | Subscriptions, usage billing, invoices, customer portal |
| **SendGrid / AWS SES** | Transactional and digest emails |
| **Sentry** (or similar) | Error tracking and performance |
| **Vercel / AWS** | React build and host (S3+CloudFront or Vercel) |

### 7.3 Auth & Identity (Optional)

- **Google / Apple:** Social login (e.g. Passport.js or NextAuth-style flows).
- **Enterprise:** Auth0, Okta, or Cognito for SSO/SAML/SCIM when needed.

---

## 8. Phased Development Roadmap

### Phase 1: Foundation (Weeks 1–6)

- **IAM:** User model, signup/login (email + Google), JWT or session, org/workspace (single per user).
- **Project setup:** Monorepo (api, web, workers), ESLint/Prettier, env and secrets, CI (build + test).
- **DB:** MongoDB schema for users, organizations, connections, posts, schedules; indexes.
- **Connections (MVP):** 1–2 platforms (e.g. X + LinkedIn); OAuth flow, token store/refresh, “Connected accounts” UI.
- **Content:** Post model and API (create, update, delete, list); media upload to S3; simple composer UI (text + image, character count).
- **Scheduling:** Schedule at datetime; store in DB; queue job for that time (BullMQ or SQS).
- **Publishing:** Worker: dequeue, load post + connection, call platform API, update status; retries; “Publish now” path.
- **Frontend:** App shell, auth pages, dashboard, connect accounts, compose, calendar (read + schedule).
- **Billing:** Stripe product/price, free vs paid plan; enforce limits (connections, posts/month) in API.

**Exit criteria:** User can sign up, connect X and LinkedIn, create a post with image, schedule it, and see it published (or failed with clear status).

---

### Phase 2: Polish & First Growth (Weeks 7–12)

- **Connections:** Add Facebook Page (+ optional Instagram); connection health and reconnect flows.
- **Content:** Drafts, “copy per network” variants, media library (list/select).
- **Queue:** Simple queue (e.g. “next available slot” per connection); queue settings UI.
- **Analytics:** Fetch and store basic metrics from platform APIs where available; “Published” and “Failed” counts; simple dashboard.
- **Notifications:** Email (SendGrid/SES) for failed publish and token expiry; in-app toasts.
- **Billing:** Usage metering (posts/month), Stripe customer portal, upgrade/downgrade.
- **Admin:** Basic super-admin (list users/orgs, feature flag for “beta” features).
- **Reliability:** Rate limiting, health endpoints, basic monitoring and alerts.

**Exit criteria:** Three platforms, queue, basic analytics, billing, and emails; stable for first paying users.

---

### Phase 3: Teams & Scale (Weeks 13–20)

- **IAM:** Teams; roles (Owner, Admin, Member); invitations and accept flow.
- **Multi-connection:** Multiple accounts per platform per org; connection management UI.
- **Scheduling:** Calendar improvements; timezone handling; queue rules (e.g. N posts per week).
- **Content:** Templates, hashtag sets, improved library.
- **Publishing:** Better retries, audit log for support; optional webhooks from platforms.
- **Analytics:** Richer metrics, date range, export CSV.
- **Infra:** Caching (Redis), read replicas if needed, worker scaling.

**Exit criteria:** Teams can collaborate with roles; product is “Buffer-like” for core flows.

---

### Phase 4: Advanced Features (Weeks 21–30+)

- **Connections:** Pinterest, TikTok, YouTube; multi-page and health dashboard.
- **Scheduling:** Best time suggestions, recurring posts.
- **Content:** AI suggestions (copy/hashtags); version history.
- **Analytics:** Dashboards, reports, PDF export.
- **Notifications:** Digest emails, in-app notification center; optional unified inbox (read/reply).
- **Billing:** Multiple tiers, trials, usage-based add-ons; enterprise (contracts, SSO).
- **Admin:** Full tenant tooling, audit logs, support view.
- **Optional:** Evaluate microservices (Publishing, Analytics, Billing) if team size and scale justify.

**Exit criteria:** Feature set and architecture ready for mid-market and enterprise.

---

## Summary

- **Modules:** IAM, Connections, Content, Scheduling, Queue, Publishing, Analytics, Billing, Notifications, Admin.
- **MVP:** 2–3 networks, compose + schedule + queue + publish, Stripe, basic notifications; monolith (Node/Express/MongoDB/React) on AWS.
- **Roles:** Owner, Admin, Member, (Viewer), Super Admin.
- **Scale path:** Modular monolith → extract Publishing, Analytics, Billing, Notifications, Connections only when needed.
- **Integrations:** Platform OAuth + publish APIs (X, LinkedIn, Facebook, etc.), Stripe, AWS, email, monitoring.
- **Roadmap:** Phase 1 (foundation + 2 networks + publish), Phase 2 (third network + queue + analytics + billing), Phase 3 (teams + scale), Phase 4 (advanced features and optional microservices).

This gives you a single source of truth to align product, engineering, and stakeholders and to start implementation in the next step.
