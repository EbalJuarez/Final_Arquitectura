import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regla de la web: el texto de la API se inserta solo como nodo de texto (ver dom.ts). Esta prueba
// falla si algún archivo usa una API que interpreta HTML.
const FORBIDDEN = /\.(innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\(|document\.write\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('sin HTML a partir de texto', () => {
  it('ningún archivo de src usa innerHTML, outerHTML, insertAdjacentHTML ni document.write', () => {
    const files = sourceFiles(join(import.meta.dirname, '.'));
    expect(files.length).toBeGreaterThan(5);

    const offenders = files.filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
