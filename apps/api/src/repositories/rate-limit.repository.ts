import { redis } from '../lib/redis';

// Suma 1 al contador y le pone vencimiento en una sola transacción (MULTI/EXEC), así nunca queda
// un contador sin EXPIRE. NX: el vencimiento se fija solo en el primer incremento de la ventana.
// Devuelve el valor del contador después de incrementarlo.
export async function incrementCounter(key: string, ttlSeconds: number): Promise<number> {
  const [count] = await redis.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
  return Number(count);
}
