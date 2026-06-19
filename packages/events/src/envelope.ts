import { v4 as uuidv4 } from 'uuid';
import type { AnvioEvent } from './types.js';

export function createEvent<T>(
  type: string,
  source: string,
  data: T,
  subject?: string,
): AnvioEvent<T> {
  return {
    specversion: '1.0',
    type,
    source,
    id: uuidv4(),
    time: new Date().toISOString(),
    subject,
    data,
  };
}

export function serializeEvent<T>(event: AnvioEvent<T>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function deserializeEvent<T>(data: Uint8Array): AnvioEvent<T> {
  return JSON.parse(new TextDecoder().decode(data)) as AnvioEvent<T>;
}
