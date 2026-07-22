import type { HomeAssistantClient } from '@pi-ha/ha-client';
import type { ReviewTransaction } from '@pi-ha/shared';

export type ActivationPlan =
  | { action: 'none'; reason: string; requiresApproval: false }
  | {
      action: 'reload';
      domain: 'automation' | 'script' | 'scene' | 'template';
      service: 'reload';
      reason: string;
      requiresApproval: true;
    }
  | {
      action: 'restart';
      domain: 'homeassistant';
      service: 'restart';
      reason: string;
      requiresApproval: true;
    };

export function inferActivationPlan(
  transaction: Pick<ReviewTransaction, 'files'>,
): ActivationPlan {
  const paths = transaction.files.map((file) => file.path);
  if (
    paths.some(
      (path) =>
        path.startsWith('custom_components/') ||
        path === 'configuration.yaml' ||
        path.startsWith('packages/'),
    )
  )
    return {
      action: 'restart',
      domain: 'homeassistant',
      service: 'restart',
      reason:
        'Core configuration, packages, or custom integrations may require a restart',
      requiresApproval: true,
    };
  if (paths.includes('automations.yaml'))
    return {
      action: 'reload',
      domain: 'automation',
      service: 'reload',
      reason: 'Automations are activated by reloading the automation domain',
      requiresApproval: true,
    };
  if (paths.includes('scripts.yaml'))
    return {
      action: 'reload',
      domain: 'script',
      service: 'reload',
      reason: 'Scripts are activated by reloading the script domain',
      requiresApproval: true,
    };
  if (paths.includes('scenes.yaml'))
    return {
      action: 'reload',
      domain: 'scene',
      service: 'reload',
      reason: 'Scenes are activated by reloading the scene domain',
      requiresApproval: true,
    };
  if (
    paths.some((path) => path.endsWith('.jinja') || path.includes('template'))
  )
    return {
      action: 'reload',
      domain: 'template',
      service: 'reload',
      reason: 'Template changes may require reloading template entities',
      requiresApproval: true,
    };
  return {
    action: 'none',
    reason: 'No activation action was inferred',
    requiresApproval: false,
  };
}

export interface ActivationAdapter {
  validateCore(): Promise<{ valid: boolean; errors: string[] }>;
  activate(plan: Exclude<ActivationPlan, { action: 'none' }>): Promise<unknown>;
}

export class HomeAssistantActivationAdapter implements ActivationAdapter {
  constructor(private readonly client: HomeAssistantClient) {}

  async validateCore(): Promise<{ valid: boolean; errors: string[] }> {
    const result = await this.client.checkConfig();
    if (typeof result === 'string')
      return {
        valid: !/error|invalid/i.test(result),
        errors: result ? [result] : [],
      };
    const errors = [result.errors].flatMap((error) =>
      typeof error === 'string' && error ? [error] : [],
    );
    return {
      valid: result.result !== 'invalid' && errors.length === 0,
      errors,
    };
  }

  async activate(
    plan: Exclude<ActivationPlan, { action: 'none' }>,
  ): Promise<unknown> {
    return this.client.callService(plan.domain, plan.service);
  }
}
