/**
 * Publish service: load post and accounts, decrypt/refresh token, call provider, persist result.
 * Handles 429 (requeue), 5xx (retry), invalid_grant (mark account expired).
 * @module modules/publishing/publish.service
 */

const providerRegistry = require('../../../lib/providers');
const { ProviderRateLimitError, OAuthError } = require('../../../lib/errors');
const { Post } = require('../content/post.model');
const { PublishResult } = require('./publishResult.model');
const { SocialAccount } = require('../connections/connection.model');

/**
 * @param {Object} deps
 * @param {ReturnType<typeof import('../connections/connection.service').createConnectionService>} deps.connectionService
 */
function createPublishService(deps) {
  const { connectionService } = deps;

  /**
   * Build PublishPayload from Post document (and optional variant per account).
   * @param {import('mongoose').Document} post
   * @param {string} [socialAccountId]
   */
  function buildPayload(post, socialAccountId) {
    const content = post.content || {};
    let text = content.text || '';
    let linkUrl = content.linkUrl;
    const variants = post.variants || [];
    const variant = socialAccountId
      ? variants.find((v) => String(v.socialAccountId) === String(socialAccountId))
      : null;
    if (variant && variant.text) text = variant.text;
    if (variant && variant.linkUrl) linkUrl = variant.linkUrl;

    return {
      text,
      linkUrl,
      linkTitle: content.linkTitle,
      media: (post.media || []).map((m) => ({ type: m.type, url: m.url, key: m.key })),
      options: { visibility: post.content?.visibility },
    };
  }

  /**
   * Publish post to a single social account. Throws ProviderRateLimitError (requeue with delay),
   * ProviderServerError (retry), or on invalid_grant the connection service marks account expired.
   * @param {string} postId
   * @param {string} socialAccountId
   * @returns {Promise<{ platformPostId: string, platformPostUrl?: string }>}
   */
  async function publishPostToAccount(postId, socialAccountId) {
    const post = await Post.findById(postId).lean();
    if (!post) {
      const e = new Error('Post not found');
      e.code = 'POST_NOT_FOUND';
      throw e;
    }
    if (!['scheduled', 'queued', 'publishing'].includes(post.status)) {
      const e = new Error(`Post not in publishable status: ${post.status}`);
      e.code = 'INVALID_POST_STATE';
      throw e;
    }

    const account = await SocialAccount.findById(socialAccountId).lean();
    if (!account) {
      const e = new Error('Social account not found');
      e.code = 'ACCOUNT_NOT_FOUND';
      throw e;
    }
    if (account.status !== 'active' && account.status !== 'expired') {
      const e = new Error(`Account not publishable: ${account.status}`);
      e.code = 'ACCOUNT_NOT_ACTIVE';
      throw e;
    }

    const provider = providerRegistry.get(account.platform);
    if (!provider) {
      const e = new Error(`No provider for platform: ${account.platform}`);
      e.code = 'UNKNOWN_PROVIDER';
      throw e;
    }

    let accessToken;
    try {
      const result = await connectionService.getValidAccessToken(socialAccountId);
      accessToken = result.accessToken;
    } catch (err) {
      if (err.name === 'OAuthError' || err.code === 'TOKEN_EXPIRED') {
        await PublishResult.findOneAndUpdate(
          { postId, socialAccountId },
          {
            $set: {
              postId,
              socialAccountId,
              organizationId: post.organizationId,
              status: 'failed',
              errorCode: err.code || 'TOKEN_EXPIRED',
              errorMessage: (err.message || '').slice(0, 1000),
            },
          },
          { upsert: true, new: true }
        );
        throw err;
      }
      throw err;
    }

    const payload = buildPayload(post, socialAccountId);

    try {
      const result = await provider.publishPost(accessToken, payload, {
        accountId: account.metadata?.pageId || undefined,
      });

      await PublishResult.findOneAndUpdate(
        { postId, socialAccountId },
        {
          $set: {
            postId,
            socialAccountId,
            organizationId: post.organizationId,
            status: 'published',
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
            publishedAt: result.publishedAt,
          },
        },
        { upsert: true, new: true }
      );

      return { platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl };
    } catch (err) {
      if (err instanceof ProviderRateLimitError) {
        throw err;
      }
      if (err.name === 'OAuthError') {
        throw err;
      }
      await PublishResult.findOneAndUpdate(
        { postId, socialAccountId },
        {
          $set: {
            postId,
            socialAccountId,
            organizationId: post.organizationId,
            status: 'failed',
            errorCode: err.code || err.name,
            errorMessage: (err.message || '').slice(0, 1000),
          },
        },
        { upsert: true }
      );
      throw err;
    }
  }

  /**
   * Publish post to all target social accounts. Updates post status to publishing, then published/failed.
   * @param {string} postId
   */
  async function publishPost(postId) {
    const post = await Post.findById(postId);
    if (!post) {
      const e = new Error('Post not found');
      e.code = 'POST_NOT_FOUND';
      throw e;
    }

    const accountIds = post.socialAccountIds && post.socialAccountIds.length > 0
      ? post.socialAccountIds
      : [];
    if (accountIds.length === 0) {
      await Post.updateOne(
        { _id: postId },
        { $set: { status: 'failed', failureCode: 'NO_ACCOUNTS', failureReason: 'No social accounts' } }
      );
      return;
    }

    await Post.updateOne({ _id: postId }, { $set: { status: 'publishing' } });

    const results = [];
    let anySuccess = false;
    let lastError;
    let rateLimitError;

    for (const socialAccountId of accountIds) {
      try {
        const r = await publishPostToAccount(postId, socialAccountId);
        results.push({ socialAccountId, success: true, ...r });
        anySuccess = true;
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          rateLimitError = err;
          break;
        }
        lastError = err;
        results.push({
          socialAccountId,
          success: false,
          errorCode: err.code,
          errorMessage: err.message,
        });
      }
    }

    if (rateLimitError) {
      await Post.updateOne({ _id: postId }, { $set: { status: 'scheduled' } });
      throw rateLimitError;
    }

    const newStatus = anySuccess ? 'published' : 'failed';
    await Post.updateOne(
      { _id: postId },
      {
        $set: {
          status: newStatus,
          publishedAt: anySuccess ? new Date() : undefined,
          failureReason: anySuccess ? undefined : (lastError?.message || 'Publish failed'),
          failureCode: anySuccess ? undefined : (lastError?.code || 'PUBLISH_FAILED'),
        },
      }
    );
  }

  return { publishPost, publishPostToAccount };
}

module.exports = { createPublishService };
