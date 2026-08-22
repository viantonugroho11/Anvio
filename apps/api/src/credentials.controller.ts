import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthContext, CredentialPoolManager } from '@anvio/core';
import { AppService } from './app.service.js';
import { Auth } from './auth.guard.js';

/**
 * A pool as the dashboard is allowed to see it.
 *
 * Built by hand rather than by spreading the stored pool: every field here is one
 * someone chose to expose. A secret cannot leak through a field nobody remembered
 * to strip, because nothing is copied wholesale.
 */
interface PoolView {
  slug: string;
  provider: string;
  strategy: string;
  credentials: Array<{ id: string; status: string; rateLimitedUntil?: string }>;
}

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly appService: AppService) {}

  /**
   * Credential pools are opt-in: without ANVIO_CREDENTIALS_PASSPHRASE the platform
   * builds no manager at all (ADR-0019 D2). That is a configuration state, not a
   * fault, so it answers 503 with the fix rather than 500 with a stack trace.
   */
  private requirePools(): CredentialPoolManager {
    const pools = this.appService.platform.credentialPools;
    if (!pools) {
      throw new ServiceUnavailableException(
        'Credential pools are disabled. Set ANVIO_CREDENTIALS_PASSPHRASE and restart to enable them.',
      );
    }
    return pools;
  }

  @Get('pools')
  async listPools(@Auth() _ctx: AuthContext): Promise<PoolView[]> {
    const pools = await this.requirePools().listPools();
    return pools.map((pool) => ({
      slug: pool.metadata.slug,
      provider: pool.spec.provider,
      strategy: pool.spec.strategy,
      credentials: pool.spec.credentials.map((credential) => ({
        id: credential.id,
        status: credential.status,
        rateLimitedUntil: credential.rateLimitedUntil,
      })),
    }));
  }

  @Post('pools/:slug/credentials')
  async addCredential(
    @Auth() _ctx: AuthContext,
    @Param('slug') slug: string,
    @Body() body: { id?: string; value?: string },
  ): Promise<{ slug: string; id: string }> {
    const id = body.id?.trim();
    const value = body.value?.trim();
    if (!id || !value) {
      throw new BadRequestException('Both "id" and "value" are required');
    }

    await this.requirePools().addCredential(slug, id, value);

    // Echoes the id, never the value — not even a prefix of it.
    return { slug, id };
  }

  @Post('pools/:slug/test')
  async testPool(
    @Auth() _ctx: AuthContext,
    @Param('slug') slug: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.requirePools().testPool(slug);
  }
}
