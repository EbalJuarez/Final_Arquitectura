import { LoginSchema, RegisterSchema } from '@reservalab/shared';
import * as api from '../api';
import { append, h, notice } from '../dom';
import { errorNotice } from '../messages';

// Pantalla 1: iniciar sesión o crear una cuenta. Al entrar, la app carga el usuario y va a Reservas.

export function renderLogin(root: HTMLElement, onLoggedIn: () => Promise<void>, reason?: string): void {
  const loginStatus = h('div', { 'aria-live': 'polite' });
  const registerStatus = h('div', { 'aria-live': 'polite' });

  const loginForm = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', {}, 'Iniciar sesión'),
    field('Correo', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
    field('Contraseña', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { type: 'submit' }, 'Entrar'),
    loginStatus,
  );

  const registerForm = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', {}, 'Crear cuenta'),
    h('p', { class: 'muted' }, 'Las cuentas nuevas son de ESTUDIANTE: pueden consultar la disponibilidad. Un administrador asigna los roles DOCENTE y ADMIN.'),
    field('Nombre', h('input', { name: 'name', autocomplete: 'name', required: true })),
    field('Correo', h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true })),
    field('Contraseña (mínimo 8 caracteres)', h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true })),
    h('button', { type: 'submit' }, 'Crear cuenta y entrar'),
    registerStatus,
  );

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(loginForm, loginStatus, async (data) => {
      const credentials = LoginSchema.safeParse(data);
      if (!credentials.success) throw invalid(credentials.error);
      await api.login(credentials.data);
    });
  });

  registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(registerForm, registerStatus, async (data) => {
      const input = RegisterSchema.safeParse(data);
      if (!input.success) throw invalid(input.error);
      await api.register(input.data);
      await api.login({ email: input.data.email, password: input.data.password });
    });
  });

  async function submit(form: HTMLFormElement, status: HTMLElement, action: (data: Record<string, string>) => Promise<void>) {
    const button = form.querySelector('button')!;
    button.disabled = true;
    status.replaceChildren();
    try {
      await action(Object.fromEntries(new FormData(form)) as Record<string, string>);
      await onLoggedIn();
    } catch (error) {
      status.replaceChildren(errorNotice(error));
      button.disabled = false;
    }
  }

  root.replaceChildren(h('h1', {}, 'Bienvenido a ReservaLab'));
  append(root, reason ? notice('info', reason) : null, h('div', { class: 'grid-2' }, loginForm, registerForm));
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

// Error de validación local con el mismo formato que la API
function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): api.ApiError {
  return new api.ApiError(
    400,
    'VALIDATION_ERROR',
    'Revisa los datos del formulario',
    error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  );
}
