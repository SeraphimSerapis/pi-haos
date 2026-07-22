export type TransactionState =
  | 'created'
  | 'planning'
  | 'staging'
  | 'awaiting_review'
  | 'approved'
  | 'validating'
  | 'applying'
  | 'post_apply_validation'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'rolled_back'
  | 'cancelled'
  | 'conflicted';

export interface StagedFile {
  path: string;
  originalHash: string | null;
  stagedContent: string;
  approved: boolean;
}

export interface Transaction {
  id: string;
  state: TransactionState;
  createdAt: string;
  updatedAt: string;
  files: StagedFile[];
  error?: string;
}

export interface ApplyPort {
  read(path: string): Promise<string | null>;
  writeAtomic(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  validate(): Promise<void>;
}
