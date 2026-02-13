/**
 * LinkedIn provider configuration.
 * Load from env; validate at startup.
 * @module config/providers/linkedin
 */

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

/**
 * Scopes required for PostFlow LinkedIn integration:
 * - openid, profile, email: Sign in with LinkedIn / lite profile (v2)
 * - w_member_social: Create UGC posts on behalf of the member
 * Note: Analytics (e.g. memberCreatorPostAnalytics) may require additional
 * Marketing Developer Platform product access.
 */
const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
];

/**
 * @param {Record<string, string|undefined>} env - Process env or object with keys
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string, scopes: string[], authUrl: string, tokenUrl: string, apiBase: string }}
 */
function getLinkedInConfig(env = process.env) {
  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'LinkedIn provider requires LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and LINKEDIN_REDIRECT_URI'
    );
  }

  const scopes = (env.LINKEDIN_SCOPES || DEFAULT_SCOPES.join(' ')).trim().split(/\s+/).filter(Boolean);
  if (scopes.length === 0) {
    scopes.push(...DEFAULT_SCOPES);
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    authUrl: LINKEDIN_AUTH_URL,
    tokenUrl: LINKEDIN_TOKEN_URL,
    apiBase: LINKEDIN_API_BASE,
  };
}

module.exports = {
  getLinkedInConfig,
  LINKEDIN_AUTH_URL,
  LINKEDIN_TOKEN_URL,
  LINKEDIN_API_BASE,
  DEFAULT_SCOPES,
};
