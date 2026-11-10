import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { append, h, notice } from './dom';

// Estas pruebas corren en Node: se simula lo mínimo del DOM que usa dom.ts (createElement,
// createTextNode, atributos, eventos e hijos) para verificar qué construye cada función.

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
  readonly childNodes: FakeNode[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  appendChild(child: FakeNode): FakeNode {
    this.childNodes.push(child);
    return child;
  }
  get textContent(): string {
    return this.childNodes.map((child) => (child as FakeText | FakeElement).textContent).join('');
  }
}

beforeEach(() => {
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    createTextNode: (data: string) => new FakeText(data),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const asFake = (element: unknown) => element as FakeElement;

describe('h', () => {
  it('crea el elemento con la clase y los atributos indicados', () => {
    const input = asFake(h('input', { class: 'campo', name: 'email', maxlength: 100 }));

    expect(input.tagName).toBe('INPUT');
    expect(input.className).toBe('campo');
    expect(input.attributes.get('name')).toBe('email');
    expect(input.attributes.get('maxlength')).toBe('100');
    expect(input.attributes.has('class')).toBe(false);
  });

  it('un atributo true queda vacío y los valores false, null o undefined se omiten', () => {
    const input = asFake(h('input', { required: true, disabled: false, placeholder: null, title: undefined }));

    expect([...input.attributes]).toEqual([['required', '']]);
  });

  it('las funciones se registran como listeners del evento sin el prefijo "on"', () => {
    const onClick = vi.fn();
    const button = asFake(h('button', { onClick }));

    expect(button.attributes.size).toBe(0);
    expect(button.listeners.get('click')).toEqual([onClick]);
  });

  it('inserta el texto como nodo de texto, sin interpretarlo como HTML', () => {
    const p = asFake(h('p', {}, '<img src=x onerror=alert(1)>'));

    expect(p.childNodes).toHaveLength(1);
    expect(p.childNodes[0]).toBeInstanceOf(FakeText);
    expect(p.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('sin props crea el elemento vacío', () => {
    const div = asFake(h('div'));

    expect(div.attributes.size).toBe(0);
    expect(div.childNodes).toEqual([]);
  });
});

describe('append', () => {
  it('agrega nodos tal cual, convierte números y textos, y omite null, undefined y false', () => {
    const parent = asFake(h('div'));
    const child = h('span', {}, 'hijo');

    append(parent as unknown as Node, child, 'texto', 42, null, undefined, false);

    expect(parent.childNodes).toHaveLength(3);
    expect(parent.childNodes[0]).toBe(child);
    expect(parent.textContent).toBe('hijotexto42');
  });
});

describe('notice', () => {
  it('un error usa role="alert" y la clase notice-error', () => {
    const box = asFake(notice('error', 'Algo falló'));

    expect(box.tagName).toBe('DIV');
    expect(box.className).toBe('notice notice-error');
    expect(box.attributes.get('role')).toBe('alert');
    expect(box.textContent).toBe('Algo falló');
  });

  it.each(['info', 'success'] as const)('un aviso %s usa role="status"', (kind) => {
    const box = asFake(notice(kind, 'Listo'));

    expect(box.className).toBe(`notice notice-${kind}`);
    expect(box.attributes.get('role')).toBe('status');
  });
});
