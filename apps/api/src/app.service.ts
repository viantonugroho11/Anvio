import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createPlatform, type PlatformContext } from '@anvio/platform';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  platform!: PlatformContext;

  async onModuleInit() {
    this.platform = await createPlatform({
      workspacePath: process.env.ANVIO_WORKSPACE,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async onModuleDestroy() {
    await this.platform.eventBus.close();
  }
}
