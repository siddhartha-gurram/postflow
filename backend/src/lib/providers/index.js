/**
 * Provider registry: get/list providers by id.
 * @module lib/providers
 */

const { LinkedInProvider } = require('./linkedin.provider');
const { getLinkedInConfig } = require('../../config/providers/linkedin');

const registry = new Map();

function register(provider) {
  if (!provider || !provider.id) {
    throw new Error('Provider must have id');
  }
  registry.set(provider.id, provider);
}

function get(providerId) {
  return registry.get(providerId) || null;
}

function list() {
  return Array.from(registry.keys());
}

// Register LinkedIn when this module is loaded (if env is configured)
function registerDefaultProviders() {
  try {
    const config = getLinkedInConfig(process.env);
    register(new LinkedInProvider(config));
  } catch (err) {
    if (process.env.NODE_ENV === 'production') throw err;
  }
}
registerDefaultProviders();

module.exports = {
  register,
  get,
  list,
  registry,
};
