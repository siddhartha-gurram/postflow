/**
 * Connections controller: connect initiation and OAuth callback.
 * @module modules/connections/connection.controller
 */

/**
 * @param {ReturnType<typeof import('./connection.service').createConnectionService>} connectionService
 */
function createConnectionController(connectionService) {
  /**
   * GET /connections/connect/:providerId
   * Query: organizationId (required). Auth required.
   */
  async function connect(req, res, next) {
    try {
      const providerId = req.params.providerId;
      const organizationId = req.query.organizationId || req.organizationId;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'organizationId and authenticated user required',
        });
      }

      const { redirectUrl } = await connectionService.initiateConnect(
        organizationId,
        userId,
        providerId
      );
      return res.redirect(302, redirectUrl);
    } catch (err) {
      if (err.code === 'UNKNOWN_PROVIDER') {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      next(err);
    }
  }

  /**
   * GET /connections/callback/:providerId
   * Query: code, state (or error, error_description). No auth.
   */
  async function callback(req, res, next) {
    try {
      const providerId = req.params.providerId;
      const queryParams = {
        code: req.query.code,
        state: req.query.state,
        error: req.query.error,
        error_description: req.query.error_description,
      };

      const { redirectUrl } = await connectionService.handleCallback(providerId, queryParams);
      return res.redirect(302, redirectUrl);
    } catch (err) {
      if (err.code === 'INVALID_STATE' || err.code === 'STATE_MISMATCH' || err.code === 'MISSING_STATE') {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      if (err.name === 'OAuthError') {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        return res.redirect(302, `${frontendUrl}/connections?error=oauth_denied`);
      }
      next(err);
    }
  }

  return { connect, callback };
}

module.exports = { createConnectionController };
