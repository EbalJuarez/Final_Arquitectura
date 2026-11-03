import type { AvailabilityResponse, PublicUser, Reservation, Space, TimeBlock } from '@reservalab/shared';
import * as api from '../api';
import { h, notice } from '../dom';
import { longDate, timeOf, toGuatemalaIso, todayInGuatemala, dateOf } from '../format';
import { errorNotice } from '../messages';
import { field } from './login';

// Pantalla 2: espacios con filtros, disponibilidad de un día, formulario para reservar (solo DOCENTE
// y ADMIN) y la lista de mis reservas con el botón para cancelar.

export function renderReservations(root: HTMLElement, user: PublicUser): void {
  const canReserve = user.role === 'DOCENTE' || user.role === 'ADMIN';

  let spaces: Space[] = [];
  let selected: Space | null = null;
  let date = todayInGuatemala();
  let availability: AvailabilityResponse | null = null;

  // ---------- Espacios ----------

  const spacesStatus = h('div');
  const spacesList = h('div', { class: 'space-list' });
  const filtersForm = h(
    'form',
    { class: 'filters' },
    field('Edificio', h('input', { name: 'building', placeholder: 'Todos' })),
    field('Capacidad mínima', h('input', { name: 'minCapacity', type: 'number', min: 1, placeholder: 'Cualquiera' })),
    h('button', { type: 'submit' }, 'Filtrar'),
  );
  filtersForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadSpaces();
  });

  async function loadSpaces(): Promise<void> {
    const data = new FormData(filtersForm);
    const building = String(data.get('building') ?? '').trim();
    const minCapacity = Number(data.get('minCapacity')) || undefined;
    spacesStatus.replaceChildren(h('p', { class: 'muted' }, 'Cargando espacios…'));
    try {
      spaces = await api.listSpaces({ building: building || undefined, minCapacity });
      spacesStatus.replaceChildren();
      renderSpaces();
    } catch (error) {
      spacesStatus.replaceChildren(errorNotice(error));
    }
  }

  function renderSpaces(): void {
    if (spaces.length === 0) {
      spacesList.replaceChildren(h('p', { class: 'muted' }, 'No hay espacios que cumplan los filtros.'));
      return;
    }
    spacesList.replaceChildren(
      ...spaces.map((space) =>
        h(
          'button',
          {
            type: 'button',
            class: `space${selected?.id === space.id ? ' selected' : ''}`,
            'aria-pressed': selected?.id === space.id ? 'true' : 'false',
            onclick: () => {
              selected = space;
              renderSpaces();
              void loadAvailability();
            },
          },
          h('strong', {}, space.name),
          h('span', {}, `${space.building} · ${space.capacity} personas`),
        ),
      ),
    );
  }

  // ---------- Disponibilidad ----------

  const dateInput = h('input', { type: 'date', value: date, min: todayInGuatemala(), name: 'date' });
  dateInput.addEventListener('change', () => {
    date = dateInput.value || todayInGuatemala();
    void loadAvailability();
  });
  const availabilityBox = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Elige un espacio para ver sus bloques.'));

  async function loadAvailability(): Promise<void> {
    if (!selected) return;
    availabilityBox.replaceChildren(h('p', { class: 'muted' }, 'Cargando disponibilidad…'));
    try {
      availability = await api.getAvailability(selected.id, date);
      renderAvailability();
      renderReserveForm();
    } catch (error) {
      availability = null;
      availabilityBox.replaceChildren(errorNotice(error));
    }
  }

  function renderAvailability(): void {
    if (!availability || !selected) return;
    const blocks = [
      ...availability.free.map((block) => ({ block, free: true })),
      ...availability.occupied.map((block) => ({ block, free: false })),
    ].sort((a, b) => a.block.startsAt.localeCompare(b.block.startsAt));

    availabilityBox.replaceChildren(
      h('h3', {}, `${selected.name} — ${longDate(availability.date)}`),
      h('p', { class: 'muted' }, `Horario de operación: ${timeOf(availability.window.startsAt)} a ${timeOf(availability.window.endsAt)} (hora de Guatemala).`),
      h(
        'ul',
        { class: 'blocks' },
        ...blocks.map(({ block, free }) =>
          h(
            'li',
            { class: free ? 'block free' : 'block occupied' },
            h('span', { class: 'block-time' }, `${timeOf(block.startsAt)} – ${timeOf(block.endsAt)}`),
            h('span', { class: 'block-label' }, free ? 'Libre' : 'Ocupado'),
            free && canReserve
              ? h('button', { type: 'button', class: 'secondary', onclick: () => useBlock(block) }, 'Reservar en este bloque')
              : null,
          ),
        ),
      ),
    );
  }

  // ---------- Reservar ----------

  const reserveBox = h('div');
  const startInput = h('input', { type: 'time', name: 'start', step: 900, required: true });
  const endInput = h('input', { type: 'time', name: 'end', step: 900, required: true });
  const reserveStatus = h('div', { 'aria-live': 'polite' });
  const reserveButton = h('button', { type: 'submit' }, 'Reservar');
  const reserveForm = h(
    'form',
    { class: 'reserve-form' },
    field('Desde', startInput),
    field('Hasta', endInput),
    reserveButton,
  );
  reserveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void reserve();
  });

  function useBlock(block: TimeBlock): void {
    startInput.value = timeOf(block.startsAt);
    endInput.value = timeOf(block.endsAt);
    reserveStatus.replaceChildren();
    startInput.focus();
  }

  function renderReserveForm(): void {
    if (!canReserve) {
      reserveBox.replaceChildren(
        notice('info', `Tu rol (${user.role}) puede consultar la disponibilidad, pero solo DOCENTE y ADMIN pueden reservar.`),
      );
      return;
    }
    if (!selected || !availability) {
      reserveBox.replaceChildren(h('p', { class: 'muted' }, 'Elige un espacio y una fecha para reservar.'));
      return;
    }
    reserveBox.replaceChildren(
      h('p', {}, 'Reservar ', h('strong', {}, selected.name), ` el ${longDate(date)}. Puedes elegir un bloque libre o escribir otro horario.`),
      reserveForm,
      reserveStatus,
    );
  }

  async function reserve(): Promise<void> {
    if (!selected) return;
    if (!startInput.value || !endInput.value || endInput.value <= startInput.value) {
      reserveStatus.replaceChildren(notice('error', 'La hora de fin debe ser posterior a la de inicio.'));
      return;
    }
    reserveButton.disabled = true;
    reserveStatus.replaceChildren();
    try {
      const reservation = await api.createReservation({
        spaceId: selected.id,
        startsAt: toGuatemalaIso(date, startInput.value),
        endsAt: toGuatemalaIso(date, endInput.value),
      });
      reserveStatus.replaceChildren(
        notice('success', `Reserva confirmada: ${reservation.space.name}, ${timeOf(reservation.startsAt)} a ${timeOf(reservation.endsAt)}.`),
      );
      startInput.value = '';
      endInput.value = '';
      await Promise.all([loadAvailability(), loadMine()]);
    } catch (error) {
      reserveStatus.replaceChildren(errorNotice(error));
      // Si el horario se ocupó mientras tanto, se muestran los bloques actualizados
      if (error instanceof api.ApiError && error.code === 'RESERVATION_OVERLAP') void refreshBlocksOnly();
    } finally {
      reserveButton.disabled = false;
    }
  }

  async function refreshBlocksOnly(): Promise<void> {
    if (!selected) return;
    try {
      availability = await api.getAvailability(selected.id, date);
      renderAvailability();
    } catch {
      // el error principal ya se mostró
    }
  }

  // ---------- Mis reservas ----------

  const mineStatus = h('div', { 'aria-live': 'polite' });
  const mineBox = h('div');

  async function loadMine(): Promise<void> {
    try {
      renderMine(await api.listMyReservations());
    } catch (error) {
      mineStatus.replaceChildren(errorNotice(error));
    }
  }

  function renderMine(reservations: Reservation[]): void {
    if (reservations.length === 0) {
      mineBox.replaceChildren(h('p', { class: 'muted' }, 'Todavía no tienes reservas.'));
      return;
    }
    const now = new Date();
    mineBox.replaceChildren(
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Espacio'), h('th', {}, 'Fecha'), h('th', {}, 'Horario'), h('th', {}, 'Estado'), h('th', {}, ''))),
        h(
          'tbody',
          {},
          ...reservations.map((reservation) => {
            const active = reservation.status === 'CONFIRMED' && new Date(reservation.endsAt) > now;
            return h(
              'tr',
              { class: reservation.status === 'CANCELLED' ? 'cancelled' : '' },
              h('td', {}, `${reservation.space.name} (${reservation.space.building})`),
              h('td', {}, dateOf(reservation.startsAt)),
              h('td', {}, `${timeOf(reservation.startsAt)} – ${timeOf(reservation.endsAt)}`),
              h('td', {}, reservation.status === 'CONFIRMED' ? (active ? 'Confirmada' : 'Terminada') : 'Cancelada'),
              h(
                'td',
                {},
                active
                  ? h('button', { type: 'button', class: 'danger', onclick: () => void cancel(reservation) }, 'Cancelar')
                  : null,
              ),
            );
          }),
        ),
      ),
    );
  }

  async function cancel(reservation: Reservation): Promise<void> {
    const label = `${reservation.space.name}, ${dateOf(reservation.startsAt)} de ${timeOf(reservation.startsAt)} a ${timeOf(reservation.endsAt)}`;
    if (!window.confirm(`¿Cancelar la reserva de ${label}?`)) return;
    mineStatus.replaceChildren();
    try {
      await api.cancelReservation(reservation.id);
      mineStatus.replaceChildren(notice('success', `Reserva cancelada: ${label}. El horario quedó libre.`));
      await Promise.all([loadMine(), selected?.id === reservation.space.id ? loadAvailability() : Promise.resolve()]);
    } catch (error) {
      mineStatus.replaceChildren(errorNotice(error));
    }
  }

  root.replaceChildren(
    h('h1', {}, 'Reservas'),
    h(
      'div',
      { class: 'grid-2' },
      h('section', { class: 'card' }, h('h2', {}, '1. Espacio'), filtersForm, spacesStatus, spacesList),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '2. Día y bloques'),
        field('Fecha', dateInput),
        availabilityBox,
        h('h2', {}, '3. Reservar'),
        reserveBox,
      ),
    ),
    h('section', { class: 'card' }, h('h2', {}, 'Mis reservas'), mineStatus, mineBox),
  );

  renderReserveForm();
  void loadSpaces();
  void loadMine();
}
