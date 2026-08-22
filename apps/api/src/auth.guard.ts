import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthContext } from '@anvio/core';
import { AppService } from './app.service.js';

const PUBLIC_KEY = 'anvio:public';

/**
 * Marks a route as reachable without a bearer token.
 *
 * Only two things qualify: liveness probes, and inbound channel webhooks — an
 * external service posting to us cannot present a user's token, so those routes
 * authenticate by their own provider-specific mechanism instead.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

interface RequestWithAuth {
  authContext?: AuthContext;
  headers: Record<string, string | string[] | undefined>;
}

/** Injects the context established by `AnvioAuthGuard`. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.authContext) {
    // Unreachable while the guard is registered globally; a hard failure rather
    // than an anonymous fallback, because falling back is the bug this replaces.
    throw new UnauthorizedException('No authentication context on request');
  }
  return request.authContext;
});

function bearerToken(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1];
}

/**
 * Establishes the auth context for every request, once.
 *
 * Controllers previously did this themselves, and the one that did resolved a
 * failed `authenticate()` back to `getDefaultContext()` — so an invalid, expired,
 * or absent token still produced a valid user context even with auth enabled.
 * That fallback is gone: with auth on, a bad token is a 401.
 */
@Injectable()
export class AnvioAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly appService: AppService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const { auth } = this.appService.platform;

    if (!auth.enabled) {
      // Level-1 default: no login, single local user. The binding policy in
      // security.ts is what keeps this from also being network-reachable.
      request.authContext = auth.getDefaultContext();
      return true;
    }

    const context_ = await auth.authenticate(bearerToken(request.headers.authorization));
    if (!context_) {
      throw new UnauthorizedException('Invalid or missing bearer token');
    }

    request.authContext = context_;
    return true;
  }
}
