import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  approvedTransactionSchema,
  reviewTransactionSchema,
  type ReviewTransaction,
  type ApprovedTransaction,
} from '@pi-ha/shared';

export class TransactionStore {
  private readonly database: DatabaseSync;

  constructor(
    path = process.env.TRANSACTION_DATABASE ??
      '/data/database/transactions.sqlite',
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  register(transaction: ReviewTransaction | ApprovedTransaction): void {
    const parsed = reviewTransactionSchema.parse({
      ...transaction,
      taskId: 'approvedAt' in transaction ? 'unknown' : transaction.taskId,
      updatedAt:
        'approvedAt' in transaction
          ? transaction.approvedAt
          : transaction.updatedAt,
      ...('approvedAt' in transaction
        ? { approvedAt: transaction.approvedAt }
        : {}),
    });
    this.save(parsed);
  }

  registerReview(transaction: ReviewTransaction): void {
    this.save(reviewTransactionSchema.parse(transaction));
  }

  get(id: string): ReviewTransaction | undefined {
    const row = this.database
      .prepare('SELECT payload FROM transactions WHERE id = ?')
      .get(id) as { payload: string } | undefined;
    return row
      ? reviewTransactionSchema.parse(JSON.parse(row.payload))
      : undefined;
  }

  approve(id: string, paths?: string[]): ReviewTransaction | undefined {
    const transaction = this.get(id);
    if (!transaction || transaction.state !== 'awaiting_review')
      return undefined;
    const selected = paths ? new Set(paths) : null;
    const now = new Date().toISOString();
    const approved = reviewTransactionSchema.parse({
      ...transaction,
      state: 'approved',
      updatedAt: now,
      approvedAt: now,
      files: transaction.files.map((file) => ({
        ...file,
        approved: selected ? selected.has(file.path) : true,
      })),
    });
    this.save(approved);
    return approved;
  }

  update(transaction: ReviewTransaction): ReviewTransaction {
    const parsed = reviewTransactionSchema.parse(transaction);
    this.save(parsed);
    return parsed;
  }

  getApproved(id: string): ApprovedTransaction | undefined {
    const transaction = this.get(id);
    if (
      !transaction ||
      !['approved', 'validating', 'applying'].includes(transaction.state)
    )
      return undefined;
    if (transaction.validation.status !== 'passed') return undefined;
    return approvedTransactionSchema.parse(transaction);
  }

  list(): ReviewTransaction[] {
    return (
      this.database
        .prepare(
          'SELECT payload FROM transactions ORDER BY updated_at DESC LIMIT 100',
        )
        .all() as Array<{ payload: string }>
    ).map((row) => reviewTransactionSchema.parse(JSON.parse(row.payload)));
  }

  close(): void {
    this.database.close();
  }

  private save(transaction: ReviewTransaction): void {
    this.database
      .prepare(
        'INSERT INTO transactions (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
      )
      .run(transaction.id, JSON.stringify(transaction), transaction.updatedAt);
  }
}
