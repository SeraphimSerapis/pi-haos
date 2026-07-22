import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative } from 'node:path';

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const MAX_FILES = 20_000;
const MAX_BYTES = 512 * 1024 * 1024;

export interface PiVersionStatus {
  active: string;
  installed: string[];
  rollback: string | null;
  updateInProgress: boolean;
}

export interface PiUpdateManagerOptions {
  root: string;
  bundledVersion: string;
  isIdle?: () => boolean;
  smokeTest?: (directory: string, version: string) => Promise<void>;
}

export class PiUpdateManager {
  private readonly versionsRoot: string;
  private readonly activePointer: string;
  private readonly bundledVersion: string;
  private readonly isIdle: () => boolean;
  private readonly smokeTest: (
    directory: string,
    version: string,
  ) => Promise<void>;
  private updating = false;

  constructor(options: PiUpdateManagerOptions) {
    this.versionsRoot = join(options.root, 'versions');
    this.activePointer = join(options.root, 'active-version');
    this.bundledVersion = assertVersion(options.bundledVersion);
    this.isIdle = options.isIdle ?? (() => true);
    this.smokeTest = options.smokeTest ?? (async () => undefined);
  }

  async status(): Promise<PiVersionStatus> {
    await mkdir(this.versionsRoot, { recursive: true });
    const entries = await readdir(this.versionsRoot, { withFileTypes: true });
    const installed = entries
      .filter((entry) => entry.isDirectory() && VERSION.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const active = await this.readActive(installed);
    const rollback =
      installed.filter((version) => version !== active).at(-1) ?? null;
    return { active, installed, rollback, updateInProgress: this.updating };
  }

  async stage(
    sourceDirectory: string,
    version: string,
    expectedSha256: string,
  ): Promise<PiVersionStatus> {
    if (!this.isIdle() || this.updating)
      throw new Error(
        'Pi updates require an idle runtime and transaction queue',
      );
    const normalizedVersion = assertVersion(version);
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256))
      throw new Error('A SHA-256 checksum is required');
    this.updating = true;
    const temporary = join(
      this.versionsRoot,
      `.staging-${normalizedVersion}-${process.pid}`,
    );
    const target = join(this.versionsRoot, normalizedVersion);
    try {
      await rm(temporary, { recursive: true, force: true });
      await mkdir(temporary, { recursive: true });
      await copyTree(sourceDirectory, temporary);
      const actual = await hashTree(temporary);
      if (actual.toLowerCase() !== expectedSha256.toLowerCase())
        throw new Error('Pi package integrity check failed');
      await this.smokeTest(temporary, normalizedVersion);
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
      return this.status();
    } finally {
      await rm(temporary, { recursive: true, force: true });
      this.updating = false;
    }
  }

  async activate(version: string): Promise<PiVersionStatus> {
    const normalizedVersion = assertVersion(version);
    if (!this.isIdle() || this.updating)
      throw new Error(
        'Pi activation requires an idle runtime and transaction queue',
      );
    const directory = join(this.versionsRoot, normalizedVersion);
    const info = await lstat(directory).catch(() => undefined);
    if (!info?.isDirectory())
      throw new Error(`Pi version is not installed: ${normalizedVersion}`);
    const temporary = `${this.activePointer}.${process.pid}.tmp`;
    await writeFile(temporary, `${normalizedVersion}\n`, { mode: 0o600 });
    await rename(temporary, this.activePointer);
    return this.status();
  }

  async rollback(): Promise<PiVersionStatus> {
    const current = await this.status();
    if (!current.rollback)
      throw new Error('No Pi rollback version is available');
    return this.activate(current.rollback);
  }

  private async readActive(installed: string[]): Promise<string> {
    const value = (
      await readFile(this.activePointer, 'utf8').catch(() => '')
    ).trim();
    if (VERSION.test(value) && installed.includes(value)) return value;
    // Staging a newer version must never implicitly activate it. The bundled
    // runtime remains the safe fallback until activate() atomically updates
    // the pointer.
    return this.bundledVersion;
  }
}

export function assertVersion(version: string): string {
  if (!VERSION.test(version)) throw new Error(`Invalid Pi version: ${version}`);
  return version;
}

async function copyTree(
  source: string,
  destination: string,
  root = source,
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink())
      throw new Error('Pi package symlinks are not allowed');
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyTree(sourcePath, destinationPath, root);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else
      throw new Error(
        `Unsupported Pi package entry: ${relative(root, sourcePath)}`,
      );
  }
}

export async function hashTree(root: string): Promise<string> {
  const files: string[] = [];
  let total = 0;
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error('Pi package symlinks are not allowed');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        files.push(relative(root, path));
        total += info.size;
        if (files.length > MAX_FILES || total > MAX_BYTES)
          throw new Error('Pi package exceeds size limits');
      }
    }
  }
  await walk(root);
  files.sort();
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path);
    digest.update(await readFile(join(root, path)));
  }
  return digest.digest('hex');
}
