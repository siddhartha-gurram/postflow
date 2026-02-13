/**
 * Post model for scheduling and publishing.
 * @module modules/content/post.model
 */

const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'scheduled', 'queued', 'publishing', 'published', 'failed'],
      default: 'draft',
      index: true,
    },
    content: {
      text: { type: String },
      linkUrl: { type: String },
      linkTitle: { type: String },
      linkDescription: { type: String },
      linkImageUrl: { type: String },
    },
    variants: [
      {
        socialAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
        text: { type: String },
        linkUrl: { type: String },
      },
    ],
    media: [
      {
        type: { type: String, enum: ['image', 'video'] },
        url: { type: String },
        key: { type: String },
        width: { type: Number },
        height: { type: Number },
        duration: { type: Number },
      },
    ],
    socialAccountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
    scheduledAt: { type: Date, index: true },
    timezone: { type: String },
    queuePosition: { type: Number },
    publishedAt: { type: Date },
    failureReason: { type: String },
    failureCode: { type: String },
    idempotencyKey: { type: String, sparse: true, unique: true },
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, status: 1, scheduledAt: 1 });
schema.index({ organizationId: 1, createdBy: 1, createdAt: -1 });
schema.index({ status: 1, scheduledAt: 1 });

const Post = mongoose.model('Post', schema);
module.exports = { Post };
