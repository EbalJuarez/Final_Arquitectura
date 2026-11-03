// Fechas y horas. La API responde en ISO 8601 con el desfase de Guatemala (2026-11-10T09:00:00-06:00),
// así que la fecha y la hora locales se leen directo del texto, sin depender de la zona del navegador.

export const GT_OFFSET = '-06:00';

// "2026-11-10T09:00:00-06:00" → "09:00"
export function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

// "2026-11-10T09:00:00-06:00" → "2026-11-10"
export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

// Hoy en Guatemala (UTC-6, sin horario de verano), como YYYY-MM-DD
export function todayInGuatemala(now = new Date()): string {
  return new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Fecha y hora locales del formulario → ISO con desfase para la API
export function toGuatemalaIso(date: string, time: string): string {
  return `${date}T${time}:00${GT_OFFSET}`;
}

// "2026-11-10" → "martes 10 de noviembre de 2026"
export function longDate(date: string): string {
  return new Date(`${date}T12:00:00${GT_OFFSET}`).toLocaleDateString('es-GT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Guatemala',
  });
}
