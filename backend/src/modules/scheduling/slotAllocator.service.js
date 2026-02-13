/**
 * Auto slot allocator: assign next available queue slot(s) to a post from recurring weekly schedule.
 * Respects maxPostsPerDay and existing QueueSlots/Post scheduledAt per account.
 * @module modules/scheduling/slotAllocator.service
 */

const { AccountSchedule } = require('./accountSchedule.model');
const { QueueSlot } = require('./queueSlot.model');
const { Post } = require('../content/post.model');
const { getNextSlotTimes, getNextSlotTime } = require('./recurringSchedule');

/**
 * Default buffer: don't allocate a slot in the past or within this many minutes from now.
 */
const MINUTES_BUFFER = 2;

/**
 * Get the next available slot time (UTC) for a social account, respecting:
 * - AccountSchedule (timeSlots, daysOfWeek, timezone, maxPostsPerDay)
 * - Already scheduled slots (QueueSlots and Posts) for that account on that day (local)
 *
 * @param {string} socialAccountId - ObjectId string or ObjectId
 * @param {Date} [fromUtc] - Search from this time (default: now + buffer)
 * @returns {Promise<{ scheduledAt: Date, queueSlotId?: string } | null>}
 */
async function getNextAvailableSlot(socialAccountId, fromUtc = null) {
  const schedule = await AccountSchedule.findOne({
    socialAccountId,
    enabled: true,
  }).lean();

  if (!schedule || !schedule.timeSlots || schedule.timeSlots.length === 0) {
    return null;
  }

  const from = fromUtc ? new Date(fromUtc) : new Date(Date.now() + MINUTES_BUFFER * 60 * 1000);
  const tz = schedule.timezone || 'UTC';

  for (let attempts = 0; attempts < 14 * 24 * 2; attempts++) {
    const candidate = getNextSlotTime(schedule, from);
    if (!candidate) return null;

    const dayStart = getDayStartInUtc(candidate, tz);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const existingCount = await countScheduledSlotsInRange(socialAccountId, dayStart, dayEnd);
    if (existingCount >= (schedule.maxPostsPerDay || 5)) {
      from.setTime(candidate.getTime() + 60 * 1000);
      continue;
    }

    const alreadyUsed = await QueueSlot.findOne({
      socialAccountId,
      scheduledAt: candidate,
      status: { $in: ['scheduled', 'publishing', 'published'] },
    }).lean();

    if (alreadyUsed) {
      from.setTime(candidate.getTime() + 60 * 1000);
      continue;
    }

    return { scheduledAt: candidate };
  }

  return null;
}

/**
 * Count posts/slots already scheduled for this account in [dayStart, dayEnd) UTC.
 * @param {string} socialAccountId
 * @param {Date} dayStartUtc
 * @param {Date} dayEndUtc
 */
async function countScheduledSlotsInRange(socialAccountId, dayStartUtc, dayEndUtc) {
  const [slotCount, postCount] = await Promise.all([
    QueueSlot.countDocuments({
      socialAccountId,
      scheduledAt: { $gte: dayStartUtc, $lt: dayEndUtc },
      status: { $in: ['scheduled', 'publishing', 'published'] },
    }),
    Post.countDocuments({
      socialAccountIds: socialAccountId,
      scheduledAt: { $gte: dayStartUtc, $lt: dayEndUtc },
      status: { $in: ['scheduled', 'queued', 'publishing'] },
    }),
  ]);
  return Math.max(slotCount, postCount);
}

/**
 * Get start of day (midnight) in timezone tz for the day containing dateUtc, as UTC Date.
 * @param {Date} dateUtc
 * @param {string} tz
 * @returns {Date} UTC moment of midnight that day in tz
 */
function getDayStartInUtc(dateUtc, tz) {
  const d = new Date(dateUtc);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (name) => {
    const p = parts.find((x) => x.type === name);
    return p ? parseInt(p.value, 10) : 0;
  };
  const year = get('year');
  const month = get('month') - 1;
  const day = get('day');
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
  if (!tz || tz === 'UTC') return new Date(iso + 'Z');
  const localDate = new Date(iso);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone: tz }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return new Date(localDate.getTime() + offset);
}

/**
 * Allocate the next available queue slot(s) for a post and assign it.
 * Creates QueueSlot(s) and updates Post.scheduledAt to the earliest slot; supports multi-account.
 *
 * @param {string} postId
 * @param {string[]} socialAccountIds - One or more account IDs to schedule to
 * @param {string} organizationId
 * @returns {Promise<{ scheduledAt: Date, slots: Array<{ socialAccountId: string, scheduledAt: Date, queueSlotId: string }> }>}
 */
async function allocateSlotForPost(postId, socialAccountIds, organizationId) {
  if (!socialAccountIds || socialAccountIds.length === 0) {
    throw new Error('At least one socialAccountId required');
  }

  const post = await Post.findById(postId);
  if (!post) {
    const e = new Error('Post not found');
    e.code = 'POST_NOT_FOUND';
    throw e;
  }
  if (post.status !== 'draft' && post.status !== 'queued') {
    const e = new Error(`Post cannot be scheduled in current status: ${post.status}`);
    e.code = 'INVALID_POST_STATE';
    throw e;
  }

  let fromUtc = new Date(Date.now() + MINUTES_BUFFER * 60 * 1000);
  const slots = [];

  for (const accountId of socialAccountIds) {
    const next = await getNextAvailableSlot(accountId, fromUtc);
    if (!next) {
      const e = new Error(`No available slot for account ${accountId}`);
      e.code = 'NO_SLOT_AVAILABLE';
      e.socialAccountId = accountId;
      throw e;
    }

    const queueSlot = await QueueSlot.create({
      organizationId,
      socialAccountId: accountId,
      scheduledAt: next.scheduledAt,
      postId,
      status: 'scheduled',
    });

    slots.push({
      socialAccountId: String(accountId),
      scheduledAt: next.scheduledAt,
      queueSlotId: String(queueSlot._id),
    });

    if (next.scheduledAt.getTime() > fromUtc.getTime()) {
      fromUtc = new Date(next.scheduledAt.getTime());
    }
  }

  const earliest = slots.length > 0
    ? new Date(Math.min(...slots.map((s) => s.scheduledAt.getTime())))
    : new Date();

  await Post.updateOne(
    { _id: postId },
    {
      $set: {
        socialAccountIds: socialAccountIds.map((id) => id),
        scheduledAt: earliest,
        status: 'scheduled',
        updatedAt: new Date(),
      },
    }
  );

  return { scheduledAt: earliest, slots };
}

/**
 * Get next N available slot times for an account (for calendar preview).
 *
 * @param {string} socialAccountId
 * @param {Date} [fromUtc]
 * @param {number} count
 * @returns {Promise<Date[]>}
 */
async function getNextAvailableSlotTimes(socialAccountId, fromUtc = null, count = 10) {
  const schedule = await AccountSchedule.findOne({
    socialAccountId,
    enabled: true,
  }).lean();

  if (!schedule || !schedule.timeSlots || schedule.timeSlots.length === 0) {
    return [];
  }

  const from = fromUtc ? new Date(fromUtc) : new Date(Date.now() + MINUTES_BUFFER * 60 * 1000);
  const candidates = getNextSlotTimes(schedule, from, count * 2);
  const tz = schedule.timezone || 'UTC';
  const result = [];
  const maxPerDay = schedule.maxPostsPerDay || 5;

  for (const candidate of candidates) {
    if (result.length >= count) break;
    const dayStart = getDayStartInUtc(candidate, tz);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const existing = await countScheduledSlotsInRange(socialAccountId, dayStart, dayEnd);
    if (existing >= maxPerDay) continue;
    const used = await QueueSlot.findOne({
      socialAccountId,
      scheduledAt: candidate,
      status: { $in: ['scheduled', 'publishing', 'published'] },
    });
    if (used) continue;
    result.push(candidate);
  }

  return result;
}

module.exports = {
  getNextAvailableSlot,
  allocateSlotForPost,
  getNextAvailableSlotTimes,
  countScheduledSlotsInRange,
};
