// Construcción del DOM sin innerHTML: el texto siempre se inserta como nodo de texto
// (document.createTextNode), así que cualquier dato de la API queda escapado. Ninguna pantalla usa
// innerHTML, outerHTML ni insertAdjacentHTML (lo comprueba src/no-inner-html.test.ts).

type Child = Node | string | number | null | undefined | false;
type Handler = (event: Event) => void;
type Props = Record<string, string | number | boolean | Handler | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      // onclick → addEventListener('click')
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'class') {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
  append(element, ...children);
  return element;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Mensaje en una caja de aviso; kind cambia el color
export function notice(kind: 'info' | 'success' | 'error', ...children: Child[]): HTMLElement {
  return h('div', { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, ...children);
}
