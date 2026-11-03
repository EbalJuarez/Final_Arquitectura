import {
  ApiKeyPermissionSchema,
  ApiKeySchema,
  CreateApiKeySchema,
  CreatedApiKeySchema,
  IdParamsSchema,
  type ApiKey,
} from '@reservalab/shared';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../lib/context';
import { parseInput } from '../lib/context';
import { printJson, printMessage, printTable } from '../lib/output';

const KEY_WARNING = [
  '',
  '¡ATENCIÓN! Esta es la ÚNICA vez que se muestra la API key completa.',
  'Cópiala ahora a un lugar seguro: la API solo guarda su hash y no se puede recuperar.',
  'Si se pierde o se filtra, revócala con `keys revoke <id>` y crea otra.',
].join('\n');

const toRow = (key: ApiKey) => ({
  ID: key.id,
  Nombre: key.name,
  Prefijo: key.prefix,
  Permisos: key.permissions.join(','),
  Estado: key.revokedAt ? 'revocada' : 'activa',
  'Último uso': key.lastUsedAt,
  Creada: key.createdAt,
});

export function registerKeys(program: Command, context: () => Context): void {
  const keys = program.command('keys').description('API keys de sistemas externos');
  const permissions = ApiKeyPermissionSchema.options.join(', ');

  keys
    .command('create')
    .description('Crea una API key; la key completa se muestra una sola vez')
    .requiredOption('--name <nombre>', 'para qué sistema es, por ejemplo "Pantalla del Edificio A"')
    .requiredOption('--permissions <permisos...>', `uno o más de: ${permissions} (separados por espacio o coma)`)
    .action(async (options: { name: string; permissions: string[] }) => {
      const { client, json } = context();
      const input = parseInput(CreateApiKeySchema, {
        name: options.name,
        permissions: options.permissions.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean),
      });

      const created = await client.request('POST', '/api-keys', { body: input, schema: CreatedApiKeySchema });
      if (json) {
        printJson(created);
      } else {
        printMessage(`API key creada: ${created.name} (id ${created.id})`);
        printMessage(`Permisos: ${created.permissions.join(', ')}\n`);
        // La key va a stdout y los avisos a stderr, para poder redirigirla a un archivo
        process.stdout.write(`${created.key}\n`);
      }
      printMessage(KEY_WARNING);
    });

  keys
    .command('list')
    .description('Lista las API keys (nunca muestra la key, solo su prefijo)')
    .action(async () => {
      const { client, json } = context();
      const list = await client.request('GET', '/api-keys', { schema: z.array(ApiKeySchema) });
      if (json) printJson(list);
      else printTable(list.map(toRow), 'No hay API keys.');
    });

  keys
    .command('revoke <id>')
    .description('Revoca una API key; deja de funcionar de inmediato')
    .action(async (id: string) => {
      const { client, json } = context();
      parseInput(IdParamsSchema, { id });

      const key = await client.request('DELETE', `/api-keys/${id}`, { schema: ApiKeySchema });
      if (json) printJson(key);
      else printMessage(`API key ${key.prefix}… (${key.name}) revocada.`);
    });
}
