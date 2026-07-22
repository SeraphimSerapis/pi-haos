import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type PiUpdateChannel = 'stable' | 'pinned';
export type PiCompatibility = 'compatible' | 'incompatible' | 'unknown';

export interface PiUpdateSettings {
  enabled: boolean;
  channel: PiUpdateChannel;
  lastCheck: string | null;
  latest: string | null;
  changelog: string | null;
  compatibility: PiCompatibility;
}

export interface PiUpdateSettingsInput {
  enabled?: boolean;
  channel?: PiUpdateChannel;
}

export const defaultPiUpdateSettings: PiUpdateSettings = {
  enabled: false,
  channel: 'pinned',
  lastCheck: null,
  latest: null,
  changelog: null,
  compatibility: 'unknown',
};

export class PiUpdateSettingsStore {
  private settings: PiUpdateSettings;

  constructor(
    private readonly filePath = `${process.env.DATA_DIR ?? '/data'}/pi/update-settings.json`,
  ) {
    this.settings = load(filePath, process.env.PI_UPDATES_ENABLED === 'true');
  }

  get(): PiUpdateSettings {
    return { ...this.settings };
  }

  async update(input: PiUpdateSettingsInput): Promise<PiUpdateSettings> {
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw new Error('Pi update enabled must be boolean');
    if (
      input.channel !== undefined &&
      input.channel !== 'stable' &&
      input.channel !== 'pinned'
    )
      throw new Error('Pi update channel must be stable or pinned');
    this.settings = {
      ...this.settings,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.channel === undefined ? {} : { channel: input.channel }),
    };
    await persist(this.filePath, this.settings);
    return this.get();
  }

  async recordCheck(input: {
    latest: string | null;
    changelog?: string | null;
    compatibility?: PiCompatibility;
  }): Promise<PiUpdateSettings> {
    if (
      input.latest !== null &&
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.latest)
    )
      throw new Error('Latest Pi version is invalid');
    if (
      input.changelog !== undefined &&
      input.changelog !== null &&
      input.changelog.length > 4096
    )
      throw new Error('Pi changelog is too large');
    if (
      input.compatibility !== undefined &&
      !['compatible', 'incompatible', 'unknown'].includes(input.compatibility)
    )
      throw new Error('Pi compatibility is invalid');
    this.settings = {
      ...this.settings,
      latest: input.latest,
      lastCheck: new Date().toISOString(),
      ...(input.changelog === undefined ? {} : { changelog: input.changelog }),
      ...(input.compatibility === undefined
        ? {}
        : { compatibility: input.compatibility }),
    };
    await persist(this.filePath, this.settings);
    return this.get();
  }
}

function load(filePath: string, initialEnabled: boolean): PiUpdateSettings {
  if (!existsSync(filePath))
    return { ...defaultPiUpdateSettings, enabled: initialEnabled };
  try {
    const value = JSON.parse(
      readFileSync(filePath, 'utf8'),
    ) as Partial<PiUpdateSettings>;
    return {
      enabled:
        typeof value.enabled === 'boolean'
          ? value.enabled
          : defaultPiUpdateSettings.enabled,
      channel:
        value.channel === 'stable' || value.channel === 'pinned'
          ? value.channel
          : 'pinned',
      lastCheck: typeof value.lastCheck === 'string' ? value.lastCheck : null,
      latest: typeof value.latest === 'string' ? value.latest : null,
      changelog: typeof value.changelog === 'string' ? value.changelog : null,
      compatibility:
        value.compatibility === 'compatible' ||
        value.compatibility === 'incompatible' ||
        value.compatibility === 'unknown'
          ? value.compatibility
          : 'unknown',
    };
  } catch {
    return { ...defaultPiUpdateSettings, enabled: initialEnabled };
  }
}

async function persist(
  filePath: string,
  settings: PiUpdateSettings,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
}
