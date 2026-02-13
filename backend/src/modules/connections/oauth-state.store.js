/**
 * OAuth state storage in Redis (TTL). Used between redirect and callback.
 * @module modules/connections/oauth-state.store
 */

const STATE_PREFIX = 'oauth:state:';
const DEFAULT_TTL_SECONDS = 600;

/**
 * @param {import('ioredis').Redis} redis
 * @param {number} [ttlSeconds]
 */
function createOAuthStateStore(redis, ttlSeconds = DEFAULT_TTL_SECONDS) {
  return {
    /**
     * @param {string} state
     * @param {import('../../../lib/providers/types').StoredOAuthState} data
     */
    async set(state, data) {
      const key = STATE_PREFIX + state;
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
    },

    /**
     * @param {string} state
     * @returns {Promise<import('../../../lib/providers/types').StoredOAuthState | null>}
     */
    async get(state) {
      const key = STATE_PREFIX + state;
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    /**
     * @param {string} state
     */
    async delete(state) {
      await redis.del(STATE_PREFIX + state);
    },
  };
}

module.exports = { createOAuthStateStore, STATE_PREFIX, DEFAULT_TTL_SECONDS };
