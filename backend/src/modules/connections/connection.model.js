/**
 * SocialAccount (connection) model. Tokens stored encrypted at rest.
 * @module modules/connections/connection.model
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
    platform: {
      type: String,
      required: true,
      enum: ['linkedin', 'twitter', 'facebook', 'instagram', 'pinterest', 'tiktok', 'youtube'],
      index: true,
    },
    platformUserId: { type: String, required: true, maxlength: 128 },
    platformUsername: { type: String, maxlength: 128 },
    displayName: { type: String },
    avatarUrl: { type: String },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: null },
    tokenExpiresAt: { type: Date, default: null, index: true },
    scopes: [{ type: String }],
    metadata: { type: mongoose.Schema.Types.Mixed },
    status: {
      type: String,
      required: true,
      enum: ['active', 'expired', 'revoked', 'error'],
      default: 'active',
      index: true,
    },
    lastErrorAt: { type: Date },
    lastErrorCode: { type: String },
    lastErrorMessage: { type: String, maxlength: 500 },
    lastRefreshedAt: { type: Date },
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, platform: 1, platformUserId: 1 }, { unique: true });
schema.index({ organizationId: 1, status: 1 });
schema.index({ status: 1, tokenExpiresAt: 1 });

const SocialAccount = mongoose.model('SocialAccount', schema);
module.exports = { SocialAccount };
