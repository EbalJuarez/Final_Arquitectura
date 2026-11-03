import { h, notice } from './dom';
import { ApiError, NetworkError } from './api';

// Traduce un error a un mensaje claro para la persona que usa la web.
export function describeError(error: unknown): { title: string; details: string[] } {
  // Con nginx delante, una API caída llega como 502, 503 o 504 en vez de un fallo de red
  const gatewayError = error instanceof ApiError && error.status >= 502 && error.status <= 504 && error.code.startsWith('HTTP_');
  if (error instanceof NetworkError || gatewayError) {
    return {
      title: 'No se pudo conectar con el servidor.',
      details: ['Revisa tu conexión a internet o que la API esté levantada, e intenta de nuevo.'],
    };
  }
  if (error instanceof ApiError) {
    const details = error.details.map((detail) => `${detail.field || 'datos'}: ${detail.message}`);
    switch (error.code) {
      case 'RESERVATION_OVERLAP':
        return {
          title: 'Ese horario ya está ocupado.',
          details: ['Ya hay una reserva de ese espacio que se cruza con el horario que elegiste. Elige uno de los bloques libres.'],
        };
      case 'INVALID_CREDENTIALS':
        return { title: 'Correo o contraseña incorrectos.', details: [] };
      case 'EMAIL_ALREADY_REGISTERED':
        return { title: 'Ya existe una cuenta con ese correo.', details: ['Inicia sesión o usa otro correo.'] };
      case 'SESSION_EXPIRED':
        return { title: error.message, details: [] };
    }
    if (error.status === 403) {
      return { title: 'No tienes permiso para hacer esto.', details: [error.message] };
    }
    if (error.status === 409) {
      return { title: error.message, details: [] };
    }
    return { title: error.message, details };
  }
  return { title: 'Ocurrió un error inesperado.', details: [error instanceof Error ? error.message : String(error)] };
}

// Caja de error lista para insertar, con el título y los detalles
export function errorNotice(error: unknown): HTMLElement {
  const { title, details } = describeError(error);
  return notice('error', h('strong', {}, title), ...details.map((detail) => h('p', {}, detail)));
}
