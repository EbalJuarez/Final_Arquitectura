import { env } from './env';

// Zona horaria del negocio. Guatemala no tiene horario de verano, así que el desfase es fijo (UTC-6).
export const BUSINESS_TIMEZONE = 'America/Guatemala';
export const BUSINESS_UTC_OFFSET_MINUTES = -6 * 60;

export const OPENING_HOUR = env.OPENING_HOUR;
export const CLOSING_HOUR = env.CLOSING_HOUR;
