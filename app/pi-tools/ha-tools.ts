import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const brokerUrl = process.env.PI_HA_TOOL_BROKER_URL ?? 'http://127.0.0.1:8099';
const token = process.env.PI_HA_TOOL_TOKEN;

type ToolDefinition = {
  name: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
};

const tools: ToolDefinition[] = [
  {
    name: 'ha_get_states',
    description: 'List current Home Assistant entity states.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_list_entities',
    description: 'List the Home Assistant entity registry.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_list_devices',
    description: 'List registered Home Assistant devices.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_list_areas',
    description: 'List Home Assistant areas.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_list_services',
    description: 'List available Home Assistant services and schemas.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_get_core_info',
    description: 'Read Home Assistant core metadata.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_get_logs',
    description: 'Read the Home Assistant error log.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_check_config',
    description: 'Validate the Home Assistant configuration.',
    parameters: Type.Object({}),
  },
  {
    name: 'ha_render_template',
    description: 'Render a Home Assistant Jinja template.',
    parameters: Type.Object({ template: Type.String({ maxLength: 8192 }) }),
  },
  {
    name: 'ha_get_config_file',
    description: 'Read an allowlisted Home Assistant configuration file.',
    parameters: Type.Object({ path: Type.String({ maxLength: 512 }) }),
  },
  {
    name: 'workspace_read_file',
    description: 'Read a file from the assigned staging workspace.',
    parameters: Type.Object({ path: Type.String({ maxLength: 512 }) }),
  },
];

export default function registerHomeAssistantTools(pi: ExtensionAPI): void {
  for (const definition of tools) {
    pi.registerTool({
      ...definition,
      async execute(_toolCallId, params, signal) {
        if (!token) {
          return {
            content: [
              { type: 'text', text: 'Structured tool broker is unavailable.' },
            ],
            details: {},
            isError: true,
          };
        }
        try {
          const response = await fetch(
            `${brokerUrl}/api/v1/tools/${definition.name}`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                'x-pi-session-token': token,
              },
              body: JSON.stringify(params ?? {}),
              signal,
            },
          );
          const body = await response.text();
          if (!response.ok)
            throw new Error(
              body.slice(0, 2048) || `Broker returned ${response.status}`,
            );
          const parsed = JSON.parse(body) as { result?: unknown };
          const text = JSON.stringify(parsed.result ?? parsed, null, 2);
          return {
            content: [
              {
                type: 'text',
                text:
                  text.length > 64 * 1024
                    ? `${text.slice(0, 64 * 1024)}\n[truncated]`
                    : text,
              },
            ],
            details: { broker: true },
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text:
                  error instanceof Error
                    ? error.message
                    : 'Structured tool failed',
              },
            ],
            details: {},
            isError: true,
          };
        }
      },
    });
  }
}
