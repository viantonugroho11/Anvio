import { startUnifiedGateway } from '@anvio/platform';

async function main() {
  const handle = await startUnifiedGateway();
  const shutdown = async () => {
    console.log('\n[gateway] Shutting down…');
    await handle.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
