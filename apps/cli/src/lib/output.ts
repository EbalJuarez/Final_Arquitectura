import { ApiError, CliError } from './errors';

// Salida del CLI: los datos van a stdout (tabla legible, o JSON con --json) y los avisos y errores a
// stderr, para que la salida de --json se pueda procesar sin mezclar mensajes.

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

type Cell = string | number | null;

// Tabla de texto con columnas alineadas
export function printTable(rows: Record<string, Cell>[], emptyMessage: string): void {
  if (rows.length === 0) {
    process.stdout.write(`${emptyMessage}\n`);
    return;
  }
  const columns = Object.keys(rows[0]!);
  const text = (value: Cell | undefined) => (value === null || value === undefined ? '-' : String(value));
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => text(row[column]).length)));
  const line = (values: string[]) => values.map((value, i) => value.padEnd(widths[i]!)).join('  ').trimEnd();

  process.stdout.write(`${line(columns)}\n${line(widths.map((width) => '-'.repeat(width)))}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(columns.map((column) => text(row[column])))}\n`);
  }
}

export function printMessage(message: string): void {
  process.stderr.write(`${message}\n`);
}

// Muestra el error de forma legible (o en JSON con --json) y devuelve el código de salida
export function printError(error: unknown, json: boolean): number {
  const status = error instanceof ApiError ? error.status : undefined;
  const body =
    error instanceof CliError
      ? { code: error.code, message: error.message, details: error.details }
      : { code: 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) };

  if (json) {
    process.stderr.write(`${JSON.stringify({ error: { ...body, status } })}\n`);
  } else {
    process.stderr.write(`Error ${body.code}${status ? ` (HTTP ${status})` : ''}: ${body.message}\n`);
    for (const detail of ('details' in body && body.details) || []) {
      process.stderr.write(`  - ${detail.field || '(cuerpo)'}: ${detail.message}\n`);
    }
  }
  return 1;
}
