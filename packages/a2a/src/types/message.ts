/** A2A v1.0 Message — multi-part payload exchanged between agents. */

export type Role = 'user' | 'agent';

export interface TextPart {
  type: 'text';
  text: string;
  mediaType?: string;
}

export interface FilePart {
  type: 'file';
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;
    uri?: string;
  };
  mediaType?: string;
}

export interface DataPart {
  type: 'data';
  data: Record<string, unknown>;
  mediaType?: string;
}

export type Part = TextPart | FilePart | DataPart;

export interface Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}
