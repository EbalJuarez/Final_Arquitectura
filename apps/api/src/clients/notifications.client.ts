import { env } from '../config/env';

// Cliente HTTP del servicio externo de notificaciones. No es un repositorio: no guarda datos,
// solo avisa a otro sistema. Lanza si el servicio falla, responde con error o tarda más del timeout.

export interface ReservationNotification {
  reservationId: string;
  spaceId: string;
  spaceName: string;
  userId: string;
  userEmail: string;
  startsAt: string;
  endsAt: string;
}

async function post(path: string, payload: ReservationNotification): Promise<void> {
  const url = `${env.NOTIFICATIONS_URL.replace(/\/+$/, '')}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(env.NOTIFICATIONS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`El servicio de notificaciones respondió ${response.status} en ${path}`);
  }
}

export function notifyReservationConfirmed(payload: ReservationNotification): Promise<void> {
  return post('/notifications/reservation-confirmed', payload);
}

export function notifyReservationCancelled(payload: ReservationNotification): Promise<void> {
  return post('/notifications/reservation-cancelled', payload);
}
