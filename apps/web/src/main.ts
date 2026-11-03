import type { PublicUser } from '@reservalab/shared';
import * as api from './api';
import { h } from './dom';
import { errorNotice } from './messages';
import { renderInfo } from './pages/info';
import { renderLogin } from './pages/login';
import { renderReservations } from './pages/reservations';
import './styles.css';

// Enrutado por hash, sin librerías: #/login, #/reservas y #/pantalla.

const header = document.querySelector<HTMLElement>('#header')!;
const main = document.querySelector<HTMLElement>('#app')!;

let user: PublicUser | null = null;
// Detiene lo que haya dejado corriendo la pantalla anterior (el refresco de la pantalla informativa)
let cleanup: (() => void) | undefined;
// Aviso para la pantalla de login (por ejemplo, sesión expirada)
let loginReason: string | undefined;

api.onSessionExpired(() => {
  user = null;
  loginReason = 'Tu sesión expiró. Inicia sesión de nuevo.';
  if (location.hash !== '#/pantalla') location.hash = '#/login';
});

function renderHeader(): void {
  const link = (hash: string, text: string) =>
    h('a', { href: hash, class: location.hash === hash ? 'active' : '' }, text);

  header.replaceChildren(
    h('a', { href: '#/reservas', class: 'brand' }, 'ReservaLab'),
    h('nav', {}, link('#/reservas', 'Reservas'), link('#/pantalla', 'Pantalla informativa')),
    user
      ? h(
          'div',
          { class: 'session' },
          h('span', {}, `${user.name} (${user.role})`),
          h('button', { type: 'button', class: 'secondary', onclick: () => void logout() }, 'Cerrar sesión'),
        )
      : h('div', { class: 'session' }, link('#/login', 'Iniciar sesión')),
  );
}

async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // La sesión local ya se borró; si la API no respondió, el refresh token vence solo
  }
  user = null;
  loginReason = 'Cerraste sesión.';
  location.hash = '#/login';
}

async function loadUser(): Promise<void> {
  if (user || !api.hasSession()) return;
  user = await api.getMe();
}

async function route(): Promise<void> {
  cleanup?.();
  cleanup = undefined;
  if (!location.hash) {
    location.hash = api.hasSession() ? '#/reservas' : '#/login';
    return; // el cambio de hash vuelve a llamar a route()
  }
  const hash = location.hash;

  try {
    if (hash === '#/pantalla') {
      renderHeader();
      cleanup = renderInfo(main);
      return;
    }

    await loadUser().catch((error: unknown) => {
      // Sin red no se puede saber quién es; la sesión expirada ya redirige a login
      if (!(error instanceof api.ApiError && error.code === 'SESSION_EXPIRED')) throw error;
    });

    if (hash === '#/reservas' && user) {
      renderHeader();
      renderReservations(main, user);
    } else if (user) {
      location.hash = '#/reservas';
    } else {
      if (hash !== '#/login') {
        location.hash = '#/login';
        return;
      }
      renderHeader();
      renderLogin(
        main,
        async () => {
          loginReason = undefined;
          await loadUser();
          location.hash = '#/reservas';
        },
        loginReason,
      );
    }
  } catch (error) {
    renderHeader();
    main.replaceChildren(errorNotice(error));
  }
}

window.addEventListener('hashchange', () => void route());
void route();
