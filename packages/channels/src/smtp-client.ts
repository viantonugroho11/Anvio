import net from 'node:net';
import tls from 'node:tls';

export interface SmtpSendOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

function readResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      socket.off('error', onError);
      resolve(chunk.toString('utf-8'));
    };
    const onError = (error: Error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.once('data', onData);
    socket.once('error', onError);
  });
}

async function expectCode(socket: net.Socket, code: string): Promise<void> {
  const response = await readResponse(socket);
  if (!response.startsWith(code)) {
    throw new Error(`SMTP expected ${code}, got: ${response.trim()}`);
  }
}

async function sendLine(socket: net.Socket, line: string): Promise<void> {
  socket.write(`${line}\r\n`);
}

/** Minimal SMTP client (STARTTLS on port 587, plain AUTH LOGIN). */
export async function sendSmtpMail(options: SmtpSendOptions): Promise<void> {
  const port = options.port ?? 587;
  const socket = net.connect(port, options.host);

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });

  try {
    await expectCode(socket, '220');
    await sendLine(socket, 'EHLO anvio.local');
    await expectCode(socket, '250');

    await sendLine(socket, 'STARTTLS');
    await expectCode(socket, '220');

    const secure = tls.connect({ socket, servername: options.host });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });

    await sendLine(secure, 'EHLO anvio.local');
    await expectCode(secure, '250');

    await sendLine(secure, 'AUTH LOGIN');
    await expectCode(secure, '334');
    await sendLine(secure, Buffer.from(options.username).toString('base64'));
    await expectCode(secure, '334');
    await sendLine(secure, Buffer.from(options.password).toString('base64'));
    await expectCode(secure, '235');

    await sendLine(secure, `MAIL FROM:<${options.from}>`);
    await expectCode(secure, '250');
    await sendLine(secure, `RCPT TO:<${options.to}>`);
    await expectCode(secure, '250');
    await sendLine(secure, 'DATA');
    await expectCode(secure, '354');

    const message = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      `Subject: ${options.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      options.body,
      '.',
    ].join('\r\n');
    secure.write(`${message}\r\n`);
    await expectCode(secure, '250');

    await sendLine(secure, 'QUIT');
    secure.end();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
