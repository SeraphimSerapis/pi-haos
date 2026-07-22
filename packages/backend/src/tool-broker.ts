import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { readConfigFile, type HomeAssistantClient } from '@pi-ha/ha-client';
import type { Capability, PolicyDecision } from './policy-store.js';

export type ToolCapability = Capability;
export type ToolPolicyDecision = PolicyDecision;
export type ToolPolicy = Partial<Record<ToolCapability, ToolPolicyDecision>>;

export interface ToolCallContext {
  sessionId: string;
  workspace?: string;
}

export interface ToolCallResult {
  tool: string;
  capability: ToolCapability;
  result: unknown;
}

const toolCapabilities: Record<string, ToolCapability> = {
  ha_get_states: 'read_runtime_state',
  ha_list_entities: 'read_entity_registry',
  ha_list_devices: 'read_device_registry',
  ha_list_areas: 'read_area_registry',
  ha_list_services: 'read_runtime_state',
  ha_get_core_info: 'read_runtime_state',
  ha_get_logs: 'read_logs',
  ha_render_template: 'render_templates',
  ha_check_config: 'read_config',
  ha_get_config_file: 'read_config',
  workspace_read_file: 'read_config',
};

export function listStructuredTools(): Array<{
  name: string;
  capability: ToolCapability;
  description: string;
}> {
  return Object.entries(toolCapabilities).map(([name, capability]) => ({
    name,
    capability,
    description: descriptions[name] ?? 'Read-only Home Assistant context tool',
  }));
}

export class ToolBroker {
  private policy: ToolPolicy;

  constructor(
    private readonly haClient: HomeAssistantClient,
    private readonly configRoot: string,
    policy: ToolPolicy = {},
  ) {
    this.policy = policy;
  }

  setPolicy(policy: ToolPolicy): void {
    this.policy = { ...policy };
  }

  async call(
    tool: string,
    input: Record<string, unknown> = {},
    context: ToolCallContext,
  ): Promise<ToolCallResult> {
    const capability = toolCapabilities[tool];
    if (!capability) throw new ToolBrokerError(404, `Unknown tool: ${tool}`);
    const decision = this.policy[capability] ?? 'allow';
    if (decision !== 'allow')
      throw new ToolBrokerError(
        403,
        decision === 'ask'
          ? `Tool requires approval: ${tool}`
          : `Tool denied by policy: ${tool}`,
      );
    validateInput(input);

    let result: unknown;
    switch (tool) {
      case 'ha_get_states':
        result = await this.haClient.getStates();
        break;
      case 'ha_list_entities':
        result = await this.haClient.getEntityRegistry();
        break;
      case 'ha_list_devices':
        result = await this.haClient.getDeviceRegistry();
        break;
      case 'ha_list_areas':
        result = await this.haClient.getAreaRegistry();
        break;
      case 'ha_list_services':
        result = await this.haClient.getServices();
        break;
      case 'ha_get_core_info':
        result = await this.haClient.getCoreInfo();
        break;
      case 'ha_get_logs':
        result = await this.haClient.getErrorLog();
        break;
      case 'ha_render_template':
        result = await this.haClient.renderTemplate(
          requiredString(input, 'template', 8192),
        );
        break;
      case 'ha_check_config':
        result = await this.haClient.checkConfig();
        break;
      case 'ha_get_config_file':
        try {
          result = await readConfigFile(
            this.configRoot,
            requiredString(input, 'path', 512),
          );
        } catch (error) {
          throw new ToolBrokerError(
            400,
            error instanceof Error ? error.message : 'Config file read failed',
          );
        }
        break;
      case 'workspace_read_file':
        result = await this.readWorkspaceFile(
          context,
          requiredString(input, 'path', 512),
        );
        break;
      default:
        throw new ToolBrokerError(404, `Unknown tool: ${tool}`);
    }
    return { tool, capability, result };
  }

  private async readWorkspaceFile(
    context: ToolCallContext,
    requestedPath: string,
  ): Promise<string> {
    if (!context.workspace)
      throw new ToolBrokerError(400, 'No workspace is assigned');
    let root: string;
    try {
      root = await realpath(context.workspace);
    } catch {
      throw new ToolBrokerError(400, 'Assigned workspace is unavailable');
    }
    const target = resolve(root, requestedPath);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..' + '/') || isAbsolute(rel))
      throw new ToolBrokerError(
        400,
        'Workspace path escapes the assigned workspace',
      );
    let targetReal: string;
    try {
      targetReal = await realpath(target);
    } catch {
      throw new ToolBrokerError(400, 'Workspace file does not exist');
    }
    if (targetReal !== target && !targetReal.startsWith(`${root}/`))
      throw new ToolBrokerError(
        400,
        'Workspace path escapes the assigned workspace',
      );
    const metadata = await stat(targetReal);
    if (!metadata.isFile())
      throw new ToolBrokerError(400, 'Workspace path is not a file');
    if (metadata.size > 256 * 1024)
      throw new ToolBrokerError(413, 'Workspace file is too large');
    return readFile(targetReal, 'utf8');
  }
}

export class ToolBrokerError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ToolBrokerError';
  }
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
  max: number,
): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ToolBrokerError(
      400,
      `${key} must be a non-empty string of at most ${max} characters`,
    );
  return value;
}

function validateInput(input: Record<string, unknown>): void {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ToolBrokerError(400, 'Tool input must be an object');
  if (JSON.stringify(input).length > 16 * 1024)
    throw new ToolBrokerError(413, 'Tool input is too large');
}

const descriptions: Record<string, string> = {
  ha_get_states: 'List current Home Assistant entity states.',
  ha_list_entities: 'List the Home Assistant entity registry.',
  ha_list_devices: 'List registered Home Assistant devices.',
  ha_list_areas: 'List Home Assistant areas.',
  ha_list_services: 'List available Home Assistant services and schemas.',
  ha_get_core_info: 'Read Home Assistant core configuration metadata.',
  ha_get_logs: 'Read the Home Assistant error log.',
  ha_render_template: 'Render a Home Assistant Jinja template.',
  ha_check_config: 'Validate the Home Assistant configuration.',
  ha_get_config_file: 'Read an allowlisted Home Assistant configuration file.',
  workspace_read_file: 'Read a file from the task staging workspace.',
};
