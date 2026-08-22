/**
 * Network-exposure policy for the REST API.
 *
 * The threat model for a local-first product is not "no auth" — running without
 * auth on loopback is the intended Level-1 default, and forcing a login on
 * localhost would break the product for its main use. The dangerous state is
 * **no auth *and* reachable from the network**, which is what this module makes
 * impossible to reach by accident.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Default localhost origins for the dashboard, on any port. */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function isLoopbackHost(host: string): boolean {
  const normalised = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalised)) return true;
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised);
}

export interface ApiBinding {
  host: string;
  port: number;
  /** Passed to Nest's `enableCors({ origin })`. */
  corsOrigin:
    | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void)
    | string[];
  allowInsecure: boolean;
}

export interface BindingEnv {
  API_HOST?: string;
  API_PORT?: string;
  ANVIO_API_CORS_ORIGINS?: string;
  ANVIO_API_ALLOW_INSECURE?: string;
}

export function resolveApiBinding(env: BindingEnv): ApiBinding {
  // Loopback by default. Binding every interface is now an explicit choice
  // rather than something inherited from a template.
  const host = env.API_HOST?.trim() || '127.0.0.1';
  const port = Number.parseInt(env.API_PORT ?? '3000', 10);
  const allowInsecure = env.ANVIO_API_ALLOW_INSECURE === 'true';

  const configured = (env.ANVIO_API_CORS_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return { host, port, corsOrigin: configured, allowInsecure };
  }

  // No allowlist configured: reflect only loopback origins. A browser page served
  // from anywhere else cannot read this API, which is the property `enableCors()`
  // with no arguments gave away.
  const corsOrigin: ApiBinding['corsOrigin'] = (origin, cb) => {
    // Same-origin and non-browser callers send no Origin header at all.
    if (!origin) return cb(null, true);
    cb(null, LOOPBACK_ORIGIN.test(origin));
  };

  return { host, port, corsOrigin, allowInsecure };
}

export class InsecureBindingError extends Error {
  constructor(host: string) {
    super(
      `Refusing to start: the API would listen on ${host} with authentication disabled, ` +
        `so anything that can reach this host could start agent runs and spend model credits.\n` +
        `  • Keep it local: unset API_HOST (defaults to 127.0.0.1).\n` +
        `  • Or turn on auth: set auth.enabled in workspace/anvio.yaml.\n` +
        `  • Or, if the host is already isolated (a container network, a private VPC), ` +
        `set ANVIO_API_ALLOW_INSECURE=true to accept the risk deliberately.`,
    );
    this.name = 'InsecureBindingError';
  }
}

/**
 * Throws when the API would be both unauthenticated and network-reachable.
 *
 * Deliberately not a silent downgrade to loopback: an operator who asked for
 * `0.0.0.0` should find out why they did not get it, rather than wonder why the
 * service is unreachable.
 */
export function assertSafeBinding(input: {
  host: string;
  authEnabled: boolean;
  allowInsecure: boolean;
}): void {
  if (input.authEnabled) return;
  if (isLoopbackHost(input.host)) return;
  if (input.allowInsecure) return;
  throw new InsecureBindingError(input.host);
}
