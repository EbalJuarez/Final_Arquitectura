// Errores que el CLI muestra al usuario con un código y un mensaje, igual que los de la API.

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'CliError';
  }
}

// Error devuelto por la API: { error: { code, message } } con su estado HTTP
export class ApiError extends CliError {
  constructor(
    readonly status: number,
    code: string,
    message: string,
    details?: { field: string; message: string }[],
  ) {
    super(code, message, details);
    this.name = 'ApiError';
  }
}

// No hay sesión guardada, o el refresh token ya no sirve: hay que volver a ejecutar login
export class SessionError extends CliError {
  constructor(message: string) {
    super('SESSION_EXPIRED', `${message}. Vuelve a ejecutar: pnpm cli login`);
    this.name = 'SessionError';
  }
}
