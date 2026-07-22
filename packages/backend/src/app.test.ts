import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HomeAssistantClient } from '@pi-ha/ha-client';
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
