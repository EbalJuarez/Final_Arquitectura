import { createInterface } from 'node:readline/promises';

// Pide correo y contraseña. En una terminal la contraseña se lee sin eco: no se muestra nada al
// escribirla. Si la entrada no es una terminal (un pipe en un script), se leen dos líneas: correo y
// contraseña.

export interface Credentials {
  email: string;
  password: string;
}

export async function askCredentials(): Promise<Credentials> {
  const input = process.stdin;
  const output = process.stderr;

  if (!input.isTTY) {
    const lines = createInterface({ input, terminal: false })[Symbol.asyncIterator]();
    const email = (await lines.next()).value ?? '';
    const password = (await lines.next()).value ?? '';
    input.pause();
    return { email: String(email).trim(), password: String(password) };
  }

  const rl = createInterface({ input, output });
  const email = (await rl.question('Correo: ')).trim();
  rl.close();
  output.write('Contraseña: ');
  const password = await readHidden(input);
  output.write('\n');
  return { email, password };
}

// Lee caracteres en modo raw sin escribirlos. Enter termina, Backspace borra y Ctrl+C cancela.
function readHidden(input: typeof process.stdin): Promise<string> {
  return new Promise((resolve, reject) => {
    let password = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      if (error) reject(error);
      else resolve(password);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Cancelado por el usuario'));
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else if (char >= ' ') password += char;
      }
    };
    input.on('data', onData);
  });
}
