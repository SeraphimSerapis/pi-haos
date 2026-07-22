import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { reviewTransactionSchema, type ReviewTransaction } from '@pi-ha/shared';

const deniedFiles = new Set(['secrets.yaml', '.HA_VERSION']);
const deniedDirectories = new Set(['.storage', '.cloud']);

function assertAllowedPath(requestedPath: string): string {
  if (
    !requestedPath ||
    requestedPath.startsWith('/') ||
    requestedPath.includes('\0')
  )
    throw new Error('Path must be relative');
  const path = requestedPath.replaceAll('\\', '/');
  const parts = path.split('/');
  if (parts.includes('..') || parts[0] === '')
    throw new Error('Path traversal is not allowed');
  if (
    deniedFiles.has(parts.at(-1) ?? '') ||
    deniedDirectories.has(parts[0] ?? '')
  )
    throw new Error('Path is protected');
  if (
    path.endsWith('.db') ||
    path.endsWith('.db-shm') ||
    path.endsWith('.db-wal') ||
    path.endsWith('.log') ||
    path.includes('.db-') ||
    path.includes('.log.')
  )
    throw new Error('File type is protected');
  if (path.startsWith('custom_components/'))
    throw new Error('custom_components requires explicit permission');
  return path;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

export interface WorkspaceScanOptions {
  workspace: string;
  configRoot: string;
  taskId: string;
  transactionId: string;
}

async function filesUnder(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error('Symlinks are not allowed in staging workspaces');
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) files.push(relative(root, path));
    else
      throw new Error('Only regular files are allowed in staging workspaces');
    if (files.length > MAX_FILES)
      throw new Error('Staging workspace contains too many files');
  }
  return files;
}

export async function scanWorkspace(
  options: WorkspaceScanOptions,
): Promise<ReviewTransaction> {
  const paths = await filesUnder(options.workspace);
  const files: ReviewTransaction['files'] = [];
  let total = 0;
  const diffs: string[] = [];
  for (const workspacePath of paths) {
    const path = assertAllowedPath(workspacePath);
    const content = await readRegularFile(
      join(options.workspace, workspacePath),
    );
    if (content.byteLength > MAX_FILE_BYTES)
      throw new Error(`Staged file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    total += content.byteLength;
    if (total > MAX_TOTAL_BYTES)
      throw new Error('Staging workspace exceeds the total size limit');
    const livePath = join(options.configRoot, path);
    let original: string | null = null;
    try {
      original = (await readRegularFile(livePath)).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    files.push({
      path,
      content: content.toString('utf8'),
      originalHash: original === null ? null : hash(original),
      approved: false,
    });
    diffs.push(unifiedDiff(path, original, content.toString('utf8')));
  }
  const now = new Date().toISOString();
  return reviewTransactionSchema.parse({
    id: options.transactionId,
    taskId: options.taskId,
    state: 'awaiting_review',
    diffHash: hash(diffs.join('\n')),
    files,
    validation: { status: 'pending', errors: [] },
    createdAt: now,
    updatedAt: now,
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readRegularFile(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new Error('Only regular files are allowed in staging workspaces');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
function unifiedDiff(
  path: string,
  before: string | null,
  after: string,
): string {
  const oldLines = (before ?? '').split('\n');
  const newLines = after.split('\n');
  return (
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ].join('\n') + '\n'
  );
}
