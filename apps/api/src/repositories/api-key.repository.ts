import type { ApiKey } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Los servicios usan este tipo en lugar de importar @prisma/client.
export type ApiKeyRecord = ApiKey;

export interface CreateApiKeyData {
  name: string;
  prefix: string;
  keyHash: string;
  permissions: string[];
}

export function createApiKey(data: CreateApiKeyData): Promise<ApiKeyRecord> {
  return prisma.apiKey.create({ data });
}

export function listApiKeys(): Promise<ApiKeyRecord[]> {
  return prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
}

export function findApiKeyById(id: string): Promise<ApiKeyRecord | null> {
  return prisma.apiKey.findUnique({ where: { id } });
}

export function findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
  return prisma.apiKey.findUnique({ where: { keyHash } });
}

// Revoca la key solo si sigue activa; devuelve la key revocada o null si ya lo estaba.
export async function revokeApiKey(id: string, now: Date): Promise<ApiKeyRecord | null> {
  const result = await prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  return result.count === 0 ? null : prisma.apiKey.findUnique({ where: { id } });
}

export async function updateLastUsedAt(id: string, now: Date): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: now } });
}
