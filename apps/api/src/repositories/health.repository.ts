import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function pingRedis(): Promise<void> {
  await redis.ping();
}
