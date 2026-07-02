import tls from 'node:tls';

export interface ImapMessage {
  uid: number;
  from: string;
  subject: string;
  body: string;
}

export interface ImapPollOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  mailbox?: string;
}

function readResponse(socket: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      if (buffer.includes('\r\n')) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function awaitTaggedResponse(socket: tls.TLSSocket, tag: string): Promise<string> {
  let response = '';
  while (true) {
    const chunk = await readResponse(socket);
    response += chunk;
    if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
      break;
    }
  }
  if (!response.includes(`${tag} OK`)) {
    throw new Error(`IMAP command failed (tag ${tag}):\n${response}`);
  }
  return response;
}

async function imapCommand(socket: tls.TLSSocket, tag: string, command: string): Promise<string> {
  socket.write(`${tag} ${command}\r\n`);
  return awaitTaggedResponse(socket, tag);
}

function parseSearchUids(response: string): number[] {
  const line = response.split('\r\n').find((l) => l.startsWith('* SEARCH')) ?? '';
  return line
    .replace('* SEARCH', '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((uid) => Number.parseInt(uid, 10))
    .filter((uid) => !Number.isNaN(uid));
}

/** Parse From/Subject/body and threading headers from a raw RFC822 message block. */
export function parseRawEmail(raw: string): {
  from: string;
  subject: string;
  body: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
} {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headers = head ?? '';
  const body = rest.join('\n\n').trim();
  const fromMatch = /^From:\s*(.+)$/im.exec(headers);
  const subjectMatch = /^Subject:\s*(.+)$/im.exec(headers);
  const messageIdMatch = /^Message-ID:\s*(.+)$/im.exec(headers);
  const inReplyToMatch = /^In-Reply-To:\s*(.+)$/im.exec(headers);
  const referencesMatch = /^References:\s*(.+)$/im.exec(headers);
  return {
    from: fromMatch?.[1]?.trim() ?? 'unknown@unknown',
    subject: subjectMatch?.[1]?.trim() ?? '(no subject)',
    body: body || raw.trim(),
    messageId: messageIdMatch?.[1]?.trim(),
    inReplyTo: inReplyToMatch?.[1]?.trim(),
    references: referencesMatch?.[1]
      ?.split(/\s+/)
      .map((ref) => ref.trim())
      .filter(Boolean),
  };
}

function extractFetchBody(response: string): string {
  const literalStart = response.indexOf('\r\n\r\n');
  if (literalStart < 0) return response;
  return response.slice(literalStart + 4).split('\r\n')[0] ?? response;
}

/** Poll IMAP INBOX for UNSEEN messages (TLS port 993). */
export async function pollImapInbox(
  options: ImapPollOptions,
  seenUids: Set<number> = new Set(),
): Promise<ImapMessage[]> {
  const port = options.port ?? 993;
  const mailbox = options.mailbox ?? 'INBOX';

  const socket = tls.connect({ host: options.host, port, servername: options.host });
  await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', () => resolve());
    socket.once('error', reject);
  });

  try {
    await readResponse(socket);
    let tag = 1;
    await imapCommand(socket, `A${tag++}`, `LOGIN ${options.username} ${options.password}`);
    await imapCommand(socket, `A${tag++}`, `SELECT ${mailbox}`);
    const searchResponse = await imapCommand(socket, `A${tag++}`, 'UID SEARCH UNSEEN');

    const uids = parseSearchUids(searchResponse).filter((uid) => !seenUids.has(uid));
    const messages: ImapMessage[] = [];

    for (const uid of uids) {
      const fetchResponse = await imapCommand(
        socket,
        `A${tag++}`,
        `UID FETCH ${uid} (BODY.PEEK[])`,
      );
      const raw = extractFetchBody(fetchResponse);
      const parsed = parseRawEmail(raw);
      messages.push({ uid, ...parsed });
      seenUids.add(uid);
      await imapCommand(socket, `A${tag++}`, `UID STORE ${uid} +FLAGS (\\Seen)`);
    }

    await imapCommand(socket, `A${tag++}`, 'LOGOUT');
    socket.end();
    return messages;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function resolveEmailThreadId(parsed: ReturnType<typeof parseRawEmail>): string {
  const root =
    parsed.references?.[0] ??
    parsed.inReplyTo ??
    parsed.messageId ??
    `${parsed.from}:${parsed.subject}`;
  return `email:${root}`;
}

export interface ImapIdleOptions extends ImapPollOptions {
  idleTimeoutMs?: number;
  onMessage: (message: ImapMessage & { threadId: string }) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Parse the untagged `* CAPABILITY ...` line into a set of capability tokens. */
export function parseCapabilities(response: string): string[] {
  const line = response.split('\r\n').find((l) => l.startsWith('* CAPABILITY')) ?? '';
  return line.replace('* CAPABILITY', '').trim().split(/\s+/).filter(Boolean);
}

/** True if a CAPABILITY response advertises RFC 2177 IDLE support. */
export function hasIdleCapability(response: string): boolean {
  return parseCapabilities(response).includes('IDLE');
}

/** True if an untagged line signals new mailbox activity that should end an IDLE wait. */
export function isIdleWakeLine(line: string): boolean {
  return /^\* \d+ (EXISTS|RECENT|EXPUNGE)/.test(line.trim());
}

async function dispatchNewMessages(
  options: ImapIdleOptions,
  seenUids: Set<number>,
): Promise<void> {
  const messages = await pollImapInbox(options, seenUids);
  for (const message of messages) {
    const parsed = parseRawEmail(message.body);
    await options.onMessage({
      ...message,
      from: parsed.from,
      subject: parsed.subject,
      body: parsed.body,
      threadId: resolveEmailThreadId(parsed),
    });
  }
}

async function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    timer.unref?.();
  });
}

/**
 * Watch INBOX via a persistent connection using real RFC 2177 IMAP IDLE when
 * the server advertises it (untagged `* n EXISTS`/`RECENT` wakes the wait
 * immediately instead of on the next poll tick); falls back to the fixed-
 * interval poll loop when the server lacks IDLE or the connection drops.
 */
export async function idleWatchInbox(options: ImapIdleOptions): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? 25 * 60 * 1000;
  const seenUids = new Set<number>();
  const port = options.port ?? 993;
  const mailbox = options.mailbox ?? 'INBOX';

  while (!options.signal?.aborted) {
    let socket: tls.TLSSocket | undefined;
    try {
      socket = tls.connect({ host: options.host, port, servername: options.host });
      await new Promise<void>((resolve, reject) => {
        socket!.once('secureConnect', () => resolve());
        socket!.once('error', reject);
      });
      await readResponse(socket);

      let tag = 1;
      await imapCommand(socket, `A${tag++}`, `LOGIN ${options.username} ${options.password}`);
      const capResponse = await imapCommand(socket, `A${tag++}`, 'CAPABILITY');
      await imapCommand(socket, `A${tag++}`, `SELECT ${mailbox}`);

      // Pick up any mail that arrived before this connection was established.
      await dispatchNewMessages(options, seenUids);

      if (!hasIdleCapability(capResponse)) {
        await imapCommand(socket, `A${tag++}`, 'LOGOUT');
        socket.end();
        socket = undefined;
        await sleepOrAbort(Math.min(idleTimeoutMs, 60_000), options.signal);
        continue;
      }

      while (!options.signal?.aborted) {
        const idleTag = `A${tag++}`;
        socket.write(`${idleTag} IDLE\r\n`);
        await readResponse(socket); // '+ idling' continuation

        const woke = await new Promise<'newmail' | 'timeout' | 'aborted'>((resolve) => {
          let settled = false;
          let buffer = '';
          const finish = (reason: 'newmail' | 'timeout' | 'aborted') => {
            if (settled) return;
            settled = true;
            socket!.off('data', onData);
            options.signal?.removeEventListener('abort', onAbort);
            clearTimeout(timer);
            resolve(reason);
          };
          const onData = (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\r\n');
            if (lines.some((line) => isIdleWakeLine(line))) finish('newmail');
          };
          const onAbort = () => finish('aborted');
          const timer = setTimeout(() => finish('timeout'), idleTimeoutMs);
          timer.unref?.();
          socket!.on('data', onData);
          options.signal?.addEventListener('abort', onAbort, { once: true });
        });

        socket.write('DONE\r\n');
        await awaitTaggedResponse(socket, idleTag).catch(() => undefined);

        if (woke === 'newmail') {
          await dispatchNewMessages(options, seenUids);
        }
        if (woke === 'aborted') break;
      }

      await imapCommand(socket, `A${tag++}`, 'LOGOUT').catch(() => undefined);
      socket.end();
    } catch {
      socket?.destroy();
      await sleepOrAbort(Math.min(idleTimeoutMs, 30_000), options.signal);
    }
  }
}
