'use server';

import { revalidatePath } from 'next/cache';
import { apiSend } from '@/lib/api';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Server actions rather than client fetches, on purpose.
 *
 * The API token lives in a server-only env var and the pasted key is a secret in
 * flight. Running both here means neither is ever part of the browser bundle or
 * a request the browser composes itself — the client sends form fields to Next,
 * and Next talks to the API.
 */
export async function addCredential(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const pool = String(form.get('pool') ?? '').trim();
  const id = String(form.get('id') ?? '').trim();
  const value = String(form.get('value') ?? '').trim();

  if (!pool || !id || !value) {
    return { ok: false, message: 'Pool, credential name, and key are all required.' };
  }

  try {
    await apiSend(`/credentials/pools/${encodeURIComponent(pool)}/credentials`, { id, value });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to save the key.',
    };
  }

  revalidatePath('/settings/providers');
  // Names the credential, never any part of the key.
  return { ok: true, message: `Saved “${id}” to ${pool}.` };
}

export async function testPool(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const pool = String(form.get('pool') ?? '').trim();
  if (!pool) return { ok: false, message: 'No pool selected.' };

  try {
    const result = await apiSend<{ ok: boolean; message: string }>(
      `/credentials/pools/${encodeURIComponent(pool)}/test`,
    );
    return result;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Test failed.' };
  }
}
