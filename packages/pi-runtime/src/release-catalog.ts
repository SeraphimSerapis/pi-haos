export interface PiReleaseInfo {
  packageName: string;
  version: string;
  tarballUrl: string;
  integrity: string;
  description: string | null;
  registryUrl: string;
}

export interface PiReleaseCatalogOptions {
  packageName?: string;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Read-only release metadata lookup. It never installs or executes packages. */
export class PiReleaseCatalog {
  private readonly packageName: string;
  private readonly registryUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PiReleaseCatalogOptions = {}) {
    this.packageName = options.packageName ?? '@earendil-works/pi-coding-agent';
    this.registryUrl = (
      options.registryUrl ??
      `https://registry.npmjs.org/${encodeURIComponent(this.packageName)}`
    ).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async check(channel: 'stable' | 'pinned'): Promise<PiReleaseInfo | null> {
    if (channel === 'pinned') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.registryUrl, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`Pi registry request failed (${response.status})`);
      const value = (await response.json()) as unknown;
      return parseRelease(value, this.packageName, this.registryUrl);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseRelease(
  value: unknown,
  packageName: string,
  registryUrl: string,
): PiReleaseInfo {
  if (!value || typeof value !== 'object')
    throw new Error('Pi registry response is invalid');
  const record = value as {
    'dist-tags'?: Record<string, unknown>;
    versions?: Record<string, unknown>;
  };
  const version = record['dist-tags']?.latest;
  if (typeof version !== 'string' || !isVersion(version))
    throw new Error('Pi registry did not return a valid stable version');
  const metadata = record.versions?.[version];
  if (!metadata || typeof metadata !== 'object')
    throw new Error(
      'Pi registry did not return metadata for the stable version',
    );
  const packageMetadata = metadata as {
    dist?: { tarball?: unknown; integrity?: unknown };
    description?: unknown;
  };
  const tarballUrl = packageMetadata.dist?.tarball;
  const integrity = packageMetadata.dist?.integrity;
  if (
    typeof tarballUrl !== 'string' ||
    !isHttpsUrl(tarballUrl) ||
    new URL(tarballUrl).hostname !== new URL(registryUrl).hostname
  )
    throw new Error('Pi release tarball host is not trusted');
  if (
    typeof integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/=]+$/.test(integrity)
  )
    throw new Error('Pi release integrity metadata is missing or invalid');
  return {
    packageName,
    version,
    tarballUrl,
    integrity,
    description:
      typeof packageMetadata.description === 'string'
        ? packageMetadata.description.slice(0, 4096)
        : null,
    registryUrl,
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value);
}
