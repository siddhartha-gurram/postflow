/**
 * Per-(post, socialAccount) publish result.
 * @module modules/publishing/publishResult.model
 */

const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    socialAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    status: { type: String, required: true, enum: ['published', 'failed'] },
    platformPostId: { type: String },
    platformPostUrl: { type: String },
    publishedAt: { type: Date },
    errorCode: { type: String },
    errorMessage: { type: String, maxlength: 1000 },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

schema.index({ postId: 1, socialAccountId: 1 }, { unique: true });
schema.index({ organizationId: 1, publishedAt: -1 });

const PublishResult = mongoose.model('PublishResult', schema);
module.exports = { PublishResult };
