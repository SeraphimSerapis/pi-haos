import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { SkillManifest, SkillRecord, SkillSource } from './types.js';

const idPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;

export class SkillsManager {
  private readonly directories: Record<SkillSource, string>;

  constructor(
    private readonly root = join(process.env.DATA_DIR ?? '/data', 'skills'),
  ) {
    this.directories = {
      bundled: join(root, 'bundled'),
      installed: join(root, 'installed'),
      user: join(root, 'user'),
    };
  }

  async list(): Promise<SkillRecord[]> {
    const result: SkillRecord[] = [];
    for (const source of Object.keys(this.directories) as SkillSource[]) {
      const directory = this.directories[source];
      let entries: string[] = [];
      try {
        entries = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const id of entries) {
        try {
          result.push(await this.read(source, id));
        } catch {
          /* Ignore malformed skills in listing; diagnostics can inspect them later. */
        }
      }
    }
    return result;
  }

  async read(source: SkillSource, id: string): Promise<SkillRecord> {
    validateId(id);
    const directory = join(this.directories[source], id);
    const manifest = validateManifest(
      parse(await readFile(join(directory, 'manifest.yaml'), 'utf8')),
      source,
    );
    return {
      manifest,
      content: await readFile(join(directory, 'SKILL.md'), 'utf8'),
    };
  }

  async save(
    manifest: Omit<SkillManifest, 'source'>,
    content: string,
    source: Exclude<SkillSource, 'bundled'> = 'user',
  ): Promise<SkillRecord> {
    validateId(manifest.id);
    const record = {
      manifest: validateManifest({ ...manifest, source }, source),
      content,
    };
    const directory = join(this.directories[source], manifest.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.atomicWrite(
      join(directory, 'manifest.yaml'),
      stringify(record.manifest),
    );
    await this.atomicWrite(join(directory, 'SKILL.md'), content);
    return record;
  }

  async setEnabled(
    source: SkillSource,
    id: string,
    enabled: boolean,
  ): Promise<SkillRecord> {
    const record = await this.read(source, id);
    if (source === 'bundled' && !enabled)
      throw new Error('Bundled skills cannot be disabled');
    return this.save(
      { ...record.manifest, enabled },
      record.content,
      source === 'bundled' ? 'user' : source,
    );
  }

  async remove(source: SkillSource, id: string): Promise<void> {
    if (source === 'bundled')
      throw new Error('Bundled skills cannot be removed');
    validateId(id);
    await rm(join(this.directories[source], id), {
      recursive: true,
      force: false,
    });
  }

  async rollback(
    source: Exclude<SkillSource, 'bundled'>,
    id: string,
  ): Promise<SkillRecord> {
    validateId(id);
    const backup = join(this.root, 'metadata', 'rollback', source, id);
    const current = join(this.directories[source], id);
    await rm(current, { recursive: true, force: true });
    await cp(backup, current, { recursive: true, errorOnExist: true });
    return this.read(source, id);
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  }
}

function validateId(id: string): void {
  if (!idPattern.test(id))
    throw new Error('Skill id must be lowercase kebab-case (2-64 characters)');
}

function validateManifest(value: unknown, source: SkillSource): SkillManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Skill manifest must be a mapping');
  const manifest = value as Partial<SkillManifest>;
  validateId(String(manifest.id ?? ''));
  if (typeof manifest.name !== 'string' || !manifest.name.trim())
    throw new Error('Skill name is required');
  if (
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+/.test(manifest.version)
  )
    throw new Error('Skill version must be semver-like');
  if (typeof manifest.description !== 'string')
    throw new Error('Skill description is required');
  if (
    !Array.isArray(manifest.permissions) ||
    !manifest.permissions.every((permission) => typeof permission === 'string')
  )
    throw new Error('Skill permissions must be a string list');
  return {
    id: manifest.id as string,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    source,
    enabled: manifest.enabled ?? true,
    permissions: manifest.permissions,
    compatibility: manifest.compatibility ?? {},
  };
}
