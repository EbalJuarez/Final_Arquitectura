import type { NowResponse, NowSpace } from '@reservalab/shared';
import * as api from '../api';
import { h, notice } from '../dom';
import { timeOf } from '../format';
import { errorNotice } from '../messages';

// Pantalla 3: pantalla informativa para los edificios. Usa la API key read:now de VITE_INFO_API_KEY
// (no hace falta iniciar sesión) y se actualiza sola cada 30 segundos. Devuelve la función que detiene
// la actualización al salir de la pantalla.

export const REFRESH_INTERVAL_MS = 30_000;

export function renderInfo(root: HTMLElement): () => void {
  const apiKey = import.meta.env.VITE_INFO_API_KEY;
  root.classList.add('info-screen');

  if (!apiKey) {
    root.replaceChildren(
      h('h1', {}, 'Pantalla informativa'),
      notice('error', 'Falta la variable VITE_INFO_API_KEY: la web se construyó sin la API key de la pantalla informativa.'),
    );
    return () => root.classList.remove('info-screen');
  }

  const status = h('p', { class: 'muted', 'aria-live': 'polite' }, 'Cargando…');
  const errorBox = h('div');
  const grid = h('div', { class: 'now-grid' });

  async function refresh(): Promise<void> {
    try {
      const response = await api.getNow(apiKey!);
      errorBox.replaceChildren();
      render(response);
    } catch (error) {
      // Se conservan los últimos datos y se avisa; el próximo intento es en 30 s
      errorBox.replaceChildren(errorNotice(error));
    }
  }

  function render(response: NowResponse): void {
    const occupied = response.spaces.filter((space) => space.status === 'OCCUPIED').length;
    status.replaceChildren(
      `Actualizado a las ${response.now.slice(11, 19)} · ${occupied} de ${response.spaces.length} espacios ocupados · se actualiza cada ${REFRESH_INTERVAL_MS / 1000} s`,
    );
    grid.replaceChildren(
      ...(response.spaces.length === 0 ? [h('p', {}, 'No hay espacios registrados.')] : response.spaces.map(card)),
    );
  }

  root.replaceChildren(h('h1', {}, 'Espacios ahora'), status, errorBox, grid);
  void refresh();
  const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

  return () => {
    window.clearInterval(timer);
    root.classList.remove('info-screen');
  };
}

function card(space: NowSpace): HTMLElement {
  const busy = space.status === 'OCCUPIED';
  return h(
    'article',
    { class: `now-card ${busy ? 'busy' : 'available'}` },
    h('header', {}, h('h2', {}, space.name), h('span', { class: 'badge' }, busy ? 'OCUPADO' : 'LIBRE')),
    h('p', { class: 'muted' }, `${space.building} · ${space.capacity} personas`),
    busy && space.occupiedUntil ? h('p', { class: 'until' }, `Ocupado hasta las ${timeOf(space.occupiedUntil)}`) : null,
    h(
      'p',
      {},
      space.nextReservation
        ? `Siguiente reserva: ${timeOf(space.nextReservation.startsAt)} – ${timeOf(space.nextReservation.endsAt)}`
        : 'Sin más reservas hoy',
    ),
  );
}
