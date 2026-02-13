/**
 * Auth middleware: attach user and organization from JWT or header (for testing).
 * @module middleware/auth
 */

/**
 * Expects Authorization: Bearer <jwt> or X-User-Id + X-Organization-Id (dev).
 * Decoded JWT should have sub (userId) and organizationId (or org_id).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const userId = req.headers['x-user-id'];
  const organizationId = req.headers['x-organization-id'];

  if (userId && organizationId) {
    req.user = { id: userId };
    req.organizationId = organizationId;
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = decodeJwtPayload(token);
    if (!payload.sub) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token payload' });
    }
    req.user = { id: payload.sub };
    req.organizationId = payload.organizationId || payload.org_id || null;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: err.message || 'Invalid token' });
  }
}

/**
 * Decode JWT without verify (verify should be done in production with a proper library).
 * For production, use jsonwebtoken.verify(token, secret).
 * @param {string} token
 * @returns {{ sub: string, organizationId?: string, org_id?: string }}
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload);
}

module.exports = { requireAuth };
