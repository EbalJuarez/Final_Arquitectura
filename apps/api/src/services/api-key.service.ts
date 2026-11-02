import {
  ApiKeyPermissionSchema,
  type ApiKey,
  type ApiKeyPermission,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import { generateApiKey, hashApiKey } from '../lib/api-keys';
import * as apiKeyRepository from '../repositories/api-key.repository';
import type { ApiKeyRecord } from '../repositories/api-key.repository';

// La base guarda los permisos como texto; se ignora cualquiera que ya no exista en el catálogo.
function toPermissions(values: string[]): ApiKeyPermission[] {
  return values.filter((value): value is ApiKeyPermission => ApiKeyPermissionSchema.safeParse(value).success);
}

// Nunca incluye la key ni su hash.
export function toApiKey(record: ApiKeyRecord): ApiKey {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    permissions: toPermissions(record.permissions),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

// La key completa solo existe en esta respuesta; en la base queda su hash.
export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const { key, prefix } = generateApiKey();
  const record = await apiKeyRepository.createApiKey({
    name: input.name,
    prefix,
    keyHash: hashApiKey(key),
    permissions: input.permissions,
  });
  return { ...toApiKey(record), key };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return (await apiKeyRepository.listApiKeys()).map(toApiKey);
}

export async function revokeApiKey(id: string, now = new Date()): Promise<ApiKey> {
  const existing = await apiKeyRepository.findApiKeyById(id);
  if (!existing) {
    throw new AppError(404, 'API_KEY_NOT_FOUND', 'La API key no existe');
  }

  // Si otra solicitud la revocó entre la consulta y la actualización, también es 409.
  const revoked = existing.revokedAt ? null : await apiKeyRepository.revokeApiKey(id, now);
  if (!revoked) {
    throw new AppError(409, 'API_KEY_ALREADY_REVOKED', 'La API key ya estaba revocada');
  }
  return toApiKey(revoked);
}
