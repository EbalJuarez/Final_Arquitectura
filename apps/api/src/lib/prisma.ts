import { PrismaClient } from '@prisma/client';

// Única instancia de Prisma; solo la importan los repositorios.
export const prisma = new PrismaClient();
