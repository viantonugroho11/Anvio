import { z } from 'zod';

export const connectionGrantSchema = z.object({
  ownerUserId: z.string().min(1),
  borrowerUserId: z.string().min(1),
  channel: z.string().min(1),
  threadId: z.string().min(1),
  service: z.string().min(1),
  grantedAt: z.string(),
  expiresAt: z.string().optional(),
  scope: z.enum(['thread', 'once']).default('thread'),
});

export const storedConnectionSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  userId: z.string().min(1),
  service: z.string().min(1),
  encryptedPayload: z.string().min(1),
  createdAt: z.string(),
  expiresAt: z.string(),
  threadIds: z.array(z.string()).default([]),
});

export type ConnectionGrant = z.infer<typeof connectionGrantSchema>;
export type StoredConnection = z.infer<typeof storedConnectionSchema>;

export function parseStoredConnection(input: unknown): StoredConnection {
  return storedConnectionSchema.parse(input);
}
