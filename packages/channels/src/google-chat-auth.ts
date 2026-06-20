import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

export async function loadGoogleServiceAccount(path: string): Promise<GoogleServiceAccount> {
  const raw = await fs.readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as GoogleServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid Google service account JSON');
  }
  return parsed;
}

/** Obtain OAuth access token for Google Chat bot scope. */
export async function getGoogleChatAccessToken(sa: GoogleServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/chat.bot',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signInput = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signInput).sign(sa.private_key, 'base64url');
  const jwt = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Google token response missing access_token');
  return json.access_token;
}
