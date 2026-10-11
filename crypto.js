const crypto = require('crypto');

// AES-256-GCM: 32-byte key (64 hex chars in ENCRYPTION_KEY),
// 12-byte IV, 16-byte auth tag (see encrypt/decrypt below).
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is not set');
  }
  return Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together so we can decrypt later
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

module.exports = { encrypt };

function decrypt(encryptedBase64) {
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };