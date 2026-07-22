import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HomeAssistantClient } from '@pi-ha/ha-client';
import type { PiRuntime } from '@pi-ha/pi-runtime';
import { MockPiRuntime } from '@pi-ha/pi-runtime';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairingManager } from './pairing.js';
import { TransactionStore } from './transaction-store.js';
import { TaskStore } from './task-store.js';
import { createApp } from './app.js';
import type { ActivationAdapter } from './activation.js';
import { AuditStore } from './audit-store.js';
import { PolicyStore } from './policy-store.js';
import { ModelSettingsStore } from './model-settings.js';
import {
  PiReleaseCatalog,
  PiUpdateManager,
  PiUpdateSettingsStore,
} from '@pi-ha/pi-runtime';

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

describe('authenticated companion status', () => {
  it('returns bounded runtime and queue status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bridge-status-'));
    const pairing = new PairingManager(join(root, 'pairing.json'));
    const app = createApp({
      pairingManager: pairing,
      piRuntime: new MockPiRuntime(),
      piUpdateManager: new PiUpdateManager({
        root: join(root, 'pi'),
        bundledVersion: '0.81.1',
      }),
      taskStore: new TaskStore(':memory:'),
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const code = (
      await app.inject({ method: 'GET', url: '/api/v1/pairing' })
    ).json().pairingCode as string;
    const token = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/pairing/exchange',
        payload: { pairingCode: code },
      })
    ).json().integrationToken as string;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bridge/status',
      headers: { 'x-pi-integration-token': token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      activeSessions: 0,
      pendingTasks: 0,
      update: { installed: '0.81.1', available: false },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/bridge/status',
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });
});

describe('model settings API', () => {
  it('persists interactive and automation defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-model-api-'));
    const app = createApp({
      modelSettings: new ModelSettingsStore(join(root, 'settings.json')),
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/models/settings',
      payload: {
        interactive: { provider: 'openai', modelId: 'gpt-4.1' },
        automation: { provider: 'local', modelId: 'llama3.2' },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().interactive).toEqual({
      provider: 'openai',
      modelId: 'gpt-4.1',
    });
    const loaded = await app.inject({
      method: 'GET',
      url: '/api/v1/models/settings',
    });
    expect(loaded.json().automation).toEqual({
      provider: 'local',
      modelId: 'llama3.2',
    });
    await app.close();
    await rm(root, { recursive: true, force: true });
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

  it('protects structured tools with a per-session token', async () => {
    class CapturingRuntime extends MockPiRuntime {
      token: string | undefined;
      override async startSession(
        options: Parameters<MockPiRuntime['startSession']>[0],
      ) {
        this.token = options.toolToken;
        return super.startSession(options);
      }
    }
    const runtime = new CapturingRuntime();
    const client = {
      getStates: vi.fn(async () => [
        { entity_id: 'light.office', state: 'on' },
      ]),
      getEntityRegistry: vi.fn(async () => []),
      getDeviceRegistry: vi.fn(async () => []),
      getAreaRegistry: vi.fn(async () => []),
      getServices: vi.fn(async () => ({})),
      getCoreInfo: vi.fn(async () => ({})),
      getErrorLog: vi.fn(async () => ''),
      renderTemplate: vi.fn(async (value: string) => value),
      checkConfig: vi.fn(async () => ({ result: 'valid' })),
    } as unknown as HomeAssistantClient;
    const root = await mkdtemp(join(tmpdir(), 'pi-tool-api-'));
    const app = createApp({
      piRuntime: runtime,
      haClient: client,
      sessionRoot: root,
    });
    await app.ready();
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/sessions',
      payload: {},
    });
    expect(session.statusCode).toBe(200);
    expect(runtime.token).toBeTruthy();
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/ha_get_states',
      payload: {},
    });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/ha_get_states',
      headers: { 'x-pi-session-token': runtime.token },
      payload: {},
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().result).toEqual([
      { entity_id: 'light.office', state: 'on' },
    ]);
    await app.close();
  });

  it('exposes and persists the backend capability policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-policy-api-'));
    const app = createApp({
      policyStore: new PolicyStore(join(root, 'policy.json')),
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const defaults = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/policy',
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().shell_access).toBe('deny');
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/policy',
      payload: { read_runtime_state: 'deny' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().read_runtime_state).toBe('deny');
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/policy',
      payload: { shell_access: 'maybe' },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('exposes and persists Pi update channel settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-update-api-'));
    const app = createApp({
      piUpdateSettings: new PiUpdateSettingsStore(join(root, 'settings.json')),
      piUpdateManager: new PiUpdateManager({
        root: join(root, 'pi'),
        bundledVersion: '0.81.1',
      }),
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const initial = await app.inject({
      method: 'GET',
      url: '/api/v1/pi/update/status',
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().settings).toMatchObject({
      enabled: false,
      channel: 'pinned',
    });
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/pi/update/settings',
      payload: { enabled: true, channel: 'stable' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      enabled: true,
      channel: 'stable',
      lastCheck: null,
      latest: null,
      changelog: null,
      compatibility: 'unknown',
    });
    await app.close();
  });

  it('checks the configured release catalog and persists metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-release-api-'));
    const app = createApp({
      piUpdateSettings: new PiUpdateSettingsStore(join(root, 'settings.json')),
      piUpdateManager: new PiUpdateManager({
        root: join(root, 'pi'),
        bundledVersion: '0.81.1',
      }),
      piReleaseCatalog: new PiReleaseCatalog({
        packageName: 'pi-agent',
        registryUrl: 'https://registry.example.test/pi-agent',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              'dist-tags': { latest: '0.82.0' },
              versions: {
                '0.82.0': {
                  description: 'Release notes',
                  dist: {
                    tarball: 'https://registry.example.test/pi-agent.tgz',
                    integrity: 'sha512-YWJjZA==',
                  },
                },
              },
            }),
          ),
      }),
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/pi/update/settings',
      payload: { channel: 'stable' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pi/update/check',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().release).toMatchObject({ version: '0.82.0' });
    expect(response.json().settings.latest).toBe('0.82.0');
    await app.close();
  });
});

describe('staged task routes', () => {
  it('creates and transitions a bounded task record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-task-api-'));
    const taskStore = new TaskStore(':memory:');
    const app = createApp({
      taskStore,
      piRuntime: new MockPiRuntime(),
      sessionRoot: root,
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { prompt: 'Review automations', initiator: 'test' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const staged = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${id}/run`,
    });
    expect(staged.statusCode).toBe(200);
    const review = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}/review`,
    });
    expect(review.statusCode).toBe(200);
    const reviewed = review.json() as { id: string };
    const transactionApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${reviewed.id}/approve`,
      payload: {},
    });
    expect(transactionApproval.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].state).toBe('approved');
    await app.close();
    taskStore.close();
    await rm(root, { recursive: true, force: true });
  });

  it('runs a new task in an isolated workspace and stops for review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-task-run-'));
    const configRoot = join(root, 'config');
    await mkdir(configRoot);
    await writeFile(join(configRoot, 'automations.yaml'), 'old\n');
    const taskStore = new TaskStore(':memory:');
    const runtime = new MockPiRuntime();
    const startSession = vi.spyOn(runtime, 'startSession');
    const app = createApp({
      taskStore,
      piRuntime: runtime,
      sessionRoot: root,
      configRoot,
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { prompt: 'Inspect config', model: 'local:llama3.2' },
    });
    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/run`,
    });
    expect(result.statusCode).toBe(200);
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: 'local', modelId: 'llama3.2' },
      }),
    );
    expect(result.json().task.state).toBe('awaiting_review');
    expect(
      result
        .json()
        .events.some((event: { type: string }) => event.type === 'text_delta'),
    ).toBe(true);
    const id = created.json().id as string;
    await writeFile(join(root, `task-${id}`, 'automations.yaml'), 'new\n');
    const review = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}/review`,
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().files[0]).toMatchObject({
      path: 'automations.yaml',
      approved: false,
    });
    await app.close();
    taskStore.close();
    await rm(root, { recursive: true, force: true });
  });

  it('requires explicit activation confirmation and uses the injected adapter', async () => {
    const taskStore = new TaskStore(':memory:');
    const transactionStore = new TransactionStore(':memory:');
    const activationAdapter: ActivationAdapter = {
      validateCore: vi.fn(async () => ({ valid: true, errors: [] })),
      activate: vi.fn(async () => ({ ok: true })),
    };
    const app = createApp({
      taskStore,
      transactionStore,
      activationAdapter,
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    transactionStore.registerReview({
      id: 'tx-activation',
      taskId: 'task-activation',
      state: 'approved',
      diffHash: 'hash',
      files: [
        {
          path: 'automations.yaml',
          content: '[]\n',
          originalHash: null,
          approved: true,
        },
      ],
      validation: { status: 'passed', errors: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/tx-activation/activate',
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    const activated = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/tx-activation/activate',
      payload: { confirm: true },
    });
    expect(activated.statusCode).toBe(200);
    expect(activationAdapter.activate).toHaveBeenCalledOnce();
    await app.close();
    taskStore.close();
    transactionStore.close();
  });

  it('requests companion apply and accepts an authenticated result callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-apply-api-'));
    const pairing = new PairingManager(join(root, 'pairing.json'));
    const token = await pairing.exchange(
      (await pairing.status()).pairingCode ?? '',
    );
    const transactionStore = new TransactionStore(':memory:');
    const taskStore = new TaskStore(':memory:');
    const callService = vi.fn(async () => []);
    transactionStore.registerReview({
      id: 'tx-apply',
      taskId: 'task-apply',
      state: 'approved',
      diffHash: 'hash',
      files: [
        {
          path: 'automations.yaml',
          content: '[]\n',
          originalHash: null,
          approved: true,
        },
      ],
      validation: { status: 'passed', errors: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    const app = createApp({
      pairingManager: pairing,
      transactionStore,
      taskStore,
      haClient: { callService } as unknown as HomeAssistantClient,
    });
    await app.ready();
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/tx-apply/apply',
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/tx-apply/apply',
      payload: { confirm: true },
    });
    expect(requested.statusCode).toBe(200);
    expect(callService).toHaveBeenCalledWith(
      'pi_homeassistant_agent',
      'apply_transaction',
      { transaction_id: 'tx-apply' },
    );
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/transactions/tx-apply/result',
      headers: { 'x-pi-integration-token': token },
      payload: { status: 'completed' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().state).toBe('completed');
    await app.close();
    taskStore.close();
    transactionStore.close();
    await rm(root, { recursive: true, force: true });
  });

  it('exposes redacted audit history without credentials', async () => {
    const auditStore = new AuditStore(':memory:');
    const app = createApp({ auditStore, haClient: {} as HomeAssistantClient });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { prompt: 'inspect', initiator: 'test' },
    });
    expect(created.statusCode).toBe(201);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?limit=10',
    });
    expect(audit.statusCode).toBe(200);
    expect(
      audit
        .json()
        .some((event: { action: string }) => event.action === 'task.create'),
    ).toBe(true);
    await app.close();
    auditStore.close();
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

  it('fails closed for bridge calls without the exchanged token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bridge-'));
    const pairing = new PairingManager(join(root, 'pairing.json'));
    const code = (await pairing.status()).pairingCode ?? '';
    const token = await pairing.exchange(code);
    const transactionStore = new TransactionStore(':memory:');
    transactionStore.register({
      id: 'tx-approved',
      state: 'approved',
      diffHash: 'hash',
      files: [
        {
          path: 'automations.yaml',
          content: '[]\n',
          originalHash: null,
          approved: true,
        },
      ],
      validation: { status: 'passed', errors: [] },
      createdAt: '2026-01-01T00:00:00Z',
      approvedAt: '2026-01-01T00:01:00Z',
    });
    const runtime = {
      healthCheck: vi.fn(async () => ({
        healthy: true,
        version: null,
        capabilities: null,
        activeSessions: 0,
      })),
      startSession: vi.fn(async (options) => ({
        id: options.sessionId ?? 'bridge',
        workspace: options.workspace,
        startedAt: new Date().toISOString(),
        status: 'idle' as const,
      })),
      sendMessage: vi.fn(async function* () {
        yield { type: 'text_delta' as const, delta: 'bridge response' };
      }),
      closeSession: vi.fn(async () => {}),
    } as unknown as PiRuntime;
    const app = createApp({
      piRuntime: runtime,
      pairingManager: pairing,
      transactionStore,
      sessionRoot: root,
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    await expect(
      app.inject({
        method: 'POST',
        url: '/api/v1/bridge/run-prompt',
        payload: { prompt: 'hello' },
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/run-prompt',
      headers: { 'x-pi-integration-token': token },
      payload: { prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([
      { type: 'text_delta', delta: 'bridge response' },
    ]);
    const task = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/tasks',
      headers: { 'x-pi-integration-token': token },
      payload: { prompt: 'Review automation safety' },
    });
    expect(task.statusCode).toBe(201);
    const taskId = task.json().id as string;
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/bridge/tasks/${taskId}/cancel`,
      headers: { 'x-pi-integration-token': token },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().state).toBe('cancelled');
    const transaction = await app.inject({
      method: 'GET',
      url: '/api/v1/bridge/transactions/tx-approved',
      headers: { 'x-pi-integration-token': token },
    });
    expect(transaction.statusCode).toBe(200);
    expect(transaction.json().files[0].content).toBe('[]\n');
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('provides an authenticated, allowlisted bridge activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bridge-activation-'));
    const pairing = new PairingManager(join(root, 'pairing.json'));
    const token = await pairing.exchange(
      (await pairing.status()).pairingCode ?? '',
    );
    const activationAdapter: ActivationAdapter = {
      validateCore: vi.fn(async () => ({ valid: true, errors: [] })),
      activate: vi.fn(async (plan) => ({ plan })),
    };
    const app = createApp({
      pairingManager: pairing,
      activationAdapter,
      sessionRoot: root,
      haClient: {} as HomeAssistantClient,
    });
    await app.ready();
    const headers = { 'x-pi-integration-token': token };
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/reload-domain',
      headers,
      payload: { domain: 'automation' },
    });
    expect(missing.statusCode).toBe(400);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/reload-domain',
      headers,
      payload: { domain: 'arbitrary', confirm: true },
    });
    expect(invalid.statusCode).toBe(400);
    const activated = await app.inject({
      method: 'POST',
      url: '/api/v1/bridge/reload-domain',
      headers,
      payload: { domain: 'automation', confirm: true },
    });
    expect(activated.statusCode).toBe(200);
    expect(activationAdapter.validateCore).toHaveBeenCalledOnce();
    expect(activationAdapter.activate).toHaveBeenCalledOnce();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
});
