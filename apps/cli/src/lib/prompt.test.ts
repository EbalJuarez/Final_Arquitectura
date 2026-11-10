import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askCredentials } from './prompt';

// process.stdin se reemplaza por un stream controlado por la prueba; stderr se captura.

type FakeStdin = PassThrough & { isTTY?: boolean; setRawMode: ReturnType<typeof vi.fn> };

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
let stdin: FakeStdin;
let stderr: string;

function useStdin(isTTY: boolean): FakeStdin {
  stdin = Object.assign(new PassThrough(), { isTTY, setRawMode: vi.fn() });
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  return stdin;
}

// Espera a que el prompt haya escrito el texto indicado en stderr
async function waitFor(text: string): Promise<void> {
  await vi.waitFor(() => expect(stderr).toContain(text));
}

beforeEach(() => {
  stderr = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'stdin', originalStdin);
});

describe('entrada que no es terminal (pipe)', () => {
  it('lee el correo y la contraseña de las dos primeras líneas; el correo sin espacios', async () => {
    useStdin(false);
    const credentials = askCredentials();
    stdin.end('  admin@reservalab.test  \n mi clave \n');

    await expect(credentials).resolves.toEqual({ email: 'admin@reservalab.test', password: ' mi clave ' });
    expect(stdin.setRawMode).not.toHaveBeenCalled();
    expect(stderr).toBe('');
  });

  it('si faltan líneas devuelve cadenas vacías', async () => {
    useStdin(false);
    const credentials = askCredentials();
    stdin.end('');

    await expect(credentials).resolves.toEqual({ email: '', password: '' });
  });
});

describe('terminal', () => {
  it('pregunta el correo y lee la contraseña sin eco, con Backspace', async () => {
    useStdin(true);
    const credentials = askCredentials();

    await waitFor('Correo: ');
    stdin.write(' docente@reservalab.test \n');
    await waitFor('Contraseña: ');
    stdin.write('secretx\u007f');
    stdin.write('a\bo\r');

    await expect(credentials).resolves.toEqual({ email: 'docente@reservalab.test', password: 'secreto' });
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stderr).not.toContain('secret');
    expect(stderr.endsWith('Contraseña: \n')).toBe(true);
  });

  it('ignora los caracteres de control y termina con salto de línea', async () => {
    useStdin(true);
    const credentials = askCredentials();

    await waitFor('Correo: ');
    stdin.write('a@b.test\n');
    await waitFor('Contraseña: ');
    stdin.write('x\u001by\n');

    await expect(credentials).resolves.toEqual({ email: 'a@b.test', password: 'xy' });
  });

  it('Ctrl+C cancela y restaura el modo de la terminal', async () => {
    useStdin(true);
    const credentials = askCredentials();

    await waitFor('Correo: ');
    stdin.write('a@b.test\n');
    await waitFor('Contraseña: ');
    stdin.write('abc\u0003');

    await expect(credentials).rejects.toThrow('Cancelado por el usuario');
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.listenerCount('data')).toBe(0);
  });
});
