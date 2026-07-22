import {
  approvedTransactionSchema,
  type ApprovedTransaction,
} from '@pi-ha/shared';

export class TransactionStore {
  private readonly transactions = new Map<string, ApprovedTransaction>();

  register(transaction: ApprovedTransaction): void {
    this.transactions.set(
      transaction.id,
      approvedTransactionSchema.parse(transaction),
    );
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
}
