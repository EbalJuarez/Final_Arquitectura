import { describe, expect, it } from 'vitest';
import { dateOf, nextQuarterHour, timeOf, toGuatemalaIso, todayInGuatemala } from './format';

describe('fechas en hora de Guatemala', () => {
  it('lee fecha y hora del texto ISO de la API', () => {
    expect(timeOf('2026-11-10T09:05:00-06:00')).toBe('09:05');
    expect(dateOf('2026-11-10T09:05:00-06:00')).toBe('2026-11-10');
  });

  it('arma el ISO con desfase -06:00 para la API', () => {
    expect(toGuatemalaIso('2026-11-10', '14:30')).toBe('2026-11-10T14:30:00-06:00');
  });

  it('hoy en Guatemala: a las 03:00 UTC todavía es el día anterior', () => {
    expect(todayInGuatemala(new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-10');
    expect(todayInGuatemala(new Date('2026-11-11T06:00:00Z'))).toBe('2026-11-11');
  });

  it('próximo cuarto de hora en Guatemala', () => {
    expect(nextQuarterHour(new Date('2026-11-03T01:08:00Z'))).toBe('19:15');
    expect(nextQuarterHour(new Date('2026-11-03T01:15:00Z'))).toBe('19:15');
    expect(nextQuarterHour(new Date('2026-11-03T05:50:00Z'))).toBe('23:59');
  });
});
