import Fastify, { type FastifyInstance } from 'fastify';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { appStatusSchema, type AppStatus } from '@pi-ha/shared';
import { HomeAssistantClient, readConfigFile } from '@pi-ha/ha-client';
import { ModelCatalog, type ModelProviderInput } from './model-catalog.js';

const appVersion = process.env.APP_VERSION ?? '0.1.0';

export interface AppOptions {
  haClient?: HomeAssistantClient;
  configRoot?: string;
  modelCatalog?: ModelCatalog;
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const haClient =
    options.haClient ??
    new HomeAssistantClient({
      baseUrl: process.env.HA_URL ?? 'http://supervisor/core',
      ...(process.env.SUPERVISOR_TOKEN
        ? { token: process.env.SUPERVISOR_TOKEN }
        : {}),
    });
  const configRoot =
    options.configRoot ?? process.env.HOMEASSISTANT_CONFIG ?? '/homeassistant';
  const modelCatalog = options.modelCatalog ?? new ModelCatalog();

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/status', async (): Promise<AppStatus> =>
    appStatusSchema.parse({
      status: 'ok',
      appVersion,
      piVersion: null,
      homeAssistantMount: 'read-only',
      integration: 'not-installed',
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/api/v1/context/states', async () => haClient.getStates());
  app.get('/api/v1/context/entities', async () => haClient.getEntityRegistry());
  app.get('/api/v1/context/devices', async () => haClient.getDeviceRegistry());
  app.get('/api/v1/context/areas', async () => haClient.getAreaRegistry());
  app.get('/api/v1/context/services', async () => haClient.getServices());
  app.get('/api/v1/context/core', async () => haClient.getCoreInfo());
  app.get('/api/v1/context/logs', async () => haClient.getErrorLog());
  app.get<{ Querystring: { path?: string } }>(
    '/api/v1/context/config-file',
    async (request, reply) => {
      if (!request.query.path)
        return reply.code(400).send({ error: 'path is required' });
      try {
        return await readConfigFile(configRoot, request.query.path);
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to read config file',
        });
      }
    },
  );
  app.post<{ Body: { template?: string } }>(
    '/api/v1/context/render-template',
    async (request, reply) => {
      if (!request.body?.template)
        return reply.code(400).send({ error: 'template is required' });
      return haClient.renderTemplate(request.body.template);
    },
  );
  app.get('/api/v1/context/check-config', async () => haClient.checkConfig());

  app.get('/api/v1/models/providers', async () => modelCatalog.list());
  app.put<{ Params: { id: string }; Body: ModelProviderInput }>(
    '/api/v1/models/providers/:id',
    async (request, reply) => {
      if (request.params.id !== request.body?.id)
        return reply
          .code(400)
          .send({ error: 'Path and body provider ids must match' });
      try {
        return await modelCatalog.upsert(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : 'Invalid provider',
        });
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/models/providers/:id',
    async (request) => {
      await modelCatalog.remove(request.params.id);
      return { status: 'removed' };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/models/providers/:id/test',
    async (request, reply) => {
      const provider = await modelCatalog.get(request.params.id);
      if (!provider)
        return reply.code(404).send({ error: 'Provider not found' });
      return {
        status: 'configured',
        providerId: provider.id,
        modelCount: provider.models.length,
      };
    },
  );

  const frontendDist =
    process.env.FRONTEND_DIST ?? join(process.cwd(), '../frontend/dist');
  app.get('/', async (_request, reply) => {
    try {
      return reply
        .type('text/html')
        .send(await readFile(join(frontendDist, 'index.html'), 'utf8'));
    } catch {
      return reply
        .type('text/html')
        .send(
          '<!doctype html><html><body><main><h1>Pi Agent</h1><p>Frontend assets are not built.</p></main></body></html>',
        );
    }
  });
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    const requested = basename(String(request.params['*']));
    const content = await readFile(join(frontendDist, 'assets', requested));
    return reply
      .type(
        requested.endsWith('.js')
          ? 'text/javascript'
          : 'application/octet-stream',
      )
      .send(content);
  });

  return app;
}
