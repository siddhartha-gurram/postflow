/**
 * Publish routes: trigger publish job (e.g. "publish now" or called by scheduler).
 * @module modules/publishing/publish.routes
 */

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { Post } = require('../content/post.model');

/**
 * @param {express.Router} router
 * @param {import('bullmq').Queue} publishQueue
 */
function mountPublishRoutes(router, publishQueue) {
  /**
   * POST /publish/:postId — Enqueue publish job. Auth required.
   */
  router.post('/:postId', requireAuth, async (req, res, next) => {
    try {
      const postId = req.params.postId;
      const organizationId = req.query.organizationId || req.organizationId;
      if (!organizationId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'organizationId required' });
      }
      const post = await Post.findOne({ _id: postId, organizationId }).lean();
      if (!post) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Post not found' });
      }
      await publishQueue.add('publish', { postId }, { jobId: `publish:${postId}:${Date.now()}` });
      return res.status(202).json({ message: 'Publish job enqueued', postId });
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { mountPublishRoutes };
