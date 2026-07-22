import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanWorkspace } from './workspace-scanner.js';

describe('workspace scanner', () => {
  it('creates a reviewable manifest with original hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-scan-'));
    const workspace = join(root, 'workspace');
    const config = join(root, 'config');
    await mkdir(workspace);
    await mkdir(config);
    await writeFile(join(config, 'automations.yaml'), 'old\n');
    await writeFile(join(workspace, 'automations.yaml'), 'new\n');
    const transaction = await scanWorkspace({
      workspace,
      configRoot: config,
      taskId: 'task-1',
      transactionId: 'tx-1',
    });
    expect(transaction.state).toBe('awaiting_review');
    expect(transaction.files[0]).toMatchObject({
      path: 'automations.yaml',
      content: 'new\n',
      approved: false,
    });
    expect(transaction.files[0]?.originalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(transaction.diffHash).toMatch(/^[a-f0-9]{64}$/);
    await rm(root, { recursive: true, force: true });
  });

  it('rejects symlinks before reading staged content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-scan-link-'));
    const workspace = join(root, 'workspace');
    const config = join(root, 'config');
    await mkdir(workspace);
    await mkdir(config);
    await symlink('/etc/passwd', join(workspace, 'automations.yaml'));
    await expect(
      scanWorkspace({
        workspace,
        configRoot: config,
        taskId: 'task-1',
        transactionId: 'tx-1',
      }),
    ).rejects.toThrow('Symlinks');
    await rm(root, { recursive: true, force: true });
  });
});
