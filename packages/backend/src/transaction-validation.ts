import { parseDocument } from 'yaml';
import { reviewTransactionSchema, type ReviewTransaction } from '@pi-ha/shared';

export function validateYamlTransaction(
  transaction: ReviewTransaction,
): ReviewTransaction {
  const errors: string[] = [];
  for (const file of transaction.files) {
    if (!/\.(yaml|yml)$/i.test(file.path)) continue;
    const document = parseDocument(file.content, { prettyErrors: true });
    for (const error of document.errors) {
      if (errors.length < 100) errors.push(`${file.path}: ${error.message}`);
    }
  }
  return reviewTransactionSchema.parse({
    ...transaction,
    validation: { status: errors.length ? 'failed' : 'passed', errors },
    updatedAt: new Date().toISOString(),
  });
}
