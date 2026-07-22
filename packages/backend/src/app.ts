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
  PiUpdateManager,
  type PiRuntime,
  type SessionInfo,
} from '@pi-ha/pi-runtime';
import { PairingManager } from './pairing.js';
import { TransactionStore } from './transaction-store.js';
import { TaskStore } from './task-store.js';
import { scanWorkspace } from './workspace-scanner.js';
import { validateYamlTransaction } from './transaction-validation.js';
import {
  HomeAssistantActivationAdapter,
  inferActivationPlan,
  type ActivationAdapter,
} from './activation.js';
import { AuditStore, type AuditEventInput } from './audit-store.js';
import {
  ToolBroker,
  ToolBrokerError,
  listStructuredTools,
} from './tool-broker.js';

const appVersion = process.env.APP_VERSION ?? '0.1.0';

export interface AppOptions {
  haClient?: HomeAssistantClient;
  configRoot?: string;
  modelCatalog?: ModelCatalog;
  skillsManager?: SkillsManager;
  piRuntime?: PiRuntime;
  sessionRoot?: string;
  pairingManager?: PairingManager;
  transactionStore?: TransactionStore;
  activationAdapter?: ActivationAdapter;
  taskStore?: TaskStore;
  auditStore?: AuditStore;
  piUpdateManager?: PiUpdateManager;
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
  const activationAdapter =
    options.activationAdapter ?? new HomeAssistantActivationAdapter(haClient);
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
  const sessionTokens = new Map<string, string>();
  const toolBroker = new ToolBroker(haClient, configRoot);
  const sessionRoot =
    options.sessionRoot ?? join(process.env.DATA_DIR ?? '/data', 'sessions');
  const pairing = options.pairingManager ?? new PairingManager();
  const transactionStore =
    options.transactionStore ??
    new TransactionStore(
      process.env.TRANSACTION_DATABASE ??
        (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
          ? ':memory:'
          : join(
              process.env.DATA_DIR ?? '/data',
              'database',
              'transactions.sqlite',
            )),
    );
  const taskStore =
    options.taskStore ??
    new TaskStore(
      process.env.TASK_DATABASE ??
        (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
          ? ':memory:'
          : join(process.env.DATA_DIR ?? '/data', 'database', 'tasks.sqlite')),
    );
  const auditStore =
    options.auditStore ??
    new AuditStore(
      process.env.AUDIT_DATABASE ??
        (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
          ? ':memory:'
          : join(process.env.DATA_DIR ?? '/data', 'database', 'audit.sqlite')),
    );
  const audit = (event: AuditEventInput): void => {
    try {
      auditStore.record(event);
    } catch {
      // Audit failure must not widen authority or block a safe read operation.
    }
  };
  const piUpdateManager =
    options.piUpdateManager ??
    new PiUpdateManager({
      root: join(process.env.DATA_DIR ?? '/data', 'pi'),
      bundledVersion: process.env.PI_VERSION ?? '0.81.1',
      isIdle: () => sessions.size === 0,
    });

  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/pairing', async () => pairing.status());
  app.post<{ Body: { pairingCode?: string } }>(
    '/api/v1/pairing/exchange',
    async (request, reply) => {
      if (!request.body?.pairingCode)
        return reply.code(400).send({ error: 'pairingCode is required' });
      try {
        return {
          integrationToken: await pairing.exchange(request.body.pairingCode),
        };
      } catch (error) {
        return reply.code(401).send({
          error: error instanceof Error ? error.message : 'Pairing failed',
        });
      }
    },
  );

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
  app.get('/api/v1/tools', async () => listStructuredTools());
  app.post<{
    Params: { name: string };
    Headers: { 'x-pi-session-token'?: string };
    Body: Record<string, unknown>;
  }>('/api/v1/tools/:name', async (request, reply) => {
    const token = request.headers['x-pi-session-token'];
    const sessionId =
      [...sessionTokens.entries()].find(([, value]) => value === token)?.[0] ??
      null;
    if (!sessionId)
      return reply
        .code(401)
        .send({ error: 'Valid Pi session token is required' });
    try {
      const workspace = sessions.get(sessionId)?.workspace;
      const result = await toolBroker.call(
        request.params.name,
        request.body ?? {},
        {
          sessionId,
          ...(workspace ? { workspace } : {}),
        },
      );
      audit({
        action: 'tool.call',
        initiator: 'pi',
        sessionId,
        decision: 'allowed',
        details: { tool: request.params.name, capability: result.capability },
      });
      return result;
    } catch (error) {
      const status = error instanceof ToolBrokerError ? error.statusCode : 500;
      audit({
        action: 'tool.call',
        initiator: 'pi',
        sessionId,
        decision: 'denied',
        details: {
          tool: request.params.name,
          error: error instanceof Error ? error.message : 'Tool call failed',
        },
      });
      return reply.code(status).send({
        error: error instanceof Error ? error.message : 'Tool call failed',
      });
    }
  });

  app.get('/api/v1/pi/health', async () => piRuntime.healthCheck());
  app.get('/api/v1/pi/update/status', async () => piUpdateManager.status());
  app.post<{ Body: { version?: string; confirm?: boolean } }>(
    '/api/v1/pi/update/activate',
    async (request, reply) => {
      if (request.body?.confirm !== true)
        return reply
          .code(400)
          .send({ error: 'Explicit Pi activation confirmation is required' });
      if (!request.body.version)
        return reply.code(400).send({ error: 'version is required' });
      try {
        const status = await piUpdateManager.activate(request.body.version);
        audit({
          action: 'pi.update.activate',
          initiator: 'frontend',
          piVersion: request.body.version,
          decision: 'approved',
          details: { status },
        });
        return status;
      } catch (error) {
        return reply.code(409).send({
          error:
            error instanceof Error ? error.message : 'Pi activation failed',
        });
      }
    },
  );
  app.post('/api/v1/pi/update/rollback', async (request, reply) => {
    if ((request.body as { confirm?: boolean } | undefined)?.confirm !== true)
      return reply
        .code(400)
        .send({ error: 'Explicit Pi rollback confirmation is required' });
    try {
      const status = await piUpdateManager.rollback();
      audit({
        action: 'pi.update.rollback',
        initiator: 'frontend',
        piVersion: status.active,
        decision: 'approved',
        details: { status },
      });
      return status;
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'Pi rollback failed',
      });
    }
  });
  app.get('/api/v1/transactions', async () => transactionStore.list());
  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/audit',
    async (request) => auditStore.list(Number(request.query.limit ?? 100)),
  );
  app.get('/api/v1/tasks', async () => taskStore.list());
  app.get<{ Params: { id: string } }>(
    '/api/v1/tasks/:id',
    async (request, reply) => {
      const task = taskStore.get(request.params.id);
      return task ? task : reply.code(404).send({ error: 'Task not found' });
    },
  );
  app.post<{
    Body: {
      prompt?: string;
      initiator?: string;
      model?: string;
      provider?: string;
      skills?: string[];
    };
  }>('/api/v1/tasks', async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt || prompt.length > 8192)
      return reply
        .code(400)
        .send({ error: 'prompt must be 1-8192 characters' });
    const skills = request.body?.skills ?? [];
    if (
      !Array.isArray(skills) ||
      skills.length > 100 ||
      skills.some((skill) => typeof skill !== 'string')
    )
      return reply
        .code(400)
        .send({ error: 'skills must be a bounded string array' });
    const task = taskStore.create({
      prompt,
      initiator: request.body?.initiator ?? 'frontend',
      model: request.body?.model ?? null,
      provider: request.body?.provider ?? null,
      piVersion: process.env.PI_VERSION ?? null,
      skills,
    });
    audit({
      action: 'task.create',
      initiator: task.initiator,
      taskId: task.id,
      model: task.model ?? undefined,
      provider: task.provider ?? undefined,
      piVersion: task.piVersion ?? undefined,
      details: { prompt: task.prompt, skills: task.skills },
    });
    return reply.code(201).send(task);
  });
  app.post<{ Params: { id: string; action: string } }>(
    '/api/v1/tasks/:id/:action',
    async (request, reply) => {
      const action = request.params.action;
      const state =
        action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : action === 'cancel'
              ? 'cancelled'
              : null;
      if (!state) return reply.code(404).send({ error: 'Unknown task action' });
      const currentTask = taskStore.get(request.params.id);
      if (state === 'approved') {
        const transaction = currentTask?.transactionId
          ? transactionStore.get(currentTask.transactionId)
          : undefined;
        if (
          currentTask?.state !== 'awaiting_review' ||
          transaction?.state !== 'approved'
        )
          return reply.code(409).send({
            error: 'Approve the reviewed transaction before approving the task',
          });
      }
      const task = taskStore.transition(request.params.id, state);
      if (task)
        audit({
          action: `task.${action}`,
          initiator: 'frontend',
          taskId: task.id,
          ...(task.transactionId ? { transactionId: task.transactionId } : {}),
          details: { state: task.state },
        });
      return task ? task : reply.code(404).send({ error: 'Task not found' });
    },
  );
  app.post<{ Body: { model?: { provider: string; modelId: string } } }>(
    '/api/v1/chat/sessions',
    async (request) => {
      const id = randomUUID();
      const workspace = join(sessionRoot, id);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const toolToken = randomUUID();
      const session = await piRuntime.startSession({
        sessionId: id,
        workspace,
        toolToken,
        toolBrokerUrl: process.env.TOOL_BROKER_URL ?? 'http://127.0.0.1:8099',
        ...(request.body?.model ? { model: request.body.model } : {}),
      });
      sessions.set(id, session);
      sessionTokens.set(id, toolToken);
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
      sessionTokens.delete(request.params.id);
      return { status: 'closed' };
    },
  );

  const requireBridgeAuth = async (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    const header = request.headers['x-pi-integration-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token || !(await pairing.authenticate(token)))
      return reply.code(401).send({ error: 'Bridge authentication failed' });
  };
  app.post<{
    Body: { prompt?: string; model?: { provider: string; modelId: string } };
  }>(
    '/api/v1/bridge/run-prompt',
    { preHandler: requireBridgeAuth },
    async (request, reply) => {
      const prompt = request.body?.prompt?.trim();
      if (!prompt) return reply.code(400).send({ error: 'prompt is required' });
      const id = randomUUID();
      const workspace = join(sessionRoot, `bridge-${id}`);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const toolToken = randomUUID();
      await piRuntime.startSession({
        sessionId: id,
        workspace,
        toolToken,
        toolBrokerUrl: process.env.TOOL_BROKER_URL ?? 'http://127.0.0.1:8099',
        ...(request.body?.model ? { model: request.body.model } : {}),
      });
      sessions.set(id, {
        id,
        workspace,
        startedAt: new Date().toISOString(),
        status: 'idle',
      });
      sessionTokens.set(id, toolToken);
      try {
        const events = [];
        for await (const event of piRuntime.sendMessage(id, prompt))
          events.push(event);
        return { sessionId: id, events };
      } finally {
        await piRuntime.closeSession(id);
        sessions.delete(id);
        sessionTokens.delete(id);
      }
    },
  );
  app.post(
    '/api/v1/bridge/tasks',
    { preHandler: requireBridgeAuth },
    async (request, reply) => {
      const body = request.body as
        { prompt?: string; model?: string } | undefined;
      const prompt = body?.prompt?.trim();
      if (!prompt || prompt.length > 8192)
        return reply
          .code(400)
          .send({ error: 'prompt must be 1-8192 characters' });
      const task = taskStore.create({
        prompt,
        initiator: 'home-assistant-automation',
        model: body?.model ?? null,
        provider: null,
        piVersion: process.env.PI_VERSION ?? null,
        skills: [],
      });
      audit({
        action: 'task.create',
        initiator: task.initiator,
        taskId: task.id,
        model: task.model ?? undefined,
        piVersion: task.piVersion ?? undefined,
        details: { prompt: task.prompt, source: 'bridge' },
      });
      return reply.code(201).send(task);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/bridge/transactions/:id',
    { preHandler: requireBridgeAuth },
    async (request, reply) => {
      const transaction = transactionStore.getApproved(request.params.id);
      if (!transaction)
        return reply
          .code(404)
          .send({ error: 'Approved validated transaction not found' });
      return transaction;
    },
  );
  app.post<{ Params: { id: string; action: string } }>(
    '/api/v1/bridge/tasks/:id/:action',
    { preHandler: requireBridgeAuth },
    async (request, reply) => {
      const state =
        request.params.action === 'approve'
          ? 'approved'
          : request.params.action === 'reject'
            ? 'rejected'
            : request.params.action === 'cancel'
              ? 'cancelled'
              : null;
      if (!state) return reply.code(404).send({ error: 'Unknown task action' });
      const currentTask = taskStore.get(request.params.id);
      if (state === 'approved') {
        const transaction = currentTask?.transactionId
          ? transactionStore.get(currentTask.transactionId)
          : undefined;
        if (
          currentTask?.state !== 'awaiting_review' ||
          transaction?.state !== 'approved'
        )
          return reply.code(409).send({
            error: 'Approve the reviewed transaction before approving the task',
          });
      }
      const task = taskStore.transition(request.params.id, state);
      if (task)
        audit({
          action: `task.bridge_${request.params.action}`,
          initiator: 'home-assistant-automation',
          taskId: task.id,
          ...(task.transactionId ? { transactionId: task.transactionId } : {}),
          details: { state: task.state },
        });
      return task ? task : reply.code(404).send({ error: 'Task not found' });
    },
  );
  app.post(
    '/api/v1/bridge/reload-domain',
    { preHandler: requireBridgeAuth },
    async (_request, reply) =>
      reply
        .code(501)
        .send({ error: 'Reload approval bridge is not enabled yet' }),
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
  app.get<{ Params: { id: string } }>(
    '/api/v1/transactions/:id/activation',
    async (request, reply) => {
      const transaction = transactionStore.get(request.params.id);
      if (!transaction)
        return reply.code(404).send({ error: 'Transaction not found' });
      return inferActivationPlan(transaction);
    },
  );
  app.post<{ Params: { id: string }; Body: { confirm?: boolean } }>(
    '/api/v1/transactions/:id/activate',
    async (request, reply) => {
      const transaction = transactionStore.get(request.params.id);
      if (!transaction)
        return reply.code(404).send({ error: 'Transaction not found' });
      if (
        transaction.state !== 'approved' ||
        transaction.validation.status !== 'passed'
      )
        return reply.code(409).send({
          error: 'Transaction must be approved and validated before activation',
        });
      if (request.body?.confirm !== true)
        return reply
          .code(400)
          .send({ error: 'Explicit activation confirmation is required' });
      const plan = inferActivationPlan(transaction);
      if (plan.action === 'none') return { status: 'no_action', plan };
      const validation = await activationAdapter.validateCore();
      if (!validation.valid) {
        transactionStore.update({
          ...transaction,
          validation: { status: 'failed', errors: validation.errors },
          updatedAt: new Date().toISOString(),
        });
        return reply.code(409).send({
          error: 'Home Assistant configuration validation failed',
          validation,
        });
      }
      const result = await activationAdapter.activate(plan);
      audit({
        action: 'transaction.activate',
        initiator: 'frontend',
        transactionId: transaction.id,
        decision: 'approved',
        details: { plan },
      });
      return { status: 'activated', plan, result };
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/tasks/:id/review',
    async (request, reply) => {
      const task = taskStore.get(request.params.id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      if (task.state !== 'awaiting_review')
        return reply.code(409).send({ error: 'Task is not awaiting review' });
      const transactionId = task.transactionId ?? randomUUID();
      try {
        const transaction = await scanWorkspace({
          workspace: join(sessionRoot, `task-${task.id}`),
          configRoot,
          taskId: task.id,
          transactionId,
        });
        transactionStore.registerReview(transaction);
        taskStore.transition(task.id, 'awaiting_review', { transactionId });
        audit({
          action: 'transaction.stage',
          initiator: task.initiator,
          taskId: task.id,
          transactionId,
          model: task.model ?? undefined,
          piVersion: task.piVersion ?? undefined,
          details: {
            files: transaction.files.map((file) => file.path),
            diffHash: transaction.diffHash,
          },
        });
        return transaction;
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to scan staging workspace',
        });
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { paths?: string[] } }>(
    '/api/v1/transactions/:id/approve',
    async (request, reply) => {
      const transaction = transactionStore.approve(
        request.params.id,
        request.body?.paths,
      );
      if (!transaction)
        return reply
          .code(409)
          .send({ error: 'Transaction is not awaiting review' });
      taskStore.transition(transaction.taskId, 'approved', {
        transactionId: transaction.id,
      });
      audit({
        action: 'transaction.approve',
        initiator: 'frontend',
        taskId: transaction.taskId,
        transactionId: transaction.id,
        decision: 'approved',
        details: {
          files: transaction.files
            .filter((file) => file.approved)
            .map((file) => file.path),
        },
      });
      return transaction;
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/transactions/:id/validate',
    async (request, reply) => {
      const transaction = transactionStore.get(request.params.id);
      if (!transaction)
        return reply.code(404).send({ error: 'Transaction not found' });
      const validated = transactionStore.update(
        validateYamlTransaction(transaction),
      );
      audit({
        action: 'transaction.validate_yaml',
        initiator: 'frontend',
        taskId: validated.taskId,
        transactionId: validated.id,
        decision: validated.validation.status,
        details: { errors: validated.validation.errors },
      });
      return validated;
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
  app.post<{ Params: { id: string } }>(
    '/api/v1/tasks/:id/run',
    async (request, reply) => {
      const task = taskStore.get(request.params.id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      if (task.state !== 'created')
        return reply
          .code(409)
          .send({ error: 'Only newly created tasks can run' });
      taskStore.transition(task.id, 'planning');
      audit({
        action: 'task.run',
        initiator: task.initiator,
        taskId: task.id,
        model: task.model ?? undefined,
        provider: task.provider ?? undefined,
        piVersion: task.piVersion ?? undefined,
        details: { workspace: `task-${task.id}` },
      });
      const workspace = join(sessionRoot, `task-${task.id}`);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const sessionId = `task-${task.id}`;
      const toolToken = randomUUID();
      try {
        const session = await piRuntime.startSession({
          sessionId,
          workspace,
          toolToken,
          toolBrokerUrl: process.env.TOOL_BROKER_URL ?? 'http://127.0.0.1:8099',
        });
        sessions.set(sessionId, session);
        sessionTokens.set(sessionId, toolToken);
        const events = [];
        let responseSize = 0;
        const guardedPrompt = `Work only in the assigned staging workspace. Do not modify live Home Assistant files. Inspect and propose changes for this task; leave any proposed files in the workspace for review.\n\nUser task:\n${task.prompt}`;
        for await (const event of piRuntime.sendMessage(
          sessionId,
          guardedPrompt,
        )) {
          responseSize += Buffer.byteLength(JSON.stringify(event), 'utf8');
          if (responseSize > 256 * 1024) {
            taskStore.transition(task.id, 'failed', {
              error: 'Agent response exceeded the configured size limit',
            });
            return reply.code(413).send({
              error: 'Agent response exceeded the configured size limit',
            });
          }
          events.push(event);
        }
        const updated = taskStore.transition(task.id, 'awaiting_review');
        audit({
          action: 'task.awaiting_review',
          initiator: task.initiator,
          taskId: task.id,
          details: { eventCount: events.length },
        });
        return { task: updated, sessionId, workspace, events };
      } catch (error) {
        const updated = taskStore.transition(task.id, 'failed', {
          error: error instanceof Error ? error.message : 'Pi task failed',
        });
        audit({
          action: 'task.failed',
          initiator: task.initiator,
          taskId: task.id,
          decision: 'failed',
          details: { error: updated?.error ?? 'Pi task failed' },
        });
        return reply.code(502).send({ task: updated, error: 'Pi task failed' });
      } finally {
        await piRuntime.closeSession(sessionId).catch(() => undefined);
        sessions.delete(sessionId);
        sessionTokens.delete(sessionId);
      }
    },
  );
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
