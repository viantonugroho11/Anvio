import {
  exitOnShutdownSignals,
  installProcessErrorGuards,
  startUnifiedGateway,
} from '@anvio/platform';

async function main() {
  installProcessErrorGuards('gateway');
  const handle = await startUnifiedGateway();
  exitOnShutdownSignals('gateway', () => handle.shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
