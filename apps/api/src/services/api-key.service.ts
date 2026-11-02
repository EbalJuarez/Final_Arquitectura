import {
  ApiKeyPermissionSchema,
  type ApiKey,
  type ApiKeyPermission,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from '@reservalab/shared';
import { AppError } from '../errors/app-error';
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from '../lib/api-keys';
import * as apiKeyRepository from '../repositories/api-key.repository';
import type { ApiKeyRecord } from '../repositories/api-key.repository';
import type { ApiKeyPrincipal } from '../types/express';

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

// Verifica la key de la cabecera X-API-Key: 401 si no existe o está revocada, 403 si le falta el permiso.
export async function authenticateApiKey(
  rawKey: string,
  permission: ApiKeyPermission,
  now = new Date(),
): Promise<ApiKeyPrincipal> {
  const record = rawKey.startsWith(API_KEY_PREFIX)
    ? await apiKeyRepository.findApiKeyByHash(hashApiKey(rawKey))
    : null;
  if (!record || record.revokedAt) {
    throw new AppError(401, 'INVALID_API_KEY', 'API key inválida o revocada');
  }

  const permissions = toPermissions(record.permissions);
  if (!permissions.includes(permission)) {
    throw new AppError(403, 'FORBIDDEN', `La API key no tiene el permiso ${permission}`);
  }

  // No se espera: la respuesta no se retrasa por esta escritura y un fallo solo se registra.
  apiKeyRepository.updateLastUsedAt(record.id, now).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[api-keys] No se pudo actualizar lastUsedAt de ${record.prefix}: ${reason}`);
  });

  return { id: record.id, prefix: record.prefix, permissions };
}
