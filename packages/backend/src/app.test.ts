import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
