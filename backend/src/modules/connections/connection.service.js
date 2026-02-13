/**
 * Connections service: OAuth initiation, callback, token storage.
 * Uses ProviderRegistry, TokenService, OAuthStateStore, SocialAccount.
 * @module modules/connections/connection.service
 */

const providerRegistry = require('../../../lib/providers');
const { SocialAccount } = require('./connection.model');

/**
 * @param {Object} deps
 * @param {ReturnType<typeof import('./oauth-state.store').createOAuthStateStore>} deps.oauthStateStore
 * @param {InstanceType<typeof import('./token.service').TokenService>} deps.tokenService
 * @param {string} deps.frontendUrl
 */
function createConnectionService(deps) {
  const { oauthStateStore, tokenService, frontendUrl } = deps;

  /**
   * Start OAuth flow: get auth URL, persist state, return redirect URL.
   * @param {string} organizationId
   * @param {string} userId
   * @param {string} providerId
   * @returns {Promise<{ redirectUrl: string }>}
   */
  async function initiateConnect(organizationId, userId, providerId) {
    const provider = providerRegistry.get(providerId);
    if (!provider) {
      const e = new Error(`Unknown provider: ${providerId}`);
      e.code = 'UNKNOWN_PROVIDER';
      e.statusCode = 400;
      throw e;
    }
    const { url, state, pkceCodeVerifier } = await provider.getAuthUrl(organizationId, userId);
    await oauthStateStore.set(state, {
      state,
      organizationId,
      userId,
      providerId,
      pkceCodeVerifier,
      createdAt: Date.now(),
    });
    return { redirectUrl: url };
  }

  /**
   * Handle OAuth callback: exchange code, encrypt tokens, upsert SocialAccount, clear state.
   * @param {string} providerId
   * @param {{ code?: string, state?: string, error?: string, error_description?: string }} queryParams
   * @returns {Promise<{ redirectUrl: string }>}
   */
  async function handleCallback(providerId, queryParams) {
    const provider = providerRegistry.get(providerId);
    if (!provider) {
      const e = new Error(`Unknown provider: ${providerId}`);
      e.code = 'UNKNOWN_PROVIDER';
      e.statusCode = 400;
      throw e;
    }

    const state = queryParams.state;
    if (!state) {
      const e = new Error('Missing state parameter');
      e.code = 'MISSING_STATE';
      e.statusCode = 400;
      throw e;
    }

    const storedState = await oauthStateStore.get(state);
    if (!storedState) {
      const e = new Error('Invalid or expired state');
      e.code = 'INVALID_STATE';
      e.statusCode = 400;
      throw e;
    }

    if (storedState.providerId !== providerId) {
      const e = new Error('State provider mismatch');
      e.code = 'STATE_MISMATCH';
      e.statusCode = 400;
      throw e;
    }

    const payload = {
      code: queryParams.code,
      state: queryParams.state,
      error: queryParams.error,
      error_description: queryParams.error_description,
    };

    const { tokens, profile } = await provider.handleCallback(payload, storedState);

    const encryptedAccessToken = tokenService.encrypt(tokens.accessToken);
    const encryptedRefreshToken = tokens.refreshToken
      ? tokenService.encrypt(tokens.refreshToken)
      : null;

    const doc = {
      organizationId: storedState.organizationId,
      platform: providerId,
      platformUserId: profile.platformUserId,
      platformUsername: profile.username || null,
      displayName: profile.displayName || null,
      avatarUrl: profile.avatarUrl || null,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: tokens.expiresAt || null,
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
      status: 'active',
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastRefreshedAt: null,
    };

    await SocialAccount.findOneAndUpdate(
      {
        organizationId: storedState.organizationId,
        platform: providerId,
        platformUserId: profile.platformUserId,
      },
      { $set: doc },
      { upsert: true, new: true, runValidators: true }
    );

    await oauthStateStore.delete(state);

    const successPath = '/connections?connected=1';
    return { redirectUrl: `${frontendUrl}${successPath}` };
  }

  /**
   * Get decrypted access token; refresh if expired. Updates SocialAccount on refresh.
   * @param {string} socialAccountId
   * @returns {Promise<{ accessToken: string, socialAccount: import('mongoose').Document }>}
   */
  async function getValidAccessToken(socialAccountId) {
    const providerRegistry = require('../../../lib/providers');
    const account = await SocialAccount.findById(socialAccountId).lean();
    if (!account) {
      const e = new Error('Social account not found');
      e.code = 'ACCOUNT_NOT_FOUND';
      e.statusCode = 404;
      throw e;
    }
    if (account.status !== 'active' && account.status !== 'expired') {
      const e = new Error(`Account status: ${account.status}`);
      e.code = 'ACCOUNT_NOT_ACTIVE';
      e.statusCode = 400;
      throw e;
    }

    const bufferMinutes = 5;
    const now = new Date();
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    const needsRefresh = expiresAt && expiresAt.getTime() - bufferMinutes * 60 * 1000 <= now.getTime();

    let accessToken = tokenService.decrypt(account.accessToken);

    if (needsRefresh && account.refreshToken) {
      const provider = providerRegistry.get(account.platform);
      if (provider && typeof provider.refreshToken === 'function') {
        try {
          const refreshTokenPlain = tokenService.decrypt(account.refreshToken);
          const newTokens = await provider.refreshToken(refreshTokenPlain);
          const encryptedAccess = tokenService.encrypt(newTokens.accessToken);
          const encryptedRefresh = newTokens.refreshToken
            ? tokenService.encrypt(newTokens.refreshToken)
            : account.refreshToken;
          await SocialAccount.updateOne(
            { _id: socialAccountId },
            {
              $set: {
                accessToken: encryptedAccess,
                refreshToken: encryptedRefresh,
                tokenExpiresAt: newTokens.expiresAt || null,
                lastRefreshedAt: new Date(),
                status: 'active',
                lastErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
              },
            }
          );
          accessToken = newTokens.accessToken;
        } catch (err) {
          const isInvalidGrant =
            err.name === 'OAuthError' &&
            (err.message.includes('invalid_grant') || err.message.includes('expired') || err.code === 'refresh_failed');
          if (isInvalidGrant) {
            await SocialAccount.updateOne(
              { _id: socialAccountId },
              {
                $set: {
                  status: 'expired',
                  lastErrorAt: new Date(),
                  lastErrorCode: err.code || 'refresh_failed',
                  lastErrorMessage: (err.message || '').slice(0, 500),
                },
              }
            );
          }
          throw err;
        }
      }
    }

    if (needsRefresh && !account.refreshToken) {
      await SocialAccount.updateOne(
        { _id: socialAccountId },
        { $set: { status: 'expired', lastErrorAt: new Date(), lastErrorCode: 'NO_REFRESH_TOKEN' } }
      );
      const e = new Error('Token expired and no refresh token');
      e.code = 'TOKEN_EXPIRED';
      e.statusCode = 400;
      throw e;
    }

    return { accessToken, socialAccount: account };
  }

  return {
    initiateConnect,
    handleCallback,
    getValidAccessToken,
  };
}

module.exports = { createConnectionService };
