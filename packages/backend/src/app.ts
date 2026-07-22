import Fastify, { type FastifyInstance } from 'fastify';
import { basename, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { appStatusSchema, type AppStatus } from '@pi-ha/shared';
import { HomeAssistantClient, readConfigFile } from '@pi-ha/ha-client';
import { ModelCatalog, type ModelProviderInput } from './model-catalog.js';
import { SkillsManager } from '@pi-ha/skills-manager';
import type { SkillManifest } from '@pi-ha/skills-manager';
import {
  RpcPiRuntime,
  type PiRuntime,
  type SessionInfo,
} from '@pi-ha/pi-runtime';

const appVersion = process.env.APP_VERSION ?? '0.1.0';

export interface AppOptions {
  haClient?: HomeAssistantClient;
  configRoot?: string;
  modelCatalog?: ModelCatalog;
  skillsManager?: SkillsManager;
  piRuntime?: PiRuntime;
  sessionRoot?: string;
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
  const skillsManager = options.skillsManager ?? new SkillsManager();
  const piRuntime =
    options.piRuntime ??
    new RpcPiRuntime({
      piCommand: process.env.PI_COMMAND ?? '/opt/pi/node_modules/.bin/pi',
      launcherPath: process.env.PI_LAUNCHER ?? '/app/bin/pi-sandbox',
      version: {
        version: process.env.PI_VERSION ?? '0.81.1',
        source: 'bundled',
        path: process.env.PI_COMMAND ?? '/opt/pi/node_modules/.bin/pi',
      },
      discoveryWorkspace:
        process.env.PI_DISCOVERY_WORKSPACE ?? '/data/sessions/discovery',
    });
  const sessions = new Map<string, SessionInfo>();
  const sessionRoot =
    options.sessionRoot ?? join(process.env.DATA_DIR ?? '/data', 'sessions');

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/status', async (): Promise<AppStatus> =>
    appStatusSchema.parse({
      status: 'ok',
      appVersion,
      piVersion: process.env.PI_VERSION ?? null,
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

  app.get('/api/v1/pi/health', async () => piRuntime.healthCheck());
  app.post<{ Body: { model?: { provider: string; modelId: string } } }>(
    '/api/v1/chat/sessions',
    async (request) => {
      const id = randomUUID();
      const workspace = join(sessionRoot, id);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const session = await piRuntime.startSession({
        sessionId: id,
        workspace,
        ...(request.body?.model ? { model: request.body.model } : {}),
      });
      sessions.set(id, session);
      return session;
    },
  );
  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    '/api/v1/chat/sessions/:id/messages',
    async (request, reply) => {
      const message = request.body?.message?.trim();
      if (!message)
        return reply.code(400).send({ error: 'message is required' });
      if (!sessions.has(request.params.id))
        return reply.code(404).send({ error: 'Session not found' });
      const events = [];
      let responseSize = 0;
      for await (const event of piRuntime.sendMessage(
        request.params.id,
        message,
      )) {
        const serialized = JSON.stringify(event);
        responseSize += Buffer.byteLength(serialized, 'utf8');
        if (responseSize > 256 * 1024)
          return reply.code(413).send({
            error: 'Agent response exceeded the configured size limit',
          });
        events.push(event);
      }
      return { sessionId: request.params.id, events };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/chat/sessions/:id',
    async (request, reply) => {
      if (!sessions.has(request.params.id))
        return reply.code(404).send({ error: 'Session not found' });
      await piRuntime.closeSession(request.params.id);
      sessions.delete(request.params.id);
      return { status: 'closed' };
    },
  );

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

  app.get('/api/v1/skills', async () => skillsManager.list());
  app.put<{
    Params: { source: 'installed' | 'user'; id: string };
    Body: Omit<SkillManifest, 'source'> & { content: string };
  }>('/api/v1/skills/:source/:id', async (request, reply) => {
    if (
      request.params.source !== 'installed' &&
      request.params.source !== 'user'
    )
      return reply.code(400).send({ error: 'Invalid skill source' });
    try {
      return await skillsManager.save(
        { ...request.body, id: request.params.id },
        request.body.content,
        request.params.source,
      );
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Invalid skill',
      });
    }
  });
  app.post<{
    Params: { source: 'bundled' | 'installed' | 'user'; id: string };
    Body: { enabled?: boolean };
  }>('/api/v1/skills/:source/:id/enabled', async (request, reply) => {
    try {
      return await skillsManager.setEnabled(
        request.params.source,
        request.params.id,
        request.body?.enabled ?? true,
      );
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to change skill state',
      });
    }
  });
  app.delete<{ Params: { source: 'installed' | 'user'; id: string } }>(
    '/api/v1/skills/:source/:id',
    async (request, reply) => {
      if (
        request.params.source !== 'installed' &&
        request.params.source !== 'user'
      )
        return reply.code(400).send({ error: 'Invalid skill source' });
      try {
        await skillsManager.remove(request.params.source, request.params.id);
        return { status: 'removed' };
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error ? error.message : 'Unable to remove skill',
        });
      }
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
