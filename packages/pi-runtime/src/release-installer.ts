import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  hashTree,
  PiUpdateManager,
  type PiVersionStatus,
} from './update-manager.js';
import type { PiReleaseInfo } from './release-catalog.js';

const execFile = promisify(execFileCallback);
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export interface PiReleaseInstallerOptions {
  updateManager: PiUpdateManager;
  fetchImpl?: typeof fetch;
  tempRoot?: string;
  extractArchive?: (archive: string, destination: string) => Promise<void>;
}

/** Download and stage a release; activation remains a separate explicit call. */
export class PiReleaseInstaller {
  private readonly fetchImpl: typeof fetch;
  private readonly tempRoot: string;
  private readonly extractArchive: (
    archive: string,
    destination: string,
  ) => Promise<void>;

  constructor(private readonly options: PiReleaseInstallerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.extractArchive = options.extractArchive ?? extractTarArchive;
  }

  async install(release: PiReleaseInfo): Promise<PiVersionStatus> {
    const response = await this.fetchImpl(release.tarballUrl, {
      headers: { accept: 'application/octet-stream' },
    });
    if (!response.ok)
      throw new Error(`Pi package download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES)
      throw new Error('Pi package archive exceeds size limits');
    verifyIntegrity(bytes, release.integrity);
    const workspace = await mkdtemp(join(this.tempRoot, 'pi-release-'));
    const archive = join(workspace, 'package.tgz');
    const extracted = join(workspace, 'extracted');
    try {
      await writeFile(archive, bytes, { mode: 0o600 });
      await mkdir(extracted, { recursive: true, mode: 0o700 });
      await this.extractArchive(archive, extracted);
      const source = join(extracted, 'package');
      const treeHash = await hashTree(source);
      return await this.options.updateManager.stage(
        source,
        release.version,
        treeHash,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function verifyIntegrity(bytes: Buffer, integrity: string): void {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!match) throw new Error('Pi release integrity metadata is invalid');
  const actual = createHash('sha512').update(bytes).digest('base64');
  if (actual !== match[1])
    throw new Error('Pi release archive integrity check failed');
}

async function extractTarArchive(
  archive: string,
  destination: string,
): Promise<void> {
  const listing = await execFile('tar', ['-tzf', archive], {
    maxBuffer: 2 * 1024 * 1024,
  });
  for (const entry of listing.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..'))
      throw new Error('Pi package archive contains an unsafe path');
  }
  await execFile('tar', [
    '-xzf',
    archive,
    '-C',
    destination,
    '--no-same-owner',
    '--no-same-permissions',
  ]);
}
