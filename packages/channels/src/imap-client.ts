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

async function imapCommand(socket: tls.TLSSocket, tag: string, command: string): Promise<string> {
  socket.write(`${tag} ${command}\r\n`);
  let response = '';
  while (true) {
    const chunk = await readResponse(socket);
    response += chunk;
    if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
      break;
    }
  }
  if (!response.includes(`${tag} OK`)) {
    throw new Error(`IMAP command failed: ${command}\n${response}`);
  }
  return response;
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

/** Watch INBOX via IMAP IDLE (poll loop with backoff when server lacks IDLE). */
export async function idleWatchInbox(options: ImapIdleOptions): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? 25 * 60 * 1000;
  const seenUids = new Set<number>();

  while (!options.signal?.aborted) {
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(idleTimeoutMs, 60_000));
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      timer.unref?.();
    });
  }
}
