import {
  approvedTransactionSchema,
  reviewTransactionSchema,
  type ReviewTransaction,
  type ApprovedTransaction,
} from '@pi-ha/shared';

export class TransactionStore {
  private readonly transactions = new Map<string, ReviewTransaction>();

  register(transaction: ReviewTransaction | ApprovedTransaction): void {
    this.transactions.set(
      transaction.id,
      reviewTransactionSchema.parse({
        ...transaction,
        taskId: 'unknown',
        updatedAt:
          'approvedAt' in transaction
            ? transaction.approvedAt
            : transaction.updatedAt,
        ...('approvedAt' in transaction
          ? { approvedAt: transaction.approvedAt }
          : {}),
      }),
    );
  }

  registerReview(transaction: ReviewTransaction): void {
    this.transactions.set(
      transaction.id,
      reviewTransactionSchema.parse(transaction),
    );
  }

  get(id: string): ReviewTransaction | undefined {
    const transaction = this.transactions.get(id);
    return transaction ? reviewTransactionSchema.parse(transaction) : undefined;
  }

  approve(id: string, paths?: string[]): ReviewTransaction | undefined {
    const transaction = this.transactions.get(id);
    if (!transaction || transaction.state !== 'awaiting_review')
      return undefined;
    const selected = paths ? new Set(paths) : null;
    const approved = reviewTransactionSchema.parse({
      ...transaction,
      state: 'approved',
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      files: transaction.files.map((file) => ({
        ...file,
        approved: selected ? selected.has(file.path) : true,
      })),
    });
    this.transactions.set(id, approved);
    return approved;
  }

  getApproved(id: string): ApprovedTransaction | undefined {
    const transaction = this.transactions.get(id);
    if (
      !transaction ||
      !['approved', 'validating', 'applying'].includes(transaction.state)
    )
      return undefined;
    if (transaction.validation.status !== 'passed') return undefined;
    return approvedTransactionSchema.parse(transaction);
  }

  list(): ReviewTransaction[] {
    return [...this.transactions.values()].map((transaction) =>
      reviewTransactionSchema.parse(transaction),
    );
  }
}
