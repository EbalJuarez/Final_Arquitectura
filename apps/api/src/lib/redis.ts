import { createClient } from 'redis';
import { env } from '../config/env';

// disableOfflineQueue: si Redis está caído los comandos fallan de inmediato en vez de quedar en cola.
export const redis = createClient({ url: env.REDIS_URL, disableOfflineQueue: true });

redis.on('error', (error: Error) => {
  console.error('[redis]', error.message);
});
