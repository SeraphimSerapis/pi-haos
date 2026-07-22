import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const capabilities = [
  'read_config',
  'read_runtime_state',
  'read_entity_registry',
  'read_device_registry',
  'read_area_registry',
  'read_logs',
  'render_templates',
  'write_staging',
  'apply_config',
  'call_read_only_services',
  'call_mutating_services',
  'reload_domains',
  'restart_core',
  'manage_skills',
  'update_pi',
  'network_access',
  'shell_access',
] as const;

export type Capability = (typeof capabilities)[number];
export type PolicyDecision = 'allow' | 'ask' | 'deny';
export type CapabilityPolicy = Record<Capability, PolicyDecision>;

export const defaultCapabilityPolicy: CapabilityPolicy = {
  read_config: 'allow',
  read_runtime_state: 'allow',
  read_entity_registry: 'allow',
  read_device_registry: 'allow',
  read_area_registry: 'allow',
  read_logs: 'allow',
  render_templates: 'allow',
  write_staging: 'ask',
  apply_config: 'ask',
  call_read_only_services: 'allow',
  call_mutating_services: 'ask',
  reload_domains: 'ask',
  restart_core: 'ask',
  manage_skills: 'ask',
  update_pi: 'ask',
  network_access: 'deny',
  shell_access: 'deny',
};

export class PolicyStore {
  private policy: CapabilityPolicy;

  constructor(
    private readonly filePath = `${process.env.DATA_DIR ?? '/data'}/policy.json`,
  ) {
    this.policy = loadPolicy(filePath);
  }

  get(): CapabilityPolicy {
    return { ...this.policy };
  }

  async replace(input: unknown): Promise<CapabilityPolicy> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Capability policy must be an object');
    const next = { ...this.policy };
    for (const [key, value] of Object.entries(input)) {
      if (!(capabilities as readonly string[]).includes(key))
        throw new Error(`Unknown capability: ${key}`);
      if (value !== 'allow' && value !== 'ask' && value !== 'deny')
        throw new Error(`Invalid decision for ${key}`);
      next[key as Capability] = value;
    }
    this.policy = next;
    await persistPolicy(this.filePath, next);
    return this.get();
  }
}

function loadPolicy(filePath: string): CapabilityPolicy {
  if (!existsSync(filePath)) return { ...defaultCapabilityPolicy };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const merged = { ...defaultCapabilityPolicy };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return merged;
    for (const [key, value] of Object.entries(parsed)) {
      if (
        (capabilities as readonly string[]).includes(key) &&
        (value === 'allow' || value === 'ask' || value === 'deny')
      )
        merged[key as Capability] = value;
    }
    return merged;
  } catch {
    return { ...defaultCapabilityPolicy };
  }
}

async function persistPolicy(
  filePath: string,
  policy: CapabilityPolicy,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
}
