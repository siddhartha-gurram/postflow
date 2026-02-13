/**
 * HTTP client for social platform APIs.
 * - Retry with exponential backoff on 5xx and network errors
 * - Parses rate limit headers and throws ProviderRateLimitError with retryAfterSeconds
 * - Never logs request/response bodies (may contain tokens)
 * @module lib/platformClient
 */

const {
  ProviderRateLimitError,
  ProviderClientError,
  ProviderServerError,
} = require('./errors');

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

/**
 * Parse rate limit headers (LinkedIn-style and common patterns).
 * @param {Headers} headers
 * @returns {{ retryAfterSeconds?: number, remaining?: number, limit?: number }}
 */
function parseRateLimitHeaders(headers) {
  const retryAfter = headers.get('retry-after') || headers.get('Retry-After');
  const remaining = headers.get('x-restli-ratelimit-remaining') || headers.get('X-RateLimit-Remaining');
  const limit = headers.get('x-restli-ratelimit-limit') || headers.get('X-RateLimit-Limit');

  let retryAfterSeconds;
  if (retryAfter) {
    const v = parseInt(retryAfter, 10);
    retryAfterSeconds = Number.isNaN(v) ? 60 : Math.min(Math.max(v, 1), 3600);
  }

  return {
    retryAfterSeconds,
    remaining: remaining ? parseInt(remaining, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  };
}

/**
 * @param {Response} res
 * @param {string} body - Response body text (for error message)
 */
function throwForStatus(res, body) {
  const status = res.status;
  const rateLimit = parseRateLimitHeaders(res.headers);

  if (status === 429) {
    throw new ProviderRateLimitError(
      body || 'Rate limit exceeded',
      {
        statusCode: 429,
        retryAfterSeconds: rateLimit.retryAfterSeconds ?? 60,
        raw: { status, rateLimit },
      }
    );
  }

  if (status >= 500) {
    throw new ProviderServerError(body || `Platform error ${status}`, {
      statusCode: status,
      raw: { status },
    });
  }

  if (status >= 400) {
    throw new ProviderClientError(body || `Client error ${status}`, {
      statusCode: status,
      raw: { status },
    });
  }
}

/**
 * Fetch with retries (exponential backoff on 5xx and network errors).
 * On 429, throws ProviderRateLimitError (no retry here; caller/job should re-queue with delay).
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ retries?: number, initialBackoffMs?: number, maxBackoffMs?: number }} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init = {}, options = {}) {
  const retries = options.retries ?? DEFAULT_RETRY_ATTEMPTS;
  const initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      const text = await res.text();

      if (res.ok) {
        return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
      }

      if (res.status === 429) {
        const rateLimit = parseRateLimitHeaders(res.headers);
        throw new ProviderRateLimitError(text || 'Rate limit exceeded', {
          statusCode: 429,
          retryAfterSeconds: rateLimit.retryAfterSeconds ?? 60,
          raw: { status: 429, rateLimit },
        });
      }

      if (res.status >= 400 && res.status < 500) {
        throw new ProviderClientError(text || `Client error ${res.status}`, {
          statusCode: res.status,
          raw: { status: res.status },
        });
      }

      // 5xx
      throw new ProviderServerError(text || `Server error ${res.status}`, {
        statusCode: res.status,
        raw: { status: res.status },
      });
    } catch (err) {
      lastError = err;
      if (err.name === 'ProviderRateLimitError' || err.name === 'ProviderClientError') {
        throw err;
      }
      if (attempt === retries) break;
      const delay = Math.min(initialBackoffMs * Math.pow(2, attempt), maxBackoffMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * GET JSON from platform API (with Bearer token).
 * @param {string} url - Full URL
 * @param {string} accessToken - Bearer token (never logged)
 * @param {{ retries?: number, extraHeaders?: Record<string, string> }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function getJson(url, accessToken, options = {}) {
  const res = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options.extraHeaders,
      },
    },
    options
  );
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderClientError('Invalid JSON response', { statusCode: res.status, raw: { body: text.slice(0, 200) } });
  }
}

/**
 * POST JSON to platform API (with Bearer token).
 * @param {string} url
 * @param {string} accessToken
 * @param {Record<string, unknown>} body
 * @param {{ retries?: number, extraHeaders?: Record<string, string> }} [options]
 * @returns {Promise<{ data?: Record<string, unknown>, headers: Headers, status: number }>}
 */
async function postJson(url, accessToken, body, options = {}) {
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options.extraHeaders,
      },
      body: JSON.stringify(body),
    },
    { retries: options.retries }
  );
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { data, headers: res.headers, status: res.status };
}

/**
 * POST application/x-www-form-urlencoded (e.g. OAuth token exchange).
 * @param {string} url
 * @param {Record<string, string>} form
 * @param {{ retries?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function postForm(url, form, options = {}) {
  const body = new URLSearchParams(form).toString();
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    },
    options
  );
  const text = await res.text();
  if (!res.ok) {
    let errBody = text;
    try {
      const parsed = JSON.parse(text);
      errBody = parsed.error_description || parsed.error || text;
    } catch (_) {}
    throwForStatus(res, errBody);
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

module.exports = {
  fetchWithRetry,
  getJson,
  postJson,
  postForm,
  parseRateLimitHeaders,
  throwForStatus,
};
