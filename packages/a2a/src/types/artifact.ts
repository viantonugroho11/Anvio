/** A2A v1.0 Artifact — structured output from a task. */

import type { Part } from './message.js';

export interface Artifact {
  id: string;
  mimeType?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}
