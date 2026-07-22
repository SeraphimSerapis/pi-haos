import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HomeAssistantClient } from '@pi-ha/ha-client';
import type { PiRuntime } from '@pi-ha/pi-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';

describe('backend health API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = createApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports a liveness response', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports safe initial status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      homeAssistantMount: 'read-only',
      integration: 'not-installed',
    });
  });

  it('has an Ingress landing page before frontend assets are built', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Pi Agent');
  });
});

describe('read-only Home Assistant context routes', () => {
  it('routes structured reads through the backend client', async () => {
    const client = {
      getStates: vi.fn(async () => [
        { entity_id: 'light.office', state: 'on' },
      ]),
      getEntityRegistry: vi.fn(async () => [{ entity_id: 'light.office' }]),
      getDeviceRegistry: vi.fn(async () => []),
      getAreaRegistry: vi.fn(async () => []),
      getServices: vi.fn(async () => ({ light: {} })),
      getCoreInfo: vi.fn(async () => ({ version: '2026.7.0' })),
      getErrorLog: vi.fn(async () => 'No errors'),
      renderTemplate: vi.fn(async (template: string) => template),
      checkConfig: vi.fn(async () => ({ result: 'valid' })),
    } as unknown as HomeAssistantClient;
    const app = createApp({ haClient: client });
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/context/states',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { entity_id: 'light.office', state: 'on' },
    ]);
    expect(client.getStates).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects config reads without a path', async () => {
    const app = createApp({ haClient: {} as HomeAssistantClient });
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/context/config-file',
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('isolated Pi chat routes', () => {
  it('creates a session and bounds messages to that session', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'pi-chat-'));
    const runtime = {
      startSession: vi.fn(async (options) => ({
        id: options.sessionId ?? 'session',
        workspace: options.workspace,
        startedAt: new Date().toISOString(),
        status: 'idle' as const,
      })),
      sendMessage: vi.fn(async function* () {
        yield { type: 'text_delta' as const, delta: 'hello' };
      }),
      closeSession: vi.fn(async () => {}),
      healthCheck: vi.fn(async () => ({
        healthy: true,
        version: null,
        capabilities: null,
        activeSessions: 0,
      })),
    } as unknown as PiRuntime;
    const app = createApp({
      piRuntime: runtime,
      haClient: {} as HomeAssistantClient,
      sessionRoot,
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/sessions',
      payload: {},
    });
    expect(created.statusCode).toBe(200);
    const session = created.json() as { id: string };
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/sessions/${session.id}/messages`,
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([
      { type: 'text_delta', delta: 'hello' },
    ]);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/chat/sessions/${session.id}`,
    });
    expect(runtime.closeSession).toHaveBeenCalledWith(session.id);
    await app.close();
    await rm(sessionRoot, { recursive: true, force: true });
  });
});
