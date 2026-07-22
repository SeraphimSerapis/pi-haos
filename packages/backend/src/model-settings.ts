import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ModelSelection {
  provider: string;
  modelId: string;
}

export interface ModelSettings {
  interactive: ModelSelection | null;
  automation: ModelSelection | null;
}

export const defaultModelSettings: ModelSettings = {
  interactive: null,
  automation: null,
};

export class ModelSettingsStore {
  private settings: ModelSettings;
  private loaded = false;

  constructor(
    private readonly filePath = `${process.env.DATA_DIR ?? '/data'}/model-settings.json`,
  ) {
    this.settings = { ...defaultModelSettings };
  }

  async get(): Promise<ModelSettings> {
    await this.ensureLoaded();
    return clone(this.settings);
  }

  async update(input: Partial<ModelSettings>): Promise<ModelSettings> {
    await this.ensureLoaded();
    const next: ModelSettings = {
      interactive:
        input.interactive === undefined
          ? this.settings.interactive
          : validateSelection(input.interactive, 'interactive'),
      automation:
        input.automation === undefined
          ? this.settings.automation
          : validateSelection(input.automation, 'automation'),
    };
    this.settings = next;
    await this.persist();
    return clone(next);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      const value = parsed as Record<string, unknown>;
      this.settings = {
        interactive: readSelection(value.interactive),
        automation: readSelection(value.automation),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}

function validateSelection(
  value: ModelSelection | null,
  name: string,
): ModelSelection | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.provider !== 'string' ||
    typeof value.modelId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value.provider) ||
    value.modelId.trim().length === 0 ||
    value.modelId.length > 256
  )
    throw new Error(`${name} model selection is invalid`);
  return { provider: value.provider, modelId: value.modelId.trim() };
}

function readSelection(value: unknown): ModelSelection | null {
  try {
    return validateSelection(value as ModelSelection | null, 'stored');
  } catch {
    return null;
  }
}

function clone(settings: ModelSettings): ModelSettings {
  return {
    interactive: settings.interactive ? { ...settings.interactive } : null,
    automation: settings.automation ? { ...settings.automation } : null,
  };
}
