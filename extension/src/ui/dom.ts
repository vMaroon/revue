// Tiny DOM construction helpers shared by the ui modules. All text is added
// via text nodes (never innerHTML), so untrusted strings render inert.

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (typeof value === 'function') {
        el.addEventListener(name.startsWith('on') ? name.slice(2).toLowerCase() : name, value);
      } else if (value === true) {
        el.setAttribute(name, '');
      } else {
        el.setAttribute(name, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
