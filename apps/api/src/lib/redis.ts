import { createClient } from 'redis';
import { env } from '../config/env';

// disableOfflineQueue: si Redis está caído los comandos fallan de inmediato en vez de quedar en cola.
export const redis = createClient({ url: env.REDIS_URL, disableOfflineQueue: true });

redis.on('error', (error: Error) => {
  console.error('[redis]', error.message);
});

// disableOfflineQueue no alcanza a las transacciones MULTI: node-redis las encola sin conexión y las
// ejecuta al reconectar (comprobado: con Redis detenido, un SET de la caché apareció al volver, con un
// dato calculado durante la caída). Antes de enviar comandos se exige una conexión lista, para fallar
// de inmediato y no escribir tarde datos viejos.
export function assertRedisReady(): void {
  if (!redis.isReady) {
    throw new Error('Redis no está conectado');
  }
}
