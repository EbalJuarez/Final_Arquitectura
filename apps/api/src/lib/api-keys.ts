import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'rl_live_';

// Caracteres que se guardan para identificar la key en listados: "rl_live_" + 8 caracteres aleatorios.
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

// rl_live_ + 32 bytes aleatorios en base64url (43 caracteres)
export function generateApiKey(): { key: string; prefix: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

// En la base solo se guarda el hash SHA-256 de la key.
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
