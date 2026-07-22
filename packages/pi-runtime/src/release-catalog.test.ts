import { describe, expect, it, vi } from 'vitest';
import { PiReleaseCatalog } from './release-catalog.js';

const metadata = {
  'dist-tags': { latest: '0.82.0' },
  versions: {
    '0.82.0': {
      description: 'A tested release',
      dist: {
        tarball: 'https://registry.example.test/pi-0.82.0.tgz',
        integrity: 'sha512-YWJjZA==',
      },
    },
  },
};

describe('PiReleaseCatalog', () => {
  it('reads stable release metadata without downloading a package', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const catalog = new PiReleaseCatalog({
      packageName: 'pi-agent',
      registryUrl: 'https://registry.example.test/pi-agent',
      fetchImpl,
    });
    await expect(catalog.check('stable')).resolves.toMatchObject({
      packageName: 'pi-agent',
      version: '0.82.0',
      integrity: 'sha512-YWJjZA==',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not query a registry for the pinned channel', async () => {
    const fetchImpl = vi.fn();
    const catalog = new PiReleaseCatalog({ fetchImpl });
    await expect(catalog.check('pinned')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects untrusted tarballs and missing integrity metadata', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...metadata,
            versions: {
              '0.82.0': {
                dist: { tarball: 'https://evil.example/pi.tgz' },
              },
            },
          }),
        ),
    );
    const catalog = new PiReleaseCatalog({
      registryUrl: 'https://registry.example.test/pi-agent',
      fetchImpl,
    });
    await expect(catalog.check('stable')).rejects.toThrow('trusted');
  });
});
