import type { InboundEnvelope, InboundGateResult } from '@anvio/core';
import type { HarnessGateway } from '../gateway.js';

export interface SimulatedMessage {
  envelope: InboundEnvelope;
  result: InboundGateResult;
}

/** In-memory transport for harness policy tests without live channel credentials. */
export class SimulationTransport {
  readonly messages: SimulatedMessage[] = [];

  constructor(private readonly gateway: HarnessGateway) {}

  async send(envelope: InboundEnvelope): Promise<InboundGateResult> {
    const result = await this.gateway.handleInbound(envelope);
    this.messages.push({ envelope, result });
    return result;
  }

  reset(): void {
    this.messages.length = 0;
  }
}

export async function runSimulationScenario(
  gateway: HarnessGateway,
  steps: InboundEnvelope[],
): Promise<SimulatedMessage[]> {
  const transport = new SimulationTransport(gateway);
  for (const envelope of steps) {
    await transport.send(envelope);
  }
  return transport.messages;
}
