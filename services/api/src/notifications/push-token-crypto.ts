import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFromEnvironment() {
  const encoded = process.env.PUSH_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('PUSH_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('PUSH_TOKEN_ENCRYPTION_KEY_INVALID');
  return key;
}

export function encryptPushToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnvironment(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptPushToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('PUSH_TOKEN_CIPHERTEXT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', keyFromEnvironment(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}
