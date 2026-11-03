import { Command } from 'commander';
import { registerKeys } from './commands/keys';
import { registerLogin } from './commands/login';
import { registerSpaces } from './commands/spaces';
import { createContext } from './lib/context';
import { printError } from './lib/output';

// CLI de administración de ReservaLab. Solo habla con la API por HTTP (RESERVALAB_API_URL); nunca
// accede a la base de datos.

const program = new Command('reservalab')
  .description('Herramienta de administración de ReservaLab. URL de la API: RESERVALAB_API_URL (por defecto http://localhost:3000).')
  .option('--json', 'salida en JSON para procesarla con otras herramientas')
  .helpOption('-h, --help', 'muestra la ayuda')
  .helpCommand('help [comando]', 'muestra la ayuda de un comando')
  .showHelpAfterError();

const context = () => createContext(Boolean(program.opts<{ json?: boolean }>().json));

registerLogin(program, context);
registerSpaces(program, context);
registerKeys(program, context);

try {
  await program.parseAsync();
} catch (error) {
  process.exitCode = printError(error, Boolean(program.opts<{ json?: boolean }>().json));
}
