import { Prisma, type Role, type User } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Los servicios usan este tipo en lugar de importar @prisma/client.
export type UserRecord = User;

export interface CreateUserData {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

// Devuelve null si el correo ya existe (restricción única), sin carreras entre dos registros simultáneos.
export async function createUser(data: CreateUserData): Promise<User | null> {
  try {
    return await prisma.user.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  }
}
