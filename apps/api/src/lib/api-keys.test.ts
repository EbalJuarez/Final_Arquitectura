import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from './api-keys';

describe('generateApiKey', () => {
  it('genera rl_live_ + 32 bytes en base64url y un prefijo de 16 caracteres', () => {
    const { key, prefix } = generateApiKey();

    expect(key).toMatch(/^rl_live_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(key.slice('rl_live_'.length), 'base64url')).toHaveLength(32);
    expect(prefix).toBe(key.slice(0, 16));
  });

  it('genera una key distinta cada vez', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));

    expect(keys.size).toBe(50);
  });
});

describe('hashApiKey', () => {
  it('devuelve el SHA-256 en hexadecimal, estable para la misma key', () => {
    const hash = hashApiKey('rl_live_ejemplo');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('rl_live_ejemplo')).toBe(hash);
    expect(hashApiKey('rl_live_otra')).not.toBe(hash);
  });
});
