import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { A2AAuthConfig } from '@anvio/core';
import { UserBuilder } from '@a2a-js/sdk/server/express';
import type { User } from '@a2a-js/sdk/server';

class AuthenticatedUser implements User {
  constructor(private readonly name: string) {}
  get isAuthenticated(): boolean { return true; }
  get userName(): string { return this.name; }
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createAnvioUserBuilder(config: A2AAuthConfig): (req: Request) => Promise<User> {
  if (!config.enabled) {
    return UserBuilder.noAuthentication;
  }

  return async (req: Request): Promise<User> => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey && config.apiKeys) {
      const match = config.apiKeys.find((k) => constantTimeCompare(k.key, apiKey));
      if (match) {
        return new AuthenticatedUser(match.name);
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (config.apiKeys) {
        const match = config.apiKeys.find((k) => constantTimeCompare(k.key, token));
        if (match) {
          return new AuthenticatedUser(match.name);
        }
      }
    }

    throw new Error('Authentication required: provide X-API-Key header or Bearer token');
  };
}
