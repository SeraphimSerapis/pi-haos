import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ModelProviderRecord {
  id: string;
  name: string;
  kind: 'openai' | 'openai-compatible' | 'local';
  endpoint: string;
  models: string[];
  apiKey?: string;
  enabled: boolean;
  updatedAt: string;
}

export type PublicModelProvider = Omit<ModelProviderRecord, 'apiKey'> & {
  hasApiKey: boolean;
};

export interface ModelProviderInput {
  id: string;
  name: string;
  kind: ModelProviderRecord['kind'];
  endpoint: string;
  models: string[];
  apiKey?: string;
  enabled?: boolean;
}

export class ModelCatalog {
  private providers: ModelProviderRecord[] = [];
  private loaded = false;

  constructor(
    private readonly filePath = join(
      process.env.DATA_DIR ?? '/data',
      'models.json',
    ),
  ) {}

  async list(): Promise<PublicModelProvider[]> {
    await this.ensureLoaded();
    return this.providers.map(({ apiKey, ...provider }) => ({
      ...provider,
      hasApiKey: Boolean(apiKey),
    }));
  }

  async upsert(input: ModelProviderInput): Promise<PublicModelProvider> {
    await this.ensureLoaded();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input.id))
      throw new Error('Provider id is invalid');
    if (!/^https?:\/\//.test(input.endpoint))
      throw new Error('Provider endpoint must be an http(s) URL');
    if (input.models.length === 0)
      throw new Error('At least one model is required');
    const existing = this.providers.find(
      (provider) => provider.id === input.id,
    );
    const record: ModelProviderRecord = {
      id: input.id,
      name: input.name.trim() || input.id,
      kind: input.kind,
      endpoint: input.endpoint.replace(/\/$/, ''),
      models: [
        ...new Set(input.models.map((model) => model.trim()).filter(Boolean)),
      ],
      enabled: input.enabled ?? existing?.enabled ?? true,
      updatedAt: new Date().toISOString(),
    };
    const keyValue = input.apiKey || existing?.apiKey;
    if (keyValue) record.apiKey = keyValue;
    if (record.models.length === 0)
      throw new Error('At least one non-empty model is required');
    if (existing) this.providers[this.providers.indexOf(existing)] = record;
    else this.providers.push(record);
    await this.persist();
    const { apiKey, ...publicRecord } = record;
    return { ...publicRecord, hasApiKey: Boolean(apiKey) };
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.providers = this.providers.filter((provider) => provider.id !== id);
    await this.persist();
  }

  async get(id: string): Promise<ModelProviderRecord | undefined> {
    await this.ensureLoaded();
    return this.providers.find((provider) => provider.id === id);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as unknown;
      if (Array.isArray(parsed)) this.providers = parsed.filter(isProvider);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.providers, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}

function isProvider(value: unknown): value is ModelProviderRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ModelProviderRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    (record.kind === 'openai' ||
      record.kind === 'openai-compatible' ||
      record.kind === 'local') &&
    typeof record.endpoint === 'string' &&
    Array.isArray(record.models) &&
    record.models.every((model) => typeof model === 'string') &&
    typeof record.enabled === 'boolean' &&
    typeof record.updatedAt === 'string'
  );
}
