/**
 * Shared DTOs and provider interface contracts.
 * Used by all SocialProvider implementations (e.g. LinkedInProvider).
 * @module lib/providers/types
 */

/**
 * @typedef {'twitter'|'linkedin'|'facebook'|'instagram'|'youtube'} ProviderId
 */

/**
 * @typedef {Object} AuthUrlResult
 * @property {string} url - Full URL to redirect the user to
 * @property {string} state - Opaque state; must be stored and validated in callback
 * @property {string} [pkceCodeVerifier] - If PKCE, store server-side and bind to state
 */

/**
 * @typedef {Object} CallbackPayload
 * @property {string} code - Authorization code from provider
 * @property {string} state - State from redirect
 * @property {string} [error]
 * @property {string} [error_description]
 * @property {string} [key: string]
 */

/**
 * @typedef {Object} TokenSet
 * @property {string} accessToken
 * @property {string|null} [refreshToken]
 * @property {Date|null} [expiresAt]
 * @property {number|null} [expiresIn] - Seconds until expiry
 * @property {string} [scope]
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @typedef {Object} Profile
 * @property {string} platformUserId
 * @property {string} [username]
 * @property {string} [displayName]
 * @property {string} [avatarUrl]
 * @property {string} [email]
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @typedef {Object} PublishPayload
 * @property {string} text
 * @property {string} [linkUrl]
 * @property {string} [linkTitle]
 * @property {Array<{type: 'image'|'video', url: string, key?: string}>} [media]
 * @property {Record<string, unknown>} [options]
 */

/**
 * @typedef {Object} PublishResult
 * @property {string} platformPostId
 * @property {string} [platformPostUrl]
 * @property {Date} publishedAt
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @typedef {Object} AnalyticsResult
 * @property {string} platformPostId
 * @property {{ impressions?: number, likes?: number, comments?: number, shares?: number, clicks?: number, engagement?: number, [key: string]: number|undefined }} metrics
 * @property {Date} fetchedAt
 * @property {Record<string, unknown>} [raw]
 */

/**
 * @typedef {Object} StoredOAuthState
 * @property {string} state
 * @property {string} organizationId
 * @property {string} userId
 * @property {ProviderId} providerId
 * @property {string} [pkceCodeVerifier]
 * @property {number} createdAt
 */

/**
 * @typedef {Object} CallbackResult
 * @property {TokenSet} tokens
 * @property {Profile} profile
 */

module.exports = {};
