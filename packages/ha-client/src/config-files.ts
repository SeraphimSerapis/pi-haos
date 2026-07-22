import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, normalize, relative, sep } from 'node:path';

const deniedNames = new Set(['secrets.yaml']);
const deniedPrefixes = ['.storage', '.cloud'];

export function assertReadableConfigPath(
  configRoot: string,
  requestedPath: string,
): string {
  if (
    !requestedPath ||
    isAbsolute(requestedPath) ||
    requestedPath.includes('\\0')
  )
    throw new Error('Config path must be relative');
  const normalized = normalize(requestedPath);
  const resolved = normalize(`${configRoot}/${normalized}`);
  const rel = relative(configRoot, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Config path escapes the Home Assistant config directory');
  const parts = rel.split(sep);
  if (
    deniedNames.has(parts.at(-1) ?? '') ||
    deniedPrefixes.some((prefix) => parts[0] === prefix)
  )
    throw new Error('Config path is protected');
  return resolved;
}

export async function readConfigFile(
  configRoot: string,
  requestedPath: string,
): Promise<{ path: string; content: string }> {
  const path = assertReadableConfigPath(configRoot, requestedPath);
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('Config path is not a regular file');
  const content = await readFile(path, 'utf8');
  return { path: requestedPath, content: redactSecrets(content) };
}

export function redactSecrets(content: string): string {
  return content
    .replace(
      /(password|api_key|access_token|token|secret)\s*:\s*[^\n#]+/gi,
      '$1: "[REDACTED]"',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
}
