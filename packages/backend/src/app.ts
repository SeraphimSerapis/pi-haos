import Fastify, { type FastifyInstance } from 'fastify';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { appStatusSchema, type AppStatus } from '@pi-ha/shared';

const appVersion = process.env.APP_VERSION ?? '0.1.0';

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

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
