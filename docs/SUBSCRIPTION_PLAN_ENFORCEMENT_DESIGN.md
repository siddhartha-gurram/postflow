# PostFlow — Subscription & Plan Enforcement Design

**Version:** 1.0  
**Focus:** Production-ready design for plans (Free, Pro, Team), limit enforcement, usage tracking, grace period, and upgrade/downgrade.

---

## 1. Plans & Limits

### 1.1 Plan Definitions

| Plan   | Max social accounts | Max scheduled posts per account | Max posts per month | Max team members |
|--------|----------------------|----------------------------------|----------------------|------------------|
| **Free**  | 1  | 5  | 10  | 1  |
| **Pro**   | 5  | 50 | 100 | 1  |
| **Team**  | 10 | 100| 500 | 5  |

- **Max social accounts:** Total connected SocialAccounts per organization.
- **Max scheduled posts per account:** QueueSlots (or Posts) with status `scheduled`/`queued` per SocialAccount (future only). Alternatively: total queued items per account at any time.
- **Max posts per month:** Published + scheduled posts that will publish in the current calendar month (UTC or org timezone). Or: count of posts that **publish** in the billing month (recommended for billing alignment).
- **Max team members:** Memberships with `joinedAt` non-null (accepted invites) per organization.

Unlimited: use `-1` in config. All limits are inclusive (e.g. “max 5” = allow 5).

### 1.2 SubscriptionPlans Collection (catalog)

Existing schema; extend for PostFlow plans. Stored as reference; cache in app/Redis.

| Field | Example (Free) | Example (Pro) | Example (Team) |
|-------|----------------|---------------|----------------|
| slug  | free           | pro           | team           |
| limits.socialAccounts | 1  | 5  | 10 |
| limits.scheduledPostsPerAccount | 5  | 50  | 100 |
| limits.postsPerMonth | 10 | 100 | 500 |
| limits.teamMembers   | 1  | 1   | 5  |
| stripePriceId        | null | price_xxx | price_yyy |

---

## 2. Mongo Subscription Schema (org’s current subscription)

One **active** subscription document per organization. Tracks current plan, billing period, status, and grace.

### 2.1 Collection: `subscriptions`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations; **unique** (one active subscription per org) |
| `planId` | ObjectId | yes | Ref: SubscriptionPlans |
| `planSlug` | string | yes | Denormalized: "free" \| "pro" \| "team" (for fast checks without join) |
| **Status & billing** | | | |
| `status` | string | yes | `active` \| `past_due` \| `canceled` \| `trialing` \| `incomplete` \| `grace` |
| `currentPeriodStart` | Date | yes | Start of current billing period (UTC) |
| `currentPeriodEnd` | Date | yes | End of current billing period (UTC) |
| `cancelAtPeriodEnd` | boolean | no | If true, subscription ends at currentPeriodEnd; no renewal |
| `canceledAt` | Date | no | When user canceled (for analytics) |
| **Stripe** | | | |
| `stripeCustomerId` | string | no | |
| `stripeSubscriptionId` | string | no | |
| **Grace period** | | | |
| `gracePeriodEndsAt` | Date | no | When grace ends (UTC). If status = grace, enforce limits but allow access until this time. |
| **Audit** | | | |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

**Indexes:**

- `{ organizationId: 1 }` unique  
- `{ status: 1 }`  
- `{ stripeSubscriptionId: 1 }` sparse  
- `{ currentPeriodEnd: 1 }` (for cron: find expiring / grace)

**Status semantics:**

- **active:** Normal; all limits apply.  
- **trialing:** Same as active for limits; billing not charged until trial end.  
- **past_due:** Payment failed; allow access for a short time (or treat like grace).  
- **grace:** Subscription ended (e.g. payment failed, cancel at period end); access until `gracePeriodEndsAt`. After that, treat as no subscription (block or restrict).  
- **canceled:** No longer active; no grace or period end in future.  
- **incomplete:** First payment not completed (e.g. checkout abandoned).

### 2.2 Default subscription for new orgs

On **Organization** create:

- Create a **Subscription** with `planId` = Free plan, `planSlug` = `"free"`, `status` = `active`, `currentPeriodStart` = now, `currentPeriodEnd` = far future (or monthly for free tier if you want to reset “posts per month” on a cycle).  
- Or: no row until first upgrade; **resolve plan at read time**: if no subscription, treat as Free (hardcode Free limits in code or from SubscriptionPlans where slug = free).

Recommendation: **create a subscription row for every org** (Free by default) so all code paths read from one place.

---

## 3. Usage Tracking Strategy

### 3.1 What to count (and where)

| Limit | Source of truth | How to compute |
|-------|-----------------|----------------|
| **Social accounts** | SocialAccount | `countDocuments({ organizationId, status: 'active' })` (or include expired if you count them). |
| **Scheduled posts per account** | QueueSlot (or Post) | Per account: `countDocuments({ socialAccountId, status: 'scheduled', scheduledAt: { $gt: now } })`. Or: Post with status scheduled/queued and that account in socialAccountIds. |
| **Posts per month** | Post (or PublishResult) | Count posts that **publish** in the current month: e.g. `publishedAt` in [monthStart, monthEnd] for the org, or QueueSlots with status scheduled + scheduledAt in month (future) plus already published in month. Definition: “posts that will or did publish this calendar month” (UTC or org timezone). |
| **Team members** | Membership | `countDocuments({ organizationId, joinedAt: { $ne: null } })`. |

### 3.2 When to compute (no real-time meter collection)

- **On demand:** At the point of enforcement (connect, add-to-queue, publish-now), call a **usage service** that runs the above queries (or reads from a cache, see below).  
- **No separate “usage” collection required** for these limits if you can afford the count queries (indexed, org-scoped). For very high scale, add a **usage snapshot** (see §3.3).

### 3.3 Optional: Usage snapshot (cache) collection

To avoid repeated counts on hot paths, maintain a **current usage** document per org, updated on relevant events.

**Collection: `usageSnapshots`** (or `organizationUsage`)

| Field | Type | Description |
|-------|------|-------------|
| organizationId | ObjectId | Unique |
| socialAccountsCount | int | Current active SocialAccounts |
| postsPublishedThisMonth | int | Reset at period start or calendar month |
| monthStart | Date | Start of the month this count applies to |
| scheduledPerAccount | object | Map socialAccountId (string) → count of scheduled items |
| teamMembersCount | int | Accepted memberships |
| updatedAt | Date | Last recompute or event update |

Update on: new/removed SocialAccount, post scheduled/published/canceled, membership accepted/removed. Optionally recompute periodically (e.g. nightly) to correct drift.  
**Enforcement:** Prefer reading from this snapshot when present and fresh (e.g. updatedAt within last 5 min); otherwise fall back to live count.

### 3.4 Recommendation

- **MVP / mid-scale:** No usage collection; **compute on demand** in a single **entitlements/usage service** with indexed queries.  
- **Scale:** Introduce **usageSnapshots** and event-driven (or periodic) updates; enforcement reads snapshot first.

---

## 4. Entitlements Service (single place for limits)

One module owns “can this org do X?” and “what are the limits?”.

### 4.1 Responsibilities

- **getPlanForOrganization(organizationId):** Return current plan (from Subscription + SubscriptionPlans or default Free).  
- **getLimits(organizationId):** Return limits object (socialAccounts, scheduledPostsPerAccount, postsPerMonth, teamMembers) for that plan.  
- **getUsage(organizationId):** Return current usage (counts). Optionally (organizationId, socialAccountId) for per-account scheduled count.  
- **checkLimit(organizationId, limitKey, [currentCount], [increment]):** Return { allowed: boolean, limit, current, message }.  
- **isSubscriptionActive(organizationId):** true if subscription exists and status is active, trialing, or grace and (if grace) now &lt; gracePeriodEndsAt.

### 4.2 Where it lives

- **Module:** `billing` or `entitlements` (e.g. `modules/billing/` or `modules/entitlements/`).  
- **Files:** `entitlements.service.js` (or `planEnforcement.service.js`), `subscription.model.js`, `usage.service.js` (if snapshot-based).  
- **Dependencies:** Subscription model, SubscriptionPlans (cached), SocialAccount, QueueSlot/Post, Membership. No dependency from connections/scheduling/publishing into Stripe; they only call the entitlements service.

---

## 5. Where Checks Happen

### 5.1 Connect (add social account)

- **When:** Before completing OAuth callback (or before redirecting to OAuth).  
- **Check:** `socialAccountsCount < limit.socialAccounts`.  
- **Where:** In **connections** flow: after validating state, before creating/upserting SocialAccount. Call `entitlements.checkLimit(organizationId, 'socialAccounts', currentCount)`; if !allowed, redirect to frontend with `?error=limit_social_accounts` and do not save the new account.  
- **Grace / expired:** If subscription is in grace or expired, apply same limit (no new accounts if at cap). Optionally allow up to previous plan’s limit during grace.

### 5.2 Add to queue

- **When:** Before creating QueueSlots and setting post.scheduledAt.  
- **Checks:**  
  1. **Posts per month:** `(postsPublishedThisMonth + postsScheduledThisMonth + 1) <= limit.postsPerMonth`. Count: published this month + scheduled (scheduledAt or QueueSlot.scheduledAt) in current month.  
  2. **Scheduled per account:** For each target account, `scheduledCountForAccount + 1 <= limit.scheduledPostsPerAccount`.  
- **Where:** In **scheduling** module (slot allocator or “add to queue” endpoint). Call entitlements with organizationId and, per account, current scheduled count; if any check fails, return 403 with clear message (e.g. `LIMIT_POSTS_PER_MONTH`, `LIMIT_SCHEDULED_PER_ACCOUNT`).  
- **Grace:** Same limits; if over limit, block.

### 5.3 Publish now

- **When:** Before enqueueing the publish job (or before creating QueueSlot if “publish now” creates a slot at “now”).  
- **Checks:** Same as add-to-queue for the **current month** and **per-account** scheduled count: publishing one more post must not exceed postsPerMonth or scheduledPostsPerAccount (if you count “publish now” as consuming a slot).  
- **Where:** In **publishing** module (e.g. `POST /publish/:postId` or the service that enqueues the job). Call entitlements; if !allowed, return 403.  
- **Note:** “Publish now” may or may not count toward “scheduled” depending on product: either count it as one post in the month (recommended) or only count scheduled/queued items. Design: **count it as one post in the month** so Free can’t bypass by only using “publish now.”

### 5.4 Invite team member (Team plan)

- **When:** Before creating or sending an invite (if you count invites) or before accepting (if you count on accept).  
- **Check:** `teamMembersCount < limit.teamMembers`.  
- **Where:** In **organizations** or **memberships** module. Call `entitlements.checkLimit(organizationId, 'teamMembers', currentCount)`.  
- **Grace:** Apply same limit.

### 5.5 Summary table

| Action | Limits checked | Where |
|--------|----------------|-------|
| Connect (OAuth callback) | socialAccounts | connections.service (before upsert SocialAccount) |
| Add to queue | postsPerMonth, scheduledPostsPerAccount | scheduling/slotAllocator or add-to-queue route |
| Publish now | postsPerMonth, scheduledPostsPerAccount | publishing service or publish route |
| Invite / accept member | teamMembers | organizations or memberships service |

---

## 6. Middleware for Plan Enforcement

### 6.1 Option A: Route-level middleware (recommended)

- **Middleware:** `requirePlanLimit(limitKey)` (e.g. `requirePlanLimit('socialAccounts')`).  
- **Behavior:** Resolve organizationId from req (auth middleware already set `req.organizationId` or from query/body). Call entitlements.getUsage + getLimits; if usage >= limit for that key, call `next(new PlanLimitError(limitKey))` and do not proceed. Otherwise next().  
- **Use:** Attach to routes that perform the action (e.g. `GET /connections/connect/:providerId` → no check here; check in **callback** after state load so you have organizationId. So better: **service-level check** in connection.service.handleCallback and in slotAllocator, publish service).  
- **Recommendation:** Prefer **service-level** checks inside the module that performs the action (connections, scheduling, publishing, organizations), and keep middleware for **optional** “require active subscription” (e.g. block entire app for expired orgs).

### 6.2 Option B: Service-level only (recommended)

- No generic “plan” middleware on routes.  
- Each flow (connect, add-to-queue, publish-now, invite) calls **entitlements.checkLimit(...)** (or getLimits + getUsage and compare) inside its **service**.  
- **Middleware:** One lightweight middleware `requireActiveSubscription`: if subscription is canceled and not in grace (or grace ended), set 402/403 and redirect to billing page. Use on all authenticated org routes except billing portal and public pages.

### 6.3 Middleware list (concrete)

| Middleware | When | Action |
|------------|------|--------|
| `requireAuth` | Already present | Sets req.user, req.organizationId. |
| `requireActiveSubscription` | After requireAuth, on org-scoped routes | Load subscription; if status not in (active, trialing, grace) or (grace and now > gracePeriodEndsAt), return 402 Payment Required and link to billing. |
| (No generic requirePlanLimit middleware) | — | Limits enforced in services. |

---

## 7. Grace Period for Expired Subscriptions

### 7.1 When grace applies

- **Cancel at period end:** At currentPeriodEnd, set status to `grace`, set `gracePeriodEndsAt` = currentPeriodEnd + N days (e.g. 7).  
- **Payment failure (past_due):** After Stripe retries, if still unpaid, set status to `grace`, `gracePeriodEndsAt` = now + N days.  
- **Trial end without payment:** Same idea.

### 7.2 During grace

- **Access:** Org can still use the product (connect, queue, publish) **subject to the same limits** (or optionally “previous plan” limits).  
- **Enforcement:** `isSubscriptionActive()` returns true if status = grace and now &lt; gracePeriodEndsAt. Limits are still enforced; do not allow exceeding the (current or downgraded) plan.  
- **UI:** Banner: “Your subscription has ended. Renew by [gracePeriodEndsAt] to avoid losing access.”

### 7.3 After grace

- When now >= gracePeriodEndsAt, treat as no active subscription: `requireActiveSubscription` returns 402.  
- **Data:** Do not delete SocialAccounts or Posts; only block new actions and optionally hide content until resubscribe.  
- **Downgrade path:** On resubscribe, same org and data; plan and limits apply to the new plan.

---

## 8. Upgrade / Downgrade Behavior

### 8.1 Upgrade (Free → Pro, Pro → Team)

- **When:** User selects a higher plan (Stripe checkout or “change plan”).  
- **Immediate:** Create or update Subscription: new planId/planSlug, status active, new currentPeriodStart/End (Stripe-driven or prorated).  
- **Limits:** New limits apply immediately. No need to remove existing data; only enforce on **new** actions (e.g. can now add more accounts up to new cap).  
- **Billing:** Stripe handles proration; webhook updates Subscription.

### 8.2 Downgrade (e.g. Team → Pro, Pro → Free)

- **When:** User selects a lower plan or cancels (cancel at period end).  
- **Option A – At period end:** Set cancelAtPeriodEnd = true; at currentPeriodEnd, set status = grace, then after grace set plan to Free (or new plan) and new period. Existing data (accounts, posts, members) **remain**; **enforcement** uses new limits. So if they have 8 accounts and move to Pro (5), they cannot **add** new accounts until they remove 3; optionally **block** all publish/queue until under limit (stricter).  
- **Option B – Immediate:** Switch plan and period immediately; same “keep data, enforce on new actions” or “block until under limit.”  
- **Recommendation:** **At period end** for downgrade; during current period they keep current plan. At period end: set status to grace (optional), then set to new plan (e.g. Free), new period. **Enforcement:** If usage > new limit (e.g. 8 accounts > 5), do not allow **new** connections or **new** scheduled posts until they remove accounts or scheduled posts. Optionally allow **publishing** of already-scheduled posts until queue is within limit (so no hard cut of in-flight posts).

### 8.3 Cancel (to Free or churn)

- Same as downgrade: at period end set to grace then to Free (or remove subscription). Data retained; access blocked after grace if no resubscribe.

---

## 9. Integration with Existing Modular Architecture

### 9.1 New / updated modules

| Module | Responsibility |
|--------|-----------------|
| **billing** (or **entitlements**) | Subscription model, SubscriptionPlans (read/cache), entitlements.service (getPlan, getLimits, getUsage, checkLimit, isSubscriptionActive). Optional: usageSnapshots, Stripe webhook handler that updates Subscription. |
| **connections** | In handleCallback (or before redirect to OAuth): call entitlements.checkLimit(organizationId, 'socialAccounts'). On fail, redirect with error. |
| **scheduling** | In allocateSlotForPost (or “add to queue” handler): call entitlements for postsPerMonth and scheduledPostsPerAccount; on fail, throw/return 403. |
| **publishing** | In “publish now” path: same checks as add-to-queue (postsPerMonth, scheduledPostsPerAccount). |
| **organizations** | In invite-member / accept-invite: call entitlements.checkLimit(organizationId, 'teamMembers'). |

### 9.2 Shared middleware

- **requireAuth** (existing): Resolves user and organizationId.  
- **requireActiveSubscription** (new): After requireAuth; calls entitlements.isSubscriptionActive(organizationId); if false, 402 and redirect to billing. Mount on API routes that require an active (or grace) subscription.

### 9.3 Folder layout (suggestion)

```
modules/
  billing/
    subscription.model.js      # Subscription (org’s current sub)
    subscriptionPlan.model.js  # SubscriptionPlans (or shared catalog)
    entitlements.service.js    # getPlan, getLimits, getUsage, checkLimit
    usage.service.js           # Optional: snapshot read/write
    billing.routes.js          # Stripe webhook, customer portal redirect
    billing.controller.js
  connections/   # existing; add entitlements check in service
  scheduling/    # existing; add entitlements check in slotAllocator or route
  publishing/    # existing; add entitlements check in publish flow
  organizations/ # existing; add entitlements check for invite
middleware/
  requireActiveSubscription.js
```

### 9.4 Flow summary

1. **Request** → requireAuth → requireActiveSubscription (if applicable).  
2. **Action** (connect / add-to-queue / publish-now / invite) → service calls **entitlements.checkLimit** for the relevant keys; if !allowed, return 403 with code (e.g. LIMIT_POSTS_PER_MONTH).  
3. **Entitlements** loads Subscription (and plan) for org, gets limits, gets usage (live or snapshot), returns allowed/not allowed.  
4. **Stripe webhooks** update Subscription (status, period, grace); optional cron to set status = grace at period end and gracePeriodEndsAt.

---

## 10. Error Responses (API)

- **402 Payment Required:** No active subscription (and not in grace). Body: `{ error: 'SUBSCRIPTION_INACTIVE', message: '...', billingUrl: '...' }`.  
- **403 Forbidden (limit):** Over limit. Body: `{ error: 'PLAN_LIMIT_EXCEEDED', limitKey: 'socialAccounts' | 'postsPerMonth' | 'scheduledPostsPerAccount' | 'teamMembers', limit: number, current: number, message: '...' }`.  
- **404:** Plan or subscription not found (treat as Free or 402 depending on product).

---

## 11. Subscription Document State Machine (summary)

```
[active] ── cancel at period end ──► [active with cancelAtPeriodEnd]
  │
  │ at currentPeriodEnd
  ▼
[grace] (gracePeriodEndsAt set)
  │
  │ at gracePeriodEndsAt
  ▼
effective: no subscription or [canceled] → require payment to resume

[trialing] ── trial end + payment ──► [active]
[past_due] ── payment success ──► [active]
[past_due] ── retries exhausted ──► [grace] then same as above
```

---

This design is production-ready and fits the existing PostFlow modular architecture; implement Subscription model, entitlements service, and the listed check points in connect, add-to-queue, publish-now, and invite flows.
