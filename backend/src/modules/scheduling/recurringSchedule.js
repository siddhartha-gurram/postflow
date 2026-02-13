/**
 * Recurring weekly schedule: compute next slot(s) from AccountSchedule rules.
 * Time slots are in the schedule's IANA timezone; returns UTC Date.
 * @module modules/scheduling/recurringSchedule
 */

/**
 * Get local date parts (day of week, hour, minute) for a UTC date in a given timezone.
 * Uses Intl for correct DST behavior.
 *
 * @param {Date} dateUtc
 * @param {string} tz - IANA e.g. 'America/New_York'
 * @returns {{ dayOfWeek: number, hour: number, minute: number, year: number, month: number, date: number }}
 */
function getLocalParts(dateUtc, tz) {
  const d = new Date(dateUtc);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (name) => {
    const p = parts.find((x) => x.type === name);
    return p ? parseInt(p.value, 10) : 0;
  };
  const weekday = fmt.formatToParts(d).find((p) => p.type === 'weekday');
  const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
  const dayOfWeek = weekday ? dayMap[weekday.value.toLowerCase().slice(0, 3)] : d.getUTCDay();
  return {
    year: get('year'),
    month: get('month') - 1,
    date: get('day'),
    dayOfWeek,
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * Convert local date/time in a timezone to UTC Date.
 *
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {number} date
 * @param {number} hour
 * @param {number} minute
 * @param {string} tz - IANA
 * @returns {Date} UTC
 */
function localToUtc(year, month, date, hour, minute, tz) {
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  if (!tz || tz === 'UTC') {
    return new Date(iso + 'Z');
  }
  const localDate = new Date(iso);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone: tz }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return new Date(localDate.getTime() + offset);
}

/**
 * Get the next N slot times (UTC) from a given start, based on recurring weekly rules.
 * Slots are (dayOfWeek, hour, minute) in the schedule's timezone.
 *
 * @param {Object} schedule - { timeSlots: [{ hour, minute }], daysOfWeek: number[], timezone: string }
 * @param {Date} fromUtc - Start searching from this time (UTC)
 * @param {number} count - Max number of slot times to return
 * @returns {Date[]} Array of UTC Dates, sorted ascending
 */
function getNextSlotTimes(schedule, fromUtc, count = 1) {
  if (!schedule || !schedule.timeSlots || schedule.timeSlots.length === 0) {
    return [];
  }
  const daysOfWeek = schedule.daysOfWeek && schedule.daysOfWeek.length > 0
    ? [...new Set(schedule.daysOfWeek)].sort((a, b) => a - b)
    : [0, 1, 2, 3, 4, 5, 6];
  const tz = schedule.timezone || 'UTC';

  const candidates = [];
  const from = new Date(fromUtc.getTime());
  const startParts = getLocalParts(from, tz);

  for (let week = 0; week < 2; week++) {
    for (const dayOfWeek of daysOfWeek) {
      for (const slot of schedule.timeSlots) {
        const localY = startParts.year;
        const localM = startParts.month;
        const localD = startParts.date;
        const localDw = startParts.dayOfWeek;
        let daysOffset = dayOfWeek - localDw;
        if (daysOffset < 0) daysOffset += 7;
        if (week === 1) daysOffset += 7;
        const slotDate = new Date(localY, localM, localD + daysOffset, slot.hour, slot.minute, 0, 0);
        const utc = localToUtc(
          slotDate.getFullYear(),
          slotDate.getMonth(),
          slotDate.getDate(),
          slot.hour,
          slot.minute,
          tz
        );
        if (utc.getTime() >= fromUtc.getTime()) candidates.push(utc);
      }
    }
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (out.length >= count) break;
    const k = c.getTime();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out.slice(0, count);
}

/**
 * Get the single next slot time (UTC) at or after fromUtc.
 *
 * @param {Object} schedule - AccountSchedule doc or plain object
 * @param {Date} fromUtc
 * @returns {Date|null}
 */
function getNextSlotTime(schedule, fromUtc) {
  const slots = getNextSlotTimes(schedule, fromUtc, 1);
  return slots.length > 0 ? slots[0] : null;
}

/**
 * Enumerate all (dayOfWeek, hour, minute) combinations for the schedule.
 * @param {Object} schedule
 * @returns {Array<{ dayOfWeek: number, hour: number, minute: number }>}
 */
function getSlotCombinations(schedule) {
  if (!schedule || !schedule.timeSlots || schedule.timeSlots.length === 0) return [];
  const days = schedule.daysOfWeek && schedule.daysOfWeek.length > 0
    ? schedule.daysOfWeek
    : [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  for (const d of days) {
    for (const s of schedule.timeSlots) {
      out.push({ dayOfWeek: d, hour: s.hour, minute: s.minute });
    }
  }
  return out;
}

module.exports = {
  getNextSlotTimes,
  getNextSlotTime,
  getSlotCombinations,
  getLocalParts,
  localToUtc,
};
