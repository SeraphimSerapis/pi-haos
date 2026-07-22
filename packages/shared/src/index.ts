import { z } from 'zod';

export const appStatusSchema = z.object({
  status: z.literal('ok'),
  appVersion: z.string(),
  piVersion: z.string().nullable(),
  homeAssistantMount: z.literal('read-only'),
  integration: z.enum(['not-installed', 'unpaired', 'healthy', 'unhealthy']),
  timestamp: z.string(),
});
export type AppStatus = z.infer<typeof appStatusSchema>;

export const taskStateSchema = z.enum([
  'created',
  'planning',
  'staging',
  'awaiting_review',
  'approved',
  'validating',
  'applying',
  'post_apply_validation',
  'completed',
  'rejected',
  'failed',
  'rolled_back',
  'cancelled',
  'conflicted',
]);
export type TaskState = z.infer<typeof taskStateSchema>;

export const taskRecordSchema = z.object({
  id: z.string(),
  prompt: z.string().max(8192),
  initiator: z.string().max(256),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  piVersion: z.string().nullable(),
  skills: z.array(z.string()).max(100),
  state: taskStateSchema,
  transactionId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const agentEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: z.enum(['text_delta', 'tool_start', 'tool_end', 'status', 'error']),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const transactionFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  originalHash: z.string().nullable(),
  approved: z.boolean(),
});

export const reviewTransactionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  state: z.enum([
    'awaiting_review',
    'approved',
    'validating',
    'applying',
    'rejected',
    'conflicted',
  ]),
  diffHash: z.string(),
  files: z.array(transactionFileSchema).max(100),
  validation: z.object({
    status: z.enum(['passed', 'pending', 'failed']),
    errors: z.array(z.string()).max(100),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().optional(),
});
export type ReviewTransaction = z.infer<typeof reviewTransactionSchema>;

export const approvedTransactionSchema = z.object({
  id: z.string(),
  state: z.enum(['approved', 'validating', 'applying']),
  diffHash: z.string(),
  files: z
    .array(transactionFileSchema)
    .max(100)
    .refine(
      (files) => files.every((file) => file.approved),
      'All files must be approved',
    ),
  validation: z.object({
    status: z.enum(['passed', 'pending', 'failed']),
    errors: z.array(z.string()).max(100),
  }),
  createdAt: z.string(),
  approvedAt: z.string(),
});
export type ApprovedTransaction = z.infer<typeof approvedTransactionSchema>;
