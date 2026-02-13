/**
 * Config loader and validation.
 * @module config
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/postflow';
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!TOKEN_ENCRYPTION_KEY && NODE_ENV === 'production') {
  throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
}

module.exports = {
  REDIS_URL,
  MONGODB_URI,
  TOKEN_ENCRYPTION_KEY: TOKEN_ENCRYPTION_KEY || 'dev-32-byte-key-for-aes-256!!!!!!!!',
  FRONTEND_URL: FRONTEND_URL.replace(/\/$/, ''),
  NODE_ENV,
};
