import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import SwaggerParser from '@apidevtools/swagger-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { apiV1Routers } from '../routes';
import { buildOpenApiDocument } from './openapi';

const document = buildOpenApiDocument();

type Operation = {
  description?: string;
  security?: Record<string, string[]>[];
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Todas las operaciones del documento como "METODO /ruta" (con la sintaxis {param} de OpenAPI)
function documentedOperations(): Map<string, Operation> {
  const operations = new Map<string, Operation>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (operation) operations.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return operations;
}

// Todas las rutas registradas en Express bajo /api/v1, leídas de la pila de cada router.
// /spaces/:id/availability se convierte en /spaces/{id}/availability.
function expressRoutes(): string[] {
  const routes: string[] = [];
  for (const [prefix, router] of apiV1Routers) {
    for (const layer of router.stack) {
      const route = layer.route as { path: string; methods: Record<string, boolean> } | undefined;
      if (!route) continue; // middleware de router.use()
      const path = (prefix + (route.path === '/' ? '' : route.path)).replace(/:(\w+)/g, '{$1}');
      for (const method of Object.keys(route.methods)) {
        routes.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return routes;
}

describe('documento OpenAPI', () => {
  it('es un OpenAPI 3 válido', async () => {
    // validate() resuelve las referencias sobre el objeto, así que se le pasa una copia
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
    expect(document.openapi).toMatch(/^3\./);
  });

  it('cada ruta registrada en Express aparece documentada', () => {
    const routes = expressRoutes();
    const documented = documentedOperations();

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((route) => !documented.has(route))).toEqual([]);
  });

  it('no documenta rutas que no existen en Express', () => {
    const routes = new Set(expressRoutes());

    expect([...documentedOperations().keys()].filter((operation) => !routes.has(operation))).toEqual([]);
  });

  it('cada operación declara su seguridad, tiene descripción y usa el formato común en sus errores', () => {
    for (const [name, operation] of documentedOperations()) {
      expect(operation.security, name).toBeDefined();
      expect(operation.description, name).toBeTruthy();
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) >= 400 && status !== '503') {
          expect(response.content?.['application/json']?.schema?.$ref, `${name} ${status}`).toBe(
            '#/components/schemas/ErrorResponse',
          );
        }
      }
    }
  });

  it('declara bearerAuth (JWT) y apiKeyAuth (X-API-Key)', () => {
    expect(document.components?.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    });
  });

  it('marca la seguridad que exige cada tipo de endpoint', () => {
    const operations = documentedOperations();

    expect(operations.get('POST /auth/login')?.security).toEqual([]);
    expect(operations.get('POST /spaces')?.security).toEqual([{ bearerAuth: [] }]);
    expect(operations.get('GET /spaces/{id}/availability')?.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(operations.get('GET /now')?.security).toEqual([{ apiKeyAuth: [] }]);
  });

  it('documenta X-Cache y el límite por minuto', () => {
    const now = documentedOperations().get('GET /now')!.responses as Record<string, { headers?: object }>;

    expect(Object.keys(now['200']!.headers!)).toEqual(['X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining']);
    expect(Object.keys(now['429']!.headers!)).toEqual(['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining']);
  });
});

describe('GET /docs', () => {
  // Sin base ni Redis: estas rutas solo sirven archivos y el documento ya generado.
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('/docs/openapi.json devuelve el documento', async () => {
    const response = await fetch(`${baseUrl}/docs/openapi.json`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it('/docs/ sirve Swagger UI', async () => {
    const response = await fetch(`${baseUrl}/docs/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('swagger-ui');
  });
});
