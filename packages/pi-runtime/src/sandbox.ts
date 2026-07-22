import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export interface SandboxLaunchOptions {
  launcherPath: string;
  workspace: string;
  brokerPort?: number;
  command: string;
  args: string[];
}

export async function assertSandboxLauncher(path: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`Pi sandbox launcher is unavailable: ${path}`);
  }
}

export function buildSandboxArgs(options: SandboxLaunchOptions): string[] {
  if (!options.workspace || options.workspace.includes('\0')) {
    throw new Error('A valid Pi workspace is required');
  }
  return [
    '--workspace',
    options.workspace,
    ...(options.brokerPort === undefined
      ? []
      : ['--broker-port', String(options.brokerPort)]),
    '--',
    options.command,
    ...options.args,
  ];
}
