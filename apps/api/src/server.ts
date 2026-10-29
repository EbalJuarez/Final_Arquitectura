import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

async function main(): Promise<void> {
  await redis.connect();

  const server = createApp().listen(env.API_PORT, () => {
    console.log(`API escuchando en http://localhost:${env.API_PORT}/api/v1`);
  });

  const shutdown = async () => {
    server.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('No se pudo iniciar la API:', error);
  process.exit(1);
});
