import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api';
import { describeError, errorNotice } from './messages';

// describeError es lógica pura; errorNotice necesita un DOM mínimo, que se simula solo en su prueba.

describe('describeError', () => {
  it('un fallo de red pide revisar la conexión', () => {
    expect(describeError(new NetworkError())).toEqual({
      title: 'No se pudo conectar con el servidor.',
      details: ['Revisa tu conexión a internet o que la API esté levantada, e intenta de nuevo.'],
    });
  });

  it.each([502, 503, 504])('un %i genérico del proxy se trata como fallo de conexión', (status) => {
    const error = new ApiError(status, `HTTP_${status}`, `El servidor respondió ${status}`);

    expect(describeError(error).title).toBe('No se pudo conectar con el servidor.');
  });

  it('un 503 con código propio de la API muestra el mensaje de la API', () => {
    const error = new ApiError(503, 'SERVICE_UNAVAILABLE', 'Base de datos en mantenimiento');

    expect(describeError(error)).toEqual({ title: 'Base de datos en mantenimiento', details: [] });
  });

  it('un 500 genérico no se confunde con un fallo de conexión', () => {
    const error = new ApiError(500, 'HTTP_500', 'El servidor respondió 500');

    expect(describeError(error)).toEqual({ title: 'El servidor respondió 500', details: [] });
  });

  it('un choque de horario explica que el bloque está ocupado', () => {
    const result = describeError(new ApiError(409, 'RESERVATION_OVERLAP', 'Conflicto'));

    expect(result.title).toBe('Ese horario ya está ocupado.');
    expect(result.details[0]).toContain('Elige uno de los bloques libres');
  });

  it('credenciales incorrectas', () => {
    expect(describeError(new ApiError(401, 'INVALID_CREDENTIALS', 'x'))).toEqual({
      title: 'Correo o contraseña incorrectos.',
      details: [],
    });
  });

  it('correo ya registrado', () => {
    expect(describeError(new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'x'))).toEqual({
      title: 'Ya existe una cuenta con ese correo.',
      details: ['Inicia sesión o usa otro correo.'],
    });
  });

  it('sesión expirada muestra el mensaje tal cual', () => {
    const error = new ApiError(401, 'SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.');

    expect(describeError(error)).toEqual({ title: 'Tu sesión expiró. Inicia sesión de nuevo.', details: [] });
  });

  it('un 403 dice que no hay permiso e incluye el motivo', () => {
    const error = new ApiError(403, 'FORBIDDEN', 'Solo DOCENTE o ADMIN pueden reservar');

    expect(describeError(error)).toEqual({
      title: 'No tienes permiso para hacer esto.',
      details: ['Solo DOCENTE o ADMIN pueden reservar'],
    });
  });

  it('otro 409 muestra el mensaje sin detalles', () => {
    const error = new ApiError(409, 'RESERVATION_NOT_ACTIVE', 'La reserva ya fue cancelada', [
      { field: 'id', message: 'ignorado' },
    ]);

    expect(describeError(error)).toEqual({ title: 'La reserva ya fue cancelada', details: [] });
  });

  it('un error de validación lista un detalle por campo; sin campo dice "datos"', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos', [
      { field: 'email', message: 'Correo inválido' },
      { field: '', message: 'Cuerpo vacío' },
    ]);

    expect(describeError(error)).toEqual({
      title: 'Revisa los datos',
      details: ['email: Correo inválido', 'datos: Cuerpo vacío'],
    });
  });

  it('un Error cualquiera es inesperado y muestra su mensaje', () => {
    expect(describeError(new TypeError('x is undefined'))).toEqual({
      title: 'Ocurrió un error inesperado.',
      details: ['x is undefined'],
    });
  });

  it('un valor que no es Error se convierte a texto', () => {
    expect(describeError('falló')).toEqual({ title: 'Ocurrió un error inesperado.', details: ['falló'] });
  });
});

describe('errorNotice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('arma una caja role="alert" con el título en <strong> y un <p> por detalle', () => {
    class FakeNode {}
    class FakeElement extends FakeNode {
      className = '';
      readonly attributes = new Map<string, string>();
      readonly childNodes: { tagName?: string; textContent: string }[] = [];
      constructor(readonly tagName: string) {
        super();
      }
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }
      appendChild(child: { textContent: string }) {
        this.childNodes.push(child);
      }
      get textContent(): string {
        return this.childNodes.map((child) => child.textContent).join('');
      }
    }
    vi.stubGlobal('Node', FakeNode);
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
      createTextNode: (data: string) => Object.assign(new FakeNode(), { textContent: data }),
    });

    const box = errorNotice(
      new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos', [{ field: 'name', message: 'Muy corto' }]),
    ) as unknown as FakeElement;

    expect(box.className).toBe('notice notice-error');
    expect(box.attributes.get('role')).toBe('alert');
    expect(box.childNodes.map((child) => [child.tagName, child.textContent])).toEqual([
      ['STRONG', 'Revisa los datos'],
      ['P', 'name: Muy corto'],
    ]);
  });
});
