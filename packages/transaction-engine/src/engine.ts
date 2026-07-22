import { createHash, randomUUID } from 'node:crypto';
import type {
  ApplyPort,
  StagedFile,
  Transaction,
  TransactionState,
} from './types.js';
import { assertAllowedPath } from './policy.js';

export function sha256(content: string | null): string | null {
  return content === null
    ? null
    : createHash('sha256').update(content).digest('hex');
}

export function unifiedDiff(
  path: string,
  before: string | null,
  after: string,
): string {
  const oldLines = (before ?? '').split('\n');
  const newLines = after.split('\n');
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const line of oldLines) lines.push(`-${line}`);
  for (const line of newLines) lines.push(`+${line}`);
  return `${lines.join('\n')}\n`;
}

const transitions: Record<TransactionState, TransactionState[]> = {
  created: ['planning', 'cancelled'],
  planning: ['staging', 'failed', 'cancelled'],
  staging: ['awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['approved', 'rejected', 'conflicted', 'cancelled'],
  approved: ['validating', 'rejected', 'cancelled'],
  validating: ['applying', 'failed', 'cancelled'],
  applying: ['post_apply_validation', 'failed', 'rolled_back'],
  post_apply_validation: ['completed', 'rolled_back', 'failed'],
  completed: [],
  rejected: [],
  failed: ['rolled_back'],
  rolled_back: [],
  cancelled: [],
  conflicted: [],
};

export class TransactionEngine {
  transition(transaction: Transaction, next: TransactionState): Transaction {
    if (!transitions[transaction.state].includes(next))
      throw new Error(
        `Invalid transaction transition: ${transaction.state} -> ${next}`,
      );
    return { ...transaction, state: next, updatedAt: new Date().toISOString() };
  }

  async stage(
    id: string,
    files: Array<{ path: string; content: string }>,
    port: ApplyPort,
    allowCustomComponents = false,
  ): Promise<Transaction> {
    const stagedFiles: StagedFile[] = [];
    for (const file of files) {
      const path = assertAllowedPath(file.path, allowCustomComponents);
      const original = await port.read(path);
      stagedFiles.push({
        path,
        originalHash: sha256(original),
        stagedContent: file.content,
        approved: false,
      });
    }
    const now = new Date().toISOString();
    return {
      id,
      state: 'awaiting_review',
      createdAt: now,
      updatedAt: now,
      files: stagedFiles,
    };
  }

  approve(transaction: Transaction, paths?: string[]): Transaction {
    const selected = paths ? new Set(paths) : null;
    return {
      ...this.transition(transaction, 'approved'),
      files: transaction.files.map((file) => ({
        ...file,
        approved: selected ? selected.has(file.path) : true,
      })),
    };
  }

  async apply(transaction: Transaction, port: ApplyPort): Promise<Transaction> {
    let current = this.transition(transaction, 'validating');
    const approved = current.files.filter((file) => file.approved);
    const snapshots = new Map<string, string | null>();
    try {
      for (const file of approved) {
        const live = await port.read(file.path);
        if (sha256(live) !== file.originalHash)
          return {
            ...current,
            state: 'conflicted',
            error: `Live file changed: ${file.path}`,
            updatedAt: new Date().toISOString(),
          };
        snapshots.set(file.path, live);
      }
      await port.validate();
      current = this.transition(current, 'applying');
      for (const file of approved)
        await port.writeAtomic(file.path, file.stagedContent);
      current = this.transition(current, 'post_apply_validation');
      await port.validate();
      return this.transition(current, 'completed');
    } catch (error) {
      for (const [path, content] of snapshots) {
        if (content === null) await port.remove(path);
        else await port.writeAtomic(path, content);
      }
      const failed = {
        ...current,
        state: 'rolled_back' as const,
        error: error instanceof Error ? error.message : 'Transaction failed',
        updatedAt: new Date().toISOString(),
      };
      return failed;
    }
  }

  createId(): string {
    return randomUUID();
  }
}
