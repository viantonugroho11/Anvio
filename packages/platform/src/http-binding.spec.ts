import { describe, expect, it } from 'vitest';
import {
  InsecureBindingError,
  assertSafeBinding,
  isLoopbackHost,
  resolveApiBinding,
} from './http-binding.js';

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '127.1.2.3', '127.0.0.53'])(
    'treats %s as loopback',
    (host) => {
      // The whole 127.0.0.0/8 block counts, not just 127.0.0.1.
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['0.0.0.0', '192.168.1.10', '10.0.0.4', '::', 'example.com', '128.0.0.1'])(
    'treats %s as reachable',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe('resolveApiBinding', () => {
  it('defaults to loopback', () => {
    // Previously '0.0.0.0': every interface, inherited rather than chosen.
    expect(resolveApiBinding({}).host).toBe('127.0.0.1');
  });

  it('honours an explicit host and port', () => {
    const binding = resolveApiBinding({ API_HOST: '0.0.0.0', API_PORT: '8080' });
    expect(binding).toMatchObject({ host: '0.0.0.0', port: 8080 });
  });

  it('reflects only loopback origins by default', () => {
    const { corsOrigin } = resolveApiBinding({});
    const allows = (origin: string | undefined) => {
      let allowed: boolean | undefined;
      (corsOrigin as (o: string | undefined, cb: (e: Error | null, a?: boolean) => void) => void)(
        origin,
        (_e, a) => {
          allowed = a;
        },
      );
      return allowed;
    };

    expect(allows('http://localhost:3001')).toBe(true);
    expect(allows('http://127.0.0.1:5173')).toBe(true);
    // Non-browser callers send no Origin at all.
    expect(allows(undefined)).toBe(true);
    expect(allows('https://evil.example.com')).toBe(false);
    expect(allows('http://localhost.evil.com')).toBe(false);
  });

  it('uses a configured allowlist verbatim', () => {
    const { corsOrigin } = resolveApiBinding({
      ANVIO_API_CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
    });
    expect(corsOrigin).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });
});

describe('assertSafeBinding', () => {
  it('allows the Level-1 default: no auth, loopback only', () => {
    expect(() =>
      assertSafeBinding({ host: '127.0.0.1', authEnabled: false, allowInsecure: false }),
    ).not.toThrow();
  });

  it('allows a reachable host once auth is enabled', () => {
    expect(() =>
      assertSafeBinding({ host: '0.0.0.0', authEnabled: true, allowInsecure: false }),
    ).not.toThrow();
  });

  it('refuses to serve an unauthenticated API beyond loopback', () => {
    expect(() =>
      assertSafeBinding({ host: '0.0.0.0', authEnabled: false, allowInsecure: false }),
    ).toThrow(InsecureBindingError);
  });

  it('names all three ways out in the error', () => {
    // The operator asked for this host on purpose; the failure has to say why
    // they did not get it and what to do instead.
    let message = '';
    try {
      assertSafeBinding({ host: '192.168.1.10', authEnabled: false, allowInsecure: false });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('192.168.1.10');
    expect(message).toContain('API_HOST');
    expect(message).toContain('auth.enabled');
    expect(message).toContain('ANVIO_API_ALLOW_INSECURE');
  });

  it('accepts the deliberate override', () => {
    expect(() =>
      assertSafeBinding({ host: '0.0.0.0', authEnabled: false, allowInsecure: true }),
    ).not.toThrow();
  });
});
