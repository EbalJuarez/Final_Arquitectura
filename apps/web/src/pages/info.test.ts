import type { NowResponse } from '@reservalab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { REFRESH_INTERVAL_MS, renderInfo } from './info';

// Pantalla informativa en Node: getNow mockeado, un DOM mínimo simulado y temporizadores falsos.

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getNow: vi.fn(),
}));

class FakeNode {}

class FakeText extends FakeNode {
  constructor(readonly data: string) {
    super();
  }
  get textContent(): string {
    return this.data;
  }
}

class FakeElement extends FakeNode {
  className = '';
  readonly attributes = new Map<string, string>();
  childNodes: FakeNode[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  appendChild(child: FakeNode): void {
    this.childNodes.push(child);
  }
  replaceChildren(...children: (FakeNode | string)[]): void {
    this.childNodes = children.map((child) => (typeof child === 'string' ? new FakeText(child) : child));
  }
  get textContent(): string {
    return this.childNodes.map((child) => (child as FakeText | FakeElement).textContent).join('');
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }
  // Todos los descendientes con esa clase
  byClass(name: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(child.className.split(' ').includes(name) ? [child] : []),
      ...child.byClass(name),
    ]);
  }
}

const SPACE_A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SPACE_B = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const nowResponse: NowResponse = {
  now: '2026-11-10T10:15:42-06:00',
  timezone: 'America/Guatemala',
  spaces: [
    {
      id: SPACE_A,
      name: 'Laboratorio de Redes',
      building: 'Edificio A',
      capacity: 30,
      status: 'OCCUPIED',
      occupiedUntil: '2026-11-10T11:00:00-06:00',
      nextReservation: { startsAt: '2026-11-10T14:00:00-06:00', endsAt: '2026-11-10T16:00:00-06:00' },
    },
    {
      id: SPACE_B,
      name: 'Salón 101',
      building: 'Edificio B',
      capacity: 40,
      status: 'FREE',
      occupiedUntil: null,
      nextReservation: null,
    },
  ],
};

let root: FakeElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    createTextNode: (data: string) => new FakeText(data),
  });
  vi.stubGlobal('window', globalThis);
  vi.stubEnv('VITE_INFO_API_KEY', 'rl_live_demo');
  vi.mocked(api.getNow).mockReset();
  root = new FakeElement('MAIN');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function render() {
  return renderInfo(root as unknown as HTMLElement);
}

// Partes de la pantalla: [título, estado, caja de errores, cuadrícula]
const parts = () => root.children as [FakeElement, FakeElement, FakeElement, FakeElement];

describe('renderInfo', () => {
  it('sin VITE_INFO_API_KEY muestra un error de configuración y no llama a la API', () => {
    vi.stubEnv('VITE_INFO_API_KEY', '');

    const stop = render();

    expect(root.classes.has('info-screen')).toBe(true);
    expect(root.textContent).toContain('Falta la variable VITE_INFO_API_KEY');
    expect(root.children[1]?.attributes.get('role')).toBe('alert');
    expect(api.getNow).not.toHaveBeenCalled();

    stop();
    expect(root.classes.has('info-screen')).toBe(false);
  });

  it('muestra el resumen y una tarjeta por espacio con su estado', async () => {
    vi.mocked(api.getNow).mockResolvedValue(nowResponse);

    render();
    await vi.waitFor(() => expect(parts()[3].children).toHaveLength(2));

    expect(api.getNow).toHaveBeenCalledWith('rl_live_demo');
    const [title, status] = parts();
    expect(title.textContent).toBe('Espacios ahora');
    expect(status.textContent).toBe('Actualizado a las 10:15:42 · 1 de 2 espacios ocupados · se actualiza cada 30 s');

    const [busy, free] = parts()[3].children as [FakeElement, FakeElement];
    expect(busy.className).toBe('now-card busy');
    expect(busy.textContent).toContain('Laboratorio de Redes');
    expect(busy.textContent).toContain('OCUPADO');
    expect(busy.textContent).toContain('Edificio A · 30 personas');
    expect(busy.byClass('until')[0]?.textContent).toBe('Ocupado hasta las 11:00');
    expect(busy.textContent).toContain('Siguiente reserva: 14:00 – 16:00');

    expect(free.className).toBe('now-card available');
    expect(free.textContent).toContain('LIBRE');
    expect(free.byClass('until')).toEqual([]);
    expect(free.textContent).toContain('Sin más reservas hoy');
  });

  it('sin espacios lo indica', async () => {
    vi.mocked(api.getNow).mockResolvedValue({ ...nowResponse, spaces: [] });

    render();
    await vi.waitFor(() => expect(parts()[3].textContent).toBe('No hay espacios registrados.'));

    expect(parts()[1].textContent).toContain('0 de 0 espacios ocupados');
  });

  it('si la API falla muestra el error, conserva los últimos datos y lo quita al recuperarse', async () => {
    vi.mocked(api.getNow)
      .mockResolvedValueOnce(nowResponse)
      .mockRejectedValueOnce(new api.NetworkError())
      .mockResolvedValueOnce({ ...nowResponse, spaces: [nowResponse.spaces[1]!] });

    render();
    await vi.waitFor(() => expect(parts()[3].children).toHaveLength(2));

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(parts()[2].textContent).toContain('No se pudo conectar con el servidor.');
    expect(parts()[3].children).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(parts()[2].childNodes).toEqual([]);
    expect(parts()[3].children).toHaveLength(1);
    expect(api.getNow).toHaveBeenCalledTimes(3);
  });

  it('la función devuelta detiene la actualización y quita la clase de la pantalla', async () => {
    vi.mocked(api.getNow).mockResolvedValue(nowResponse);

    const stop = render();
    await vi.waitFor(() => expect(api.getNow).toHaveBeenCalledTimes(1));
    stop();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);

    expect(api.getNow).toHaveBeenCalledTimes(1);
    expect(root.classes.has('info-screen')).toBe(false);
  });
});
