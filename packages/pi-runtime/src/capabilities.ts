import type { PiCapabilities } from './types.js';

export interface PiCapabilityProbe {
  rpcProtocolVersion?: string;
  commands?: string[];
  eventTypes?: string[];
}

/**
 * Converts observed RPC features into an allowlist. Unknown commands remain
 * disabled so a newer Pi release cannot silently expand the agent boundary.
 */
export function detectCapabilities(probe: PiCapabilityProbe): PiCapabilities {
  const commands = new Set(probe.commands ?? []);
  const events = new Set(probe.eventTypes ?? []);
  return {
    rpcProtocolVersion: probe.rpcProtocolVersion ?? 'unknown',
    supportsSessionSwitching: commands.has('switch_session'),
    supportsToolWhitelisting: commands.has('set_tools'),
    supportsModelSwitching: commands.has('set_model'),
    supportsStructuredEvents:
      events.has('message_update') || events.has('agent_start'),
    supportsCancellation: commands.has('abort'),
  };
}
