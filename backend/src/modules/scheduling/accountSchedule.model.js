/**
 * AccountSchedule: recurring weekly queue config per social account.
 * Defines when posts can be scheduled (time slots, days of week, timezone).
 * @module modules/scheduling/accountSchedule.model
 */

const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema(
  {
    hour: { type: Number, required: true, min: 0, max: 23 },
    minute: { type: Number, required: true, min: 0, max: 59 },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    socialAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      required: true,
      index: true,
      unique: true,
    },
    name: { type: String, default: 'Default Queue', maxlength: 100 },
    enabled: { type: Boolean, default: true, index: true },
    timeSlots: {
      type: [timeSlotSchema],
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.length <= 24,
        message: 'At most 24 time slots per schedule',
      },
    },
    daysOfWeek: {
      type: [Number],
      default: [0, 1, 2, 3, 4, 5, 6],
      validate: {
        validator: (v) =>
          Array.isArray(v) && v.length <= 7 && v.every((d) => d >= 0 && d <= 6) && new Set(v).size === v.length,
        message: 'daysOfWeek must be unique integers 0 (Sun) to 6 (Sat)',
      },
    },
    maxPostsPerDay: { type: Number, min: 1, max: 50, default: 5 },
    timezone: {
      type: String,
      required: true,
      default: 'UTC',
      trim: true,
    },
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, enabled: 1 });

const AccountSchedule = mongoose.model('AccountSchedule', schema);
module.exports = { AccountSchedule };
