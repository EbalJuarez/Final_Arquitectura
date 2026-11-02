// Rechaza si la promesa no termina en ms. Se usa con Redis: si el servidor se detiene, el cliente
// puede tardar en detectarlo y un comando se quedaría esperando en vez de fallar.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis no respondió en ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
