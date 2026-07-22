import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairingManager } from './pairing.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('PairingManager', () => {
  it('exchanges a one-time code for a token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-pairing-'));
    roots.push(root);
    const manager = new PairingManager(join(root, 'pairing.json'));
    const initial = await manager.status();
    expect(initial.paired).toBe(false);
    const token = await manager.exchange(initial.pairingCode ?? '');
    expect(await manager.authenticate(token)).toBe(true);
    expect((await manager.status()).pairingCode).toBeNull();
    await expect(manager.exchange(initial.pairingCode ?? '')).rejects.toThrow();
  });
});
