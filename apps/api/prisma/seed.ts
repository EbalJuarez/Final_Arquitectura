import { hash } from '@node-rs/argon2';
import { PrismaClient, type Role } from '@prisma/client';

// Crea un usuario de prueba por rol. Es idempotente: si el email ya existe no lo toca.
const prisma = new PrismaClient();

const users: { email: string; name: string; role: Role }[] = [
  { email: 'admin@reservalab.test', name: 'Administrador', role: 'ADMIN' },
  { email: 'docente@reservalab.test', name: 'Docente de Prueba', role: 'DOCENTE' },
  { email: 'estudiante@reservalab.test', name: 'Estudiante de Prueba', role: 'ESTUDIANTE' },
];

async function main(): Promise<void> {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('SEED_USER_PASSWORD debe existir en .env y tener al menos 8 caracteres');
  }

  const passwordHash = await hash(password);
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash },
    });
    console.log(`  ✔ ${user.role.padEnd(10)} ${user.email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
