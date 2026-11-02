import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Role } from '@reservalab/shared';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';
import { signAccessToken } from '../../src/lib/tokens';

// Utilidades compartidas por las pruebas de integración. Cada archivo crea sus propios datos con un
// identificador de ejecución y los borra al terminar, sin tocar los del seed.

export function newRunId(): string {
  return randomUUID().slice(0, 8);
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

// Levanta la app real en un puerto libre y conecta Redis, como hace server.ts.
export async function startTestServer(): Promise<TestServer> {
  if (!redis.isOpen) {
    await redis.connect();
  }
  const server: Server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    },
  };
}

// Usuario propio de la ejecución con un access token válido para su rol.
export async function createTestUser(runId: string, role: Role): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `integracion-${role.toLowerCase()}-${runId}@reservalab.test`,
      name: 'Prueba de integración',
      passwordHash: 'no-se-usa',
      role,
    },
  });
  return { id: user.id, token: signAccessToken({ id: user.id, role }) };
}
