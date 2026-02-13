# Scheduling Module

## Models

### AccountSchedule

Recurring weekly queue config **per social account** (one doc per account).

- **organizationId**, **socialAccountId** (unique)
- **timeSlots**: `[{ hour, minute }]` — local times in **timezone** (e.g. 9:00, 14:00, 18:00)
- **daysOfWeek**: `[0–6]` (Sun–Sat); empty = all days
- **timezone**: IANA (e.g. `America/New_York`)
- **maxPostsPerDay**: cap per account per day
- **enabled**: whether this schedule is active

### QueueSlot

Concrete slot instance: **one document per (account, scheduledAt)** when a post is assigned.

- **organizationId**, **socialAccountId**, **scheduledAt** (UTC)
- **postId**: assigned post (null if slot is pre-generated and still available)
- **status**: `available` | `scheduled` | `publishing` | `published` | `failed` | `canceled`
- **timezone**: for display; **publishedAt**: when status is published

## Recurring weekly schedule

- **`recurringSchedule.js`**: pure functions, no DB.
  - **getNextSlotTime(schedule, fromUtc)** → next single UTC `Date` from recurring rules.
  - **getNextSlotTimes(schedule, fromUtc, count)** → next N UTC dates.
  - **getSlotCombinations(schedule)** → all (dayOfWeek, hour, minute) pairs.
  - **getLocalParts(dateUtc, tz)**, **localToUtc(...)** for timezone conversion (IANA).

Slots are interpreted in the schedule’s **timezone**; results are returned in **UTC**.

## Auto slot allocator

- **getNextAvailableSlot(socialAccountId, fromUtc?)**  
  Returns the next free slot (UTC) for that account: applies AccountSchedule, **maxPostsPerDay**, and existing QueueSlots/Posts so the same slot isn’t double-booked.

- **allocateSlotForPost(postId, socialAccountIds, organizationId)**  
  For each account, gets the next available slot, creates a **QueueSlot** (status `scheduled`), sets **Post.scheduledAt** to the earliest of the slots, and sets **Post.status** to `scheduled`. Use when the user chooses “Add to queue”.

- **getNextAvailableSlotTimes(socialAccountId, fromUtc?, count)**  
  Returns the next N available slot times (UTC) for calendar preview.

## Multi-account and publish

If a post is scheduled to **multiple accounts** with different slot times, **Post.scheduledAt** is set to the **earliest** slot. To publish per account at each account’s time, the scheduler should enqueue **one publish job per QueueSlot** at **QueueSlot.scheduledAt** (e.g. scan `QueueSlot` with `status: 'scheduled'`, `scheduledAt <= now`), with job data `{ postId, socialAccountId }`.
