/**
 * Provider and platform domain errors.
 * Core can map these to HTTP status and retry behavior.
 * @module lib/errors
 */

/**
 * Base for provider/platform errors.
 */
class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, statusCode?: number, retryable?: boolean, retryAfterSeconds?: number }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code || 'PROVIDER_ERROR';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.raw = options.raw;
  }
}

/** OAuth / callback errors (invalid_grant, access_denied, etc.) */
class OAuthError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'OAUTH_ERROR' });
    this.name = 'OAuthError';
  }
}

/** Platform returned 429 or rate limit header */
class ProviderRateLimitError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'RATE_LIMIT', retryable: true });
    this.name = 'ProviderRateLimitError';
  }
}

/** Platform 4xx (except 429) - do not retry */
class ProviderClientError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'ProviderClientError';
  }
}

/** Platform 5xx or network - retry */
class ProviderServerError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: true });
    this.name = 'ProviderServerError';
  }
}

module.exports = {
  ProviderError,
  OAuthError,
  ProviderRateLimitError,
  ProviderClientError,
  ProviderServerError,
};
