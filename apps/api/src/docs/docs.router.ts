import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi';

// Documentación interactiva en /docs y el documento OpenAPI crudo en /docs/openapi.json.
// El documento se genera una sola vez, al cargar el módulo.
const document = buildOpenApiDocument();

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(document);
});
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'ReservaLab API' }));
