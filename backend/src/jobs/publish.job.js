/**
 * Publish job processor: run publish flow, handle 429 (requeue with delay), 5xx (retry), invalid_grant (no retry).
 * @module jobs/publish.job
 */

const { ProviderRateLimitError, OAuthError } = require('../lib/errors');
const { createPublishService } = require('../modules/publishing/publish.service');
const { createConnectionService } = require('../modules/connections/connection.service');
const { TokenService } = require('../modules/connections/token.service');
const { createOAuthStateStore } = require('../modules/connections/oauth-state.store');
const config = require('../config');

/**
 * Create processor that uses a Redis connection and mongoose (already connected).
 * @param {import('ioredis').Redis} redis
 */
function createPublishProcessor(redis) {
  const tokenService = new TokenService(config.TOKEN_ENCRYPTION_KEY);
  const oauthStateStore = createOAuthStateStore(redis);
  const connectionService = createConnectionService({
    oauthStateStore,
    tokenService,
    frontendUrl: config.FRONTEND_URL,
  });
  const publishService = createPublishService({ connectionService });
  const connection = { host: redis.options?.host || '127.0.0.1', port: redis.options?.port || 6379 };

  return async function processPublishJob(job) {
    const { postId } = job.data;
    if (!postId) {
      throw new Error('Job data missing postId');
    }

    try {
      await publishService.publishPost(postId);
    } catch (err) {
      if (err instanceof ProviderRateLimitError) {
        const delayMs = (err.retryAfterSeconds || 60) * 1000;
        const timestamp = Date.now() + delayMs;
        await job.moveToDelayed(timestamp, job.token);
        const { DelayedError } = require('bullmq');
        throw new DelayedError();
      }
      if (err.name === 'OAuthError' || err.code === 'TOKEN_EXPIRED') {
        return;
      }
      throw err;
    }
  };
}

module.exports = { createPublishProcessor };
