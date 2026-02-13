/**
 * Token encryption/decryption (AES-256-GCM).
 * Used before saving to DB and after loading; providers never see this.
 * @module modules/connections/token.service
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const VERSION_PREFIX = 'v1';

/**
 * @param {string} key - Raw or base64 key (32 bytes for AES-256)
 * @returns {Buffer}
 */
function getKeyBuffer(key) {
  if (Buffer.isBuffer(key) && key.length === KEY_LENGTH) return key;
  if (typeof key === 'string') {
    if (key.length === KEY_LENGTH && /^[\x00-\xff]*$/.test(key)) {
      return Buffer.from(key, 'binary');
    }
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length === KEY_LENGTH) return decoded;
    return crypto.createHash('sha256').update(key).digest();
  }
  throw new Error('Token encryption key must be 32-byte buffer or base64 string');
}

class TokenService {
  /**
   * @param {string} [encryptionKey] - Env TOKEN_ENCRYPTION_KEY (base64 or raw)
   */
  constructor(encryptionKey) {
    this._key = getKeyBuffer(encryptionKey || process.env.TOKEN_ENCRYPTION_KEY);
  }

  /**
   * Encrypt plaintext; output format v1:base64(iv|authTag|ciphertext).
   * @param {string} plaintext
   * @returns {string}
   */
  encrypt(plaintext) {
    if (plaintext == null || plaintext === '') return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this._key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return `${VERSION_PREFIX}:${combined.toString('base64')}`;
  }

  /**
   * Decrypt value produced by encrypt().
   * @param {string} ciphertext
   * @returns {string}
   */
  decrypt(ciphertext) {
    if (ciphertext == null || ciphertext === '') return '';
    const parts = ciphertext.split(':');
    if (parts[0] !== VERSION_PREFIX || !parts[1]) {
      throw new Error('Invalid token ciphertext format');
    }
    const combined = Buffer.from(parts[1], 'base64');
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Token ciphertext too short');
    }
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, this._key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }
}

module.exports = { TokenService };
