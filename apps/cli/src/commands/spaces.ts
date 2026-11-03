import { CreateSpaceSchema, IdParamsSchema, SpaceFiltersSchema, SpaceSchema, type Space } from '@reservalab/shared';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../lib/context';
import { parseInput } from '../lib/context';
import { printJson, printMessage, printTable } from '../lib/output';

const toRow = (space: Space) => ({
  ID: space.id,
  Nombre: space.name,
  Edificio: space.building,
  Capacidad: space.capacity,
});

export function registerSpaces(program: Command, context: () => Context): void {
  const spaces = program.command('spaces').description('Laboratorios y salones');

  spaces
    .command('list')
    .description('Lista los espacios')
    .option('--building <edificio>', 'solo los de este edificio (sin distinguir mayúsculas)')
    .option('--min-capacity <n>', 'capacidad mínima')
    .action(async (options: { building?: string; minCapacity?: string }) => {
      const { client, json } = context();
      const filters = parseInput(SpaceFiltersSchema, options);
      const query = new URLSearchParams();
      if (filters.building) query.set('building', filters.building);
      if (filters.minCapacity) query.set('minCapacity', String(filters.minCapacity));
      const suffix = query.size > 0 ? `?${query}` : '';

      const list = await client.request('GET', `/spaces${suffix}`, { schema: z.array(SpaceSchema) });
      if (json) printJson(list);
      else printTable(list.map(toRow), 'No hay espacios que cumplan los filtros.');
    });

  spaces
    .command('create')
    .description('Crea un espacio')
    .requiredOption('--name <nombre>', 'nombre del espacio')
    .requiredOption('--building <edificio>', 'edificio')
    .requiredOption('--capacity <n>', 'capacidad (personas)')
    .action(async (options: { name: string; building: string; capacity: string }) => {
      const { client, json } = context();
      const input = parseInput(CreateSpaceSchema, { ...options, capacity: Number(options.capacity) });

      const space = await client.request('POST', '/spaces', { body: input, schema: SpaceSchema });
      if (json) {
        printJson(space);
      } else {
        printMessage('Espacio creado:');
        printTable([toRow(space)], '');
      }
    });

  spaces
    .command('delete <id>')
    .description('Borra un espacio sin reservas confirmadas vigentes o futuras')
    .action(async (id: string) => {
      const { client, json } = context();
      parseInput(IdParamsSchema, { id });

      await client.request('DELETE', `/spaces/${id}`);
      if (json) printJson({ id, deleted: true });
      else printMessage(`Espacio ${id} borrado.`);
    });
}
