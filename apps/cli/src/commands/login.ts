import { LoginResponseSchema, LoginSchema, PublicUserSchema } from '@reservalab/shared';
import type { Command } from 'commander';
import { configPath, writeConfig } from '../lib/config';
import type { Context } from '../lib/context';
import { parseInput } from '../lib/context';
import { printJson, printMessage } from '../lib/output';
import { askCredentials } from '../lib/prompt';

export function registerLogin(program: Command, context: () => Context): void {
  program
    .command('login')
    .description('Inicia sesión y guarda los tokens en ~/.reservalab/config.json')
    .action(async () => {
      const { apiUrl, client, json } = context();
      const credentials = parseInput(LoginSchema, await askCredentials());

      const tokens = await client.request('POST', '/auth/login', {
        body: credentials,
        schema: LoginResponseSchema,
        auth: false,
      });
      await writeConfig({ apiUrl, email: credentials.email, ...tokens });

      const user = await client.request('GET', '/auth/me', { schema: PublicUserSchema });
      if (json) {
        printJson({ user, configPath: configPath() });
      } else {
        printMessage(`Sesión iniciada como ${user.name} <${user.email}> (${user.role}) en ${apiUrl}`);
        printMessage(`Tokens guardados en ${configPath()}`);
      }
      if (user.role !== 'ADMIN') {
        printMessage('Aviso: este usuario no es ADMIN; los comandos de espacios y API keys responderán 403.');
      }
    });
}
