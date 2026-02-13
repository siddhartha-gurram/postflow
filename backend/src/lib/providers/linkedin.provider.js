/**
 * LinkedIn SocialProvider implementation.
 * - OAuth 2.0 Authorization Code flow with PKCE
 * - LinkedIn API v2: /v2/me, /v2/ugcPosts, /rest/memberCreatorPostAnalytics
 * - No DB or encryption; uses config and HTTP only.
 * @module lib/providers/linkedin
 */

const crypto = require('crypto');
const { getLinkedInConfig } = require('../../config/providers/linkedin');
const { getJson, postJson, postForm } = require('../platformClient');
const { OAuthError, ProviderClientError } = require('../errors');

const PROVIDER_ID = 'linkedin';

/** UGC Post max text length (LinkedIn limit) */
const MAX_POST_TEXT_LENGTH = 3000;

/** Restli protocol header required by LinkedIn */
const RESTLI_PROTOCOL_VERSION = '2.0.0';

/**
 * Generate PKCE code_verifier (43–128 chars, base64url).
 * @returns {string}
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate code_challenge from code_verifier (S256).
 * @param {string} verifier
 * @returns {string}
 */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Extract person URN (urn:li:person:xxx) from /v2/me response.
 * @param {Record<string, unknown>} me
 * @returns {string}
 */
function getAuthorUrn(me) {
  const id = me.id || me.sub;
  if (typeof id === 'string' && id.startsWith('urn:li:person:')) {
    return id;
  }
  if (typeof id === 'string') {
    return id.startsWith('urn:li:') ? id : `urn:li:person:${id}`;
  }
  throw new ProviderClientError('LinkedIn /v2/me did not return author id', { raw: me });
}

/**
 * Map LinkedIn token response to TokenSet DTO.
 * @param {Record<string, unknown>} body
 * @returns {{ accessToken: string, refreshToken?: string | null, expiresAt?: Date | null, expiresIn?: number | null, scope?: string, raw?: Record<string, unknown> }}
 */
function mapTokenResponse(body) {
  const accessToken = body.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new OAuthError('LinkedIn token response missing access_token', { raw: body });
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : null;
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : null;
  const scope = typeof body.scope === 'string' ? body.scope : undefined;
  return {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt,
    expiresIn: expiresIn ?? undefined,
    scope,
    raw: body,
  };
}

/**
 * Map LinkedIn /v2/me (or userinfo) to Profile DTO.
 * @param {Record<string, unknown>} me
 * @returns {{ platformUserId: string, username?: string, displayName?: string, avatarUrl?: string, email?: string, raw?: Record<string, unknown> }}
 */
function mapProfile(me) {
  const id = me.id ?? me.sub;
  if (!id || typeof id !== 'string') {
    throw new ProviderClientError('LinkedIn profile missing id', { raw: me });
  }
  const platformUserId = id.replace(/^urn:li:person:/i, '') || id;
  const firstName = me.localizedFirstName ?? me.given_name ?? me.firstName;
  const lastName = me.localizedLastName ?? me.family_name ?? me.lastName;
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || undefined;
  const profilePicture = me.profilePicture ?? me.picture;
  let avatarUrl;
  if (profilePicture && typeof profilePicture === 'object') {
    const displayImage =
      profilePicture['displayImage~'] ?? profilePicture.displayImage;
    const elements = Array.isArray(displayImage?.elements)
      ? displayImage.elements
      : [];
    const largest = elements.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    avatarUrl = largest?.identifiers?.[0]?.identifier ?? largest?.url;
  } else if (typeof profilePicture === 'string') {
    avatarUrl = profilePicture;
  }
  return {
    platformUserId,
    displayName,
    avatarUrl,
    email: typeof me.email === 'string' ? me.email : undefined,
    raw: me,
  };
}

/**
 * Normalize platformPostId to URN if needed (urn:li:ugcPost:xxx or urn:li:share:xxx).
 * @param {string} platformPostId
 * @returns {string}
 */
function toUgcPostUrn(platformPostId) {
  if (platformPostId.startsWith('urn:li:')) {
    return platformPostId;
  }
  return `urn:li:ugcPost:${platformPostId}`;
}

/**
 * Build share media category from payload.
 * @param {{ media?: Array<{ type: string }> }} payload
 * @returns {'NONE'|'IMAGE'|'VIDEO'|'ARTICLE'}
 */
function getShareMediaCategory(payload) {
  if (!payload.media || payload.media.length === 0) {
    return payload.linkUrl ? 'ARTICLE' : 'NONE';
  }
  const first = payload.media[0];
  const t = first?.type?.toLowerCase();
  if (t === 'video') return 'VIDEO';
  if (t === 'image') return 'IMAGE';
  return 'NONE';
}

/**
 * LinkedIn SocialProvider implementation.
 */
class LinkedInProvider {
  constructor(config = null) {
    this._config = config || getLinkedInConfig();
    if (!this._config.clientId || !this._config.clientSecret) {
      throw new Error('LinkedInProvider requires clientId and clientSecret');
    }
  }

  get id() {
    return PROVIDER_ID;
  }

  /**
   * Build authorization URL and PKCE verifier.
   * @param {string} _organizationId - Unused by provider; core uses for state binding
   * @param {string} _userId - Unused by provider; core uses for state binding
   * @returns {Promise<{ url: string, state: string, pkceCodeVerifier?: string }>}
   */
  async getAuthUrl(_organizationId, _userId) {
    const state = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this._config.clientId,
      redirect_uri: this._config.redirectUri,
      state,
      scope: this._config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${this._config.authUrl}?${params.toString()}`;
    return {
      url,
      state,
      pkceCodeVerifier: codeVerifier,
    };
  }

  /**
   * Exchange code for tokens and fetch profile.
   * @param {import('./types').CallbackPayload} payload
   * @param {import('./types').StoredOAuthState} storedState
   * @returns {Promise<{ tokens: import('./types').TokenSet, profile: import('./types').Profile }>}
   */
  async handleCallback(payload, storedState) {
    if (payload.error) {
      throw new OAuthError(payload.error_description || payload.error, {
        code: payload.error,
        raw: payload,
      });
    }
    const code = payload.code;
    if (!code) {
      throw new OAuthError('Missing authorization code', { raw: payload });
    }

    const tokenBody = {
      grant_type: 'authorization_code',
      code,
      client_id: this._config.clientId,
      client_secret: this._config.clientSecret,
      redirect_uri: this._config.redirectUri,
    };
    if (storedState.pkceCodeVerifier) {
      tokenBody.code_verifier = storedState.pkceCodeVerifier;
    }

    let tokenResponse;
    try {
      tokenResponse = await postForm(this._config.tokenUrl, tokenBody, { retries: 0 });
    } catch (err) {
      if (err.name === 'ProviderClientError' && err.statusCode === 400) {
        let msg = err.message;
        try {
          const parsed = JSON.parse(err.message);
          msg = parsed.error_description || parsed.error || msg;
        } catch (_) {}
        throw new OAuthError(msg, { code: 'token_exchange_failed', raw: { statusCode: err.statusCode } });
      }
      throw err;
    }

    const tokens = mapTokenResponse(tokenResponse);

    const meUrl = `${this._config.apiBase}/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))`;
    let me;
    try {
      me = await getJson(meUrl, tokens.accessToken, { retries: 1 });
    } catch (err) {
      if (err.name === 'ProviderClientError' && err.statusCode === 403) {
        me = { id: undefined, sub: undefined };
        const userinfoUrl = 'https://api.linkedin.com/v2/userinfo';
        try {
          const userinfo = await getJson(userinfoUrl, tokens.accessToken, { retries: 1 });
          me.id = userinfo.sub || userinfo.id;
          me.localizedFirstName = userinfo.given_name;
          me.localizedLastName = userinfo.family_name;
          me.picture = userinfo.picture;
          me.email = userinfo.email;
        } catch (_) {
          throw new OAuthError('Could not fetch LinkedIn profile after token exchange', { raw: err });
        }
      } else {
        throw err;
      }
    }
    if (!me.id && !me.sub) {
      throw new OAuthError('Could not fetch LinkedIn profile', { raw: me });
    }
    const profile = mapProfile(me);
    profile.platformUserId = (me.id || me.sub || '').replace(/^urn:li:person:/i, '') || profile.platformUserId;

    return { tokens, profile };
  }

  /**
   * Refresh access token. LinkedIn supports refresh_token grant for approved partners.
   * If not approved, LinkedIn may not return refresh_token; core should re-prompt connect.
   * @param {string} refreshToken
   * @returns {Promise<import('./types').TokenSet>}
   */
  async refreshToken(refreshToken) {
    if (!refreshToken) {
      throw new OAuthError('Refresh token is required', { code: 'missing_refresh_token' });
    }
    const body = await postForm(
      this._config.tokenUrl,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this._config.clientId,
        client_secret: this._config.clientSecret,
      },
      { retries: 0 }
    ).catch((err) => {
      if (err.name === 'ProviderClientError' && err.statusCode === 400) {
        let msg = err.message;
        try {
          const parsed = JSON.parse(err.message);
          msg = parsed.error_description || parsed.error || msg;
        } catch (_) {}
        throw new OAuthError(msg, { code: 'refresh_failed', raw: { statusCode: err.statusCode } });
      }
      throw err;
    });
    return mapTokenResponse(body);
  }

  /**
   * Publish UGC post (v2). Author is the authenticated member (from /v2/me).
   * @param {string} accessToken
   * @param {import('./types').PublishPayload} payload
   * @param {{ accountId?: string }} [options] - accountId unused for member posts
   * @returns {Promise<import('./types').PublishResult>}
   */
  async publishPost(accessToken, payload, options = {}) {
    if (!payload.text || payload.text.length > MAX_POST_TEXT_LENGTH) {
      throw new ProviderClientError(
        `Post text required and must be ≤ ${MAX_POST_TEXT_LENGTH} characters`,
        { statusCode: 400 }
      );
    }

    const me = await getJson(
      `${this._config.apiBase}/me?projection=(id)`,
      accessToken,
      { retries: 1 }
    );
    const author = options.accountId || getAuthorUrn(me);

    const visibility =
      payload.options?.visibility === 'CONNECTIONS'
        ? 'CONNECTIONS'
        : 'PUBLIC';
    const shareMediaCategory = getShareMediaCategory(payload);

    const shareContent = {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: payload.text.slice(0, MAX_POST_TEXT_LENGTH),
          attributes: [],
        },
        shareMediaCategory,
        media: [],
      },
    };

    if (payload.linkUrl) {
      shareContent['com.linkedin.ugc.ShareContent'].primaryLandingPageUrl =
        payload.linkUrl.slice(0, 2000);
    }

    // LinkedIn requires pre-uploaded asset URNs (digitalmediaAsset) for image/video.
    // Passing a URL is not supported for media; use linkUrl for link preview (ARTICLE) only.

    const body = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: shareContent,
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': visibility,
      },
    };

    const { data, headers, status } = await postJson(
      `${this._config.apiBase}/ugcPosts`,
      accessToken,
      body,
      {
        retries: 1,
        extraHeaders: { 'X-Restli-Protocol-Version': RESTLI_PROTOCOL_VERSION },
      }
    );

    const postId =
      data.id ||
      headers.get?.('x-restli-id') ||
      data.urn?.replace(/^urn:li:ugcPost:/i, '');
    if (!postId) {
      throw new ProviderClientError('LinkedIn did not return post id', {
        statusCode: status,
        raw: data,
      });
    }
    const platformPostId =
      typeof postId === 'string' && postId.startsWith('urn:li:')
        ? postId
        : `urn:li:ugcPost:${postId}`;
    const platformPostUrl = `https://www.linkedin.com/feed/update/${platformPostId.replace(/^urn:li:ugcPost:/, '')}`;

    return {
      platformPostId,
      platformPostUrl,
      publishedAt: new Date(),
      raw: data,
    };
  }

  /**
   * Fetch post analytics (memberCreatorPostAnalytics). Requires r_member_postAnalytics.
   * Returns null if app does not have access or post not found.
   * @param {string} accessToken
   * @param {string} platformPostId
   * @param {{ accountId?: string }} [_options]
   * @returns {Promise<import('./types').AnalyticsResult | null>}
   */
  async fetchAnalytics(accessToken, platformPostId, _options = {}) {
    const urn = toUgcPostUrn(platformPostId);
    const encodedUrn = encodeURIComponent(urn);
    const metrics = ['IMPRESSION', 'REACTION', 'COMMENT', 'RESHARE'];
    const baseUrl = 'https://api.linkedin.com/rest/memberCreatorPostAnalytics';
    const entityParam = `(ugc:${encodedUrn})`;
    const linkedinVersion = '202501';

    const results = {
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
    };
    let rawElements = [];

    for (const queryType of metrics) {
      const url = `${baseUrl}?q=entity&entity=${entityParam}&queryType=${queryType}&aggregation=TOTAL`;
      try {
        const data = await getJson(url, accessToken, {
          retries: 0,
          extraHeaders: {
            'X-Restli-Protocol-Version': RESTLI_PROTOCOL_VERSION,
            'Linkedin-Version': linkedinVersion,
          },
        });
        const elements = Array.isArray(data.elements) ? data.elements : [];
        rawElements = rawElements.concat(elements);
        for (const el of elements) {
          const count = typeof el.count === 'number' ? el.count : 0;
          const type =
            el.metricType?.[
              'com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1'
            ] || el.metricType;
          if (type === 'IMPRESSION') results.impressions += count;
          if (type === 'REACTION') results.likes += count;
          if (type === 'COMMENT') results.comments += count;
          if (type === 'RESHARE') results.shares += count;
        }
      } catch (err) {
        if (err.statusCode === 403 || err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    }

    results.engagement =
      results.likes + results.comments + results.shares;

    return {
      platformPostId: urn,
      metrics: results,
      fetchedAt: new Date(),
      raw: { elements: rawElements },
    };
  }
}

module.exports = { LinkedInProvider, PROVIDER_ID };
