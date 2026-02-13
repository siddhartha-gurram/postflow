# PostFlow — Scheduling & Queue System Design (Buffer-like)

**Version:** 1.0  
**Focus:** Production-ready design for weekly recurring slots, add-to-queue, reorder, pause, skip, clear, and scheduler job enqueue.

---

## 1. Overview

- Each **SocialAccount** has a **weekly recurring schedule**: e.g. Monday 09:00 & 15:00, Wednesday 12:00, Friday 18:00 (in the account’s **timezone**).
- **“Add to Queue”** finds the **next available** slot in the future, assigns the post to that slot, and sets **post.scheduledAt** (UTC).
- If that slot is already filled, the system picks the **next** available slot.
- Users can **reorder** the queue, **pause** the queue, **skip** the next slot, and **clear** the queue.
- A **scheduler** runs periodically and **enqueues publish jobs** at the correct UTC time (one job per due slot/post).
- All slot times are defined in the account’s **timezone** and stored/compared in **UTC** in the DB and in job delays.

---

## 2. Core Concepts

| Concept | Description |
|--------|-------------|
| **AccountSchedule** | Per–social-account config: which days and local times form the recurring weekly slots, timezone, pause, skip-next. |
| **QueueSlot** | One “slot instance”: a specific UTC time for an account, optionally linked to a post. Represents “this post is scheduled at this time on this account.” |
| **Queue (logical)** | The ordered list of QueueSlots (and their posts) for one account in the future. Implemented as query + optional `position` for reorder. |
| **Add to Queue** | Allocate the next free slot (future only), create QueueSlot, set post.scheduledAt and post.status = scheduled. |
| **Pause** | AccountSchedule.paused = true → scheduler skips this account; “Add to Queue” can still allocate slots (optional: block while paused). |
| **Skip next** | Mark “do not use the next available slot for auto-assign”; next “Add to Queue” uses the slot after that. |
| **Reorder** | Change the order of queued posts (e.g. drag-and-drop); update slot times so order is preserved. |
| **Clear queue** | Unschedule all future posts for that account (cancel QueueSlots, set posts back to draft or a “cleared” state). |

---

## 3. Mongo Schemas

### 3.1 AccountSchedule (per SocialAccount)

Stores **day-specific** recurring slots (e.g. Monday: 09:00, 15:00; Wednesday: 12:00; Friday: 18:00) and queue controls.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | Ref: Organizations |
| `socialAccountId` | ObjectId | yes | Ref: SocialAccounts; **unique** (one schedule per account) |
| `name` | string | no | e.g. "Default Queue" |
| **Slots (day-specific)** | | | |
| `slotsByDay` | object | yes | Map dayOfWeek (0–6) → array of `{ hour, minute }`. Example: `{ "1": [{9,0},{15,0}], "3": [{12,0}], "5": [{18,0}] }` (Mon, Wed, Fri). Keys are string "0"…"6". |
| `timezone` | string | yes | IANA (e.g. America/New_York). All slot times are local to this zone. |
| **Queue behavior** | | | |
| `paused` | boolean | yes | If true, scheduler does not publish for this account; optional: “Add to Queue” can be disabled. Default false. |
| `pausedAt` | Date | no | When queue was paused (for UI). |
| `skipNextSlot` | boolean | no | If true, next “Add to Queue” allocates the slot *after* the next one. Reset after use or manually. Default false. |
| `maxPostsPerDay` | int | no | Hard cap per account per calendar day (local). Optional; default from plan. |
| `enabled` | boolean | yes | Schedule is on (can be disabled when account is disconnected). Default true. |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

**Alternative to `slotsByDay`:**  
Use an array of `{ dayOfWeek: number, hour: number, minute: number }` (e.g. `[{dayOfWeek:1,hour:9,minute:0}, {dayOfWeek:1,hour:15,minute:0}, ...]`). Same information; index by `socialAccountId` for “get schedule for account.”

**Indexes:**

- `{ socialAccountId: 1 }` unique  
- `{ organizationId: 1, enabled: 1 }`  
- `{ paused: 1 }` if scheduler filters by paused

---

### 3.2 QueueSlot (concrete slot instance)

One document per “post scheduled at this time on this account.” Represents both the slot and the assignment.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | ObjectId | yes | |
| `organizationId` | ObjectId | yes | |
| `socialAccountId` | ObjectId | yes | Ref: SocialAccounts |
| `scheduledAt` | Date | yes | **UTC**; when to publish |
| `timezone` | string | no | IANA (denormalized from AccountSchedule for display) |
| `postId` | ObjectId | yes | Ref: Posts. Null only for “placeholder” or “skip” slots if you model them. |
| `position` | int | no | Order in queue for this account (0-based). Used for reorder and “next slot” ordering. |
| `status` | string | yes | `scheduled` \| `publishing` \| `published` \| `failed` \| `canceled` |
| `publishedAt` | Date | no | Set when status → published |
| `createdAt` | Date | yes | |
| `updatedAt` | Date | yes | |

**Indexes:**

- `{ socialAccountId: 1, scheduledAt: 1 }` — list queue for account, scheduler “due” query  
- `{ socialAccountId: 1, status: 1, scheduledAt: 1 }` — due slots: status = scheduled, scheduledAt ≤ now  
- `{ postId: 1 }` sparse — find slot(s) for a post  
- `{ organizationId: 1, socialAccountId: 1, scheduledAt: 1 }` — calendar / admin  
- `{ status: 1, scheduledAt: 1 }` — global scheduler scan

**Design choice:**  
QueueSlot is the source of truth for “when does this post go out on this account?” So one post going to three accounts ⇒ three QueueSlots (and possibly three different `scheduledAt` times).

---

### 3.3 Post modifications

Posts stay the main content entity; queue state is reflected in QueueSlots and in a few fields on Post for convenience.

| Field | Usage in queue flow |
|-------|----------------------|
| `status` | `draft` → user editing. `scheduled` / `queued` → in queue; publish job will run at slot time. `publishing` \| `published` \| `failed` as today. |
| `scheduledAt` | **UTC**. For single-account or “first slot” UX: set to the (earliest) QueueSlot.scheduledAt when added to queue. Optional: for multi-account, post can store “earliest” or leave to QueueSlot-only. |
| `socialAccountIds` | Which accounts this post targets. Each (post, account) has a QueueSlot with its own scheduledAt. |
| `queuePosition` | Optional: denormalized “position” for one account’s view; can be derived from QueueSlot.position instead. |

No new collection; only ensure Post has `scheduledAt`, `status`, `socialAccountIds`, and optional `queuePosition` as in existing schema.

---

## 4. “Add to Queue” Flow

1. User selects a **post** (draft) and optionally **one or more SocialAccounts** (default: previously used or all).
2. For **each** selected account:
   - Load **AccountSchedule** (slotsByDay + timezone). If paused and product rule is “no add while paused”, return error.
   - Compute **next slot times** in the future (see §7 Timezone):
     - From “now” (or now + 1 minute buffer) in the account’s timezone.
     - Enumerate (dayOfWeek, hour, minute) from slotsByDay in order (e.g. next 7 days), convert each to UTC.
   - Exclude slots that are **already filled**: e.g. existing QueueSlot with same socialAccountId and same scheduledAt (or within 1-minute window) and status in `scheduled`, `publishing`.
   - If **skipNextSlot** is true, discard the very next available slot and take the one after.
   - Respect **maxPostsPerDay**: count QueueSlots (and maybe Posts) for that account in that **local calendar day**; if ≥ maxPostsPerDay, skip that slot and try the next day.
   - Pick the **first** remaining slot (UTC).
3. **Create QueueSlots**: one per (post, account) with that account’s chosen scheduledAt; set status = `scheduled`, postId = post._id, and set **position** to “end of queue” for that account (e.g. max(position)+1 or current count).
4. **Update Post**: set `socialAccountIds`, `status = 'scheduled'`, `scheduledAt` = earliest of the QueueSlot.scheduledAt values (for list/calendar UX). Optionally set `queuePosition` for a primary account.
5. Return the assigned slot times (and optionally update skipNextSlot = false if it was set).

**If a slot is already filled:**  
The “next slot” logic naturally skips it because filled slots are excluded when enumerating next available slots.

---

## 5. Reorder Queue

- **Scope:** One SocialAccount’s queue (future slots only).
- **Input:** Ordered list of postIds (or QueueSlot ids) in the new order.
- **Behavior:**
  - Load all QueueSlots for that account with status = `scheduled` and scheduledAt > now, ordered by current scheduledAt (or position).
  - Reassign **slot times** so that the new order matches the order of slots in the schedule:  
    First post → first upcoming slot time, second post → second upcoming slot time, etc.
  - Update each QueueSlot: set `scheduledAt` to the new UTC time and `position` to 0, 1, 2, …
  - Update each Post’s `scheduledAt` if you store it (e.g. to the earliest of its QueueSlots).
- **Concurrency:** Use optimistic locking (e.g. updatedAt) or a short lock per account to avoid races when two users reorder at once.

---

## 6. Pause Queue

- Set **AccountSchedule.paused = true** (and optionally pausedAt = now).
- **Scheduler:** When building “due” jobs, **exclude** accounts whose schedule has paused = true. No publish job is enqueued for that account until unpaused.
- **“Add to Queue”:** Product choice: (A) still allow adding to queue (slots get times, but nothing publishes until unpause), or (B) disallow and return an error. Design recommendation: allow (A) so the queue is visible and can be reordered; only publishing is blocked.

---

## 7. Skip Next Slot

- Set **AccountSchedule.skipNextSlot = true**.
- On **“Add to Queue”** for that account, when computing “next available slot,” treat the very next slot as unavailable (do not assign a post to it). Assign to the *following* slot. After assignment, set skipNextSlot = false (or leave true if “skip one per add”).
- **Optional:** Create a “placeholder” QueueSlot with postId = null and status = `skipped` so that slot is visibly skipped and not reused until the next week. Simpler: no placeholder; just skip that time when allocating.

---

## 8. Clear Queue

- **Scope:** One SocialAccount (or “all accounts” for a post).
- **Behavior:**
  - Find all QueueSlots for that account with status = `scheduled` and scheduledAt > now.
  - Set QueueSlot.status = `canceled` (and optionally clear postId or leave for audit).
  - For each affected Post, if it has no other QueueSlots that are still scheduled, set Post.status back to `draft` and Post.scheduledAt = null; otherwise update Post.scheduledAt to the next remaining QueueSlot.scheduledAt.
- **Idempotency:** Clear is idempotent for “clear all for this account.”

---

## 9. Scheduler: Enqueue Publish Jobs at the Correct Time

### 9.1 Model

- **One publish job per (post, account)** at the time when that post should go out on that account.  
- So: job payload = `{ postId, socialAccountId }` (and optionally queueSlotId).  
- Job is **delayed** so it runs at **QueueSlot.scheduledAt** (UTC).

### 9.2 Two patterns

**A) Delayed job per slot (recommended)**  
When a post is added to the queue (QueueSlot created):

- Enqueue a **single** BullMQ job with:
  - **delay** = `scheduledAt - now` (capped to Bull’s max delay; if beyond, use a “scheduler scan” as below).
  - **jobId** = e.g. `publish:${postId}:${socialAccountId}` or `publish:${queueSlotId}` to avoid duplicates.
- Worker runs at scheduledAt, loads post + account, publishes to that one account, updates QueueSlot and Post status.

**B) Scheduler scan (cron)**  
A repeatable job (e.g. every 1–2 minutes):

- Query: **QueueSlot** where status = `scheduled`, scheduledAt ≤ now + 1 min (or now + 0), and **AccountSchedule** for that account has paused = false.
- For each such QueueSlot, add a **publish job** with payload `{ postId, socialAccountId }` and **delay = 0** (or delay = scheduledAt - now if still in future).
- Use a **unique jobId** (e.g. queueSlotId) so the same slot is not enqueued twice. After enqueueing, optionally set a “jobEnqueuedAt” on QueueSlot to avoid double-enqueue in the same run.

**Recommendation:** Use **both**:  
- **Primary:** When creating a QueueSlot, add a delayed job if scheduledAt is within Bull’s max delay (e.g. 30 days).  
- **Fallback:** Scheduler scan every 1–2 minutes for QueueSlots with scheduledAt ≤ now and status = scheduled, and enqueue any that don’t have a job yet (e.g. after restart or for slots beyond max delay).

### 9.3 Reorder and job timing

- When the user **reorders**, QueueSlot.scheduledAt values change.  
- **Option 1:** Remove the old delayed job (by jobId) and add a new delayed job for the new scheduledAt.  
- **Option 2:** Rely on the **scheduler scan**: do not create delayed jobs on “add to queue”; only the scan enqueues jobs for slots where scheduledAt ≤ now. Then reorder only updates QueueSlot.scheduledAt; the scan will pick up the new times.  
- Option 2 is simpler and avoids job cancellation; Option 1 gives exact firing time without waiting for the next scan.

### 9.4 Pause

- In **scheduler scan**, join with AccountSchedule and **exclude** socialAccountIds where paused = true.  
- For **delayed jobs** created at “add to queue” time: either (1) when the worker runs, it checks paused and skips publishing (and re-queues for “next slot” or leaves post in queue), or (2) don’t create delayed jobs for that account while paused (if you create jobs at add time). Prefer (1) so pause is enforced at run time.

---

## 10. Timezone Handling

- **AccountSchedule.timezone** is IANA (e.g. `America/New_York`). All **slotsByDay** times (hour, minute) are **local** to this timezone.
- **Storage:** Always store **scheduledAt** in the DB as **UTC** (Date type). Store **timezone** on AccountSchedule and optionally on QueueSlot for display.
- **Next-slot computation:**
  - “Now” in the account’s timezone = use a timezone library (e.g. luxon, date-fns-tz) or Intl to get current local (day, hour, minute).
  - Enumerate next occurrences of (dayOfWeek, hour, minute) in that timezone, then **convert each to UTC** (account for DST).
- **Scheduler:** Compares **scheduledAt (UTC)** with **Date.now()**; no timezone in the comparison. Jobs are delayed by `scheduledAt.getTime() - Date.now()`.
- **UI:** Display times in the user’s or account’s timezone using the same IANA zone and format for consistency.

---

## 11. Summary: Data Flow

| Action | Main effect |
|--------|-------------|
| **Add to Queue** | For each account, compute next free slot (UTC) from AccountSchedule + existing QueueSlots + skipNextSlot + maxPostsPerDay; create QueueSlot(s); set Post.scheduledAt (earliest) and status = scheduled; optionally enqueue delayed publish job(s). |
| **Reorder** | Recompute slot times for that account so order matches new list; update QueueSlot.scheduledAt and position; optionally replace delayed jobs. |
| **Pause** | AccountSchedule.paused = true; scheduler and/or worker skip this account. |
| **Skip next** | AccountSchedule.skipNextSlot = true; next “Add to Queue” skips one slot. |
| **Clear** | QueueSlots for account (future) → status = canceled; Post updated or set to draft. |
| **Scheduler** | Every 1–2 min (or on QueueSlot create): find QueueSlots with status=scheduled, scheduledAt ≤ now, account not paused → enqueue publish job(postId, socialAccountId). |

---

## 12. Schema Summary (quick reference)

- **AccountSchedule:** organizationId, socialAccountId (unique), slotsByDay (day → [{hour, minute}]), timezone, paused, skipNextSlot, maxPostsPerDay, enabled.
- **QueueSlot:** organizationId, socialAccountId, scheduledAt (UTC), postId, position, status (scheduled | publishing | published | failed | canceled), timezone (optional), publishedAt.
- **Post:** existing fields; ensure scheduledAt (UTC), status, socialAccountIds; optional queuePosition.

This design is Buffer-like, supports day-specific recurring slots, add-to-queue with “next available” and “if filled use next,” reorder/pause/skip/clear, and production-ready scheduler and timezone behavior.
