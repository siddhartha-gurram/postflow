/**
 * QueueSlot: concrete slot instance at a specific UTC time for an account.
 * Created when a post is assigned to a queue slot (or pre-generated for calendar).
 * @module modules/scheduling/queueSlot.model
 */

const mongoose = require('mongoose');

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
    },
    scheduledAt: { type: Date, required: true, index: true },
    timezone: { type: String, trim: true },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      default: null,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['available', 'scheduled', 'publishing', 'published', 'failed', 'canceled'],
      default: 'scheduled',
      index: true,
    },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

schema.index({ socialAccountId: 1, scheduledAt: 1 });
schema.index({ organizationId: 1, socialAccountId: 1, scheduledAt: 1 });
schema.index({ postId: 1 }, { sparse: true });
schema.index({ status: 1, scheduledAt: 1 });

const QueueSlot = mongoose.model('QueueSlot', schema);
module.exports = { QueueSlot };
