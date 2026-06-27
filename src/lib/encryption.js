'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || '';
  if (!raw || raw === '0'.repeat(64)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    console.warn('[Encryption] WARNING: using insecure default key — set ENCRYPTION_KEY in .env');
    return Buffer.from('0'.repeat(64), 'hex');
  }
  return Buffer.from(raw, 'hex');
}

const KEY = getKey();

function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const buf     = Buffer.from(ciphertext, 'base64');
  const iv      = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const data    = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
