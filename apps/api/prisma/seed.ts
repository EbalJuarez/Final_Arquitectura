import { hash } from '@node-rs/argon2';
import { PrismaClient, type Role } from '@prisma/client';
import { hashApiKey } from '../src/lib/api-keys';

// Crea un usuario de prueba por rol y la API key de la pantalla informativa de la demo.
// Es idempotente: si el email o la key ya existen no los toca.
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

  await seedInfoScreenKey();
}

// Formato de las keys que emite la API: rl_live_ + 32 bytes en base64url
const API_KEY_FORMAT = /^rl_live_[A-Za-z0-9_-]{43}$/;

// La web se construye con VITE_INFO_API_KEY para consultar GET /now. Aquí se guarda su hash (nunca la
// key) con SOLO el permiso read:now: aunque la key quede dentro del JavaScript público de la web, no
// sirve para nada más.
async function seedInfoScreenKey(): Promise<void> {
  const key = process.env.VITE_INFO_API_KEY;
  if (!key || !API_KEY_FORMAT.test(key)) {
    console.log('  - VITE_INFO_API_KEY falta o no tiene el formato rl_live_…: no se crea la key de la pantalla informativa');
    return;
  }
  const keyHash = hashApiKey(key);
  await prisma.apiKey.upsert({
    where: { keyHash },
    update: {},
    create: {
      name: 'Pantalla informativa (demo)',
      prefix: key.slice(0, 16),
      keyHash,
      permissions: ['read:now'],
    },
  });
  console.log(`  ✔ API key   ${key.slice(0, 16)}… (solo read:now) para la pantalla informativa`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
