import { isAbsolute, normalize, relative, sep } from 'node:path';

const deniedFiles = new Set(['secrets.yaml', '.HA_VERSION']);
const deniedDirectories = new Set(['.storage', '.cloud']);
const deniedExtensions = ['.db', '.db-shm', '.db-wal', '.log'];

export function assertAllowedPath(
  requestedPath: string,
  allowCustomComponents = false,
): string {
  if (
    !requestedPath ||
    isAbsolute(requestedPath) ||
    requestedPath.includes('\0')
  )
    throw new Error('Path must be relative');
  const path = normalize(requestedPath);
  const parts = path.split(sep);
  if (parts[0] === '..' || parts.includes('..'))
    throw new Error('Path traversal is not allowed');
  if (
    deniedFiles.has(parts.at(-1) ?? '') ||
    deniedDirectories.has(parts[0] ?? '')
  )
    throw new Error('Path is protected');
  if (deniedExtensions.some((extension) => path.endsWith(extension)))
    throw new Error('File type is protected');
  if (path.startsWith('custom_components/') && !allowCustomComponents)
    throw new Error('custom_components requires explicit permission');
  return path;
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(normalize(root), normalize(candidate));
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}
