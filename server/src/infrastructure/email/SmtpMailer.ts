import { randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

/**
 * Minimal SMTP client (implicit TLS, AUTH LOGIN), no dependency. Enough for
 * transactional mail through Tencent Cloud SES SMTP (smtp.qcloudmail.com:465),
 * the same channel Authing used for our verification emails.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (465). Plain TCP is only for tests against a local server. */
  secure: boolean;
  user: string;
  pass: string;
  /** "OIO <noreply@yueyantech.com>" or a bare address. */
  from: string;
  timeoutMs?: number;
}

export interface SmtpMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class SmtpError extends Error {
  constructor(readonly replyCode: number | null, message: string) {
    super(message);
  }
}

type Reply = { code: number; text: string };

export async function sendSmtpMail(
  config: SmtpConfig,
  message: SmtpMessage,
  openSocket: (config: SmtpConfig) => Socket = defaultOpenSocket,
): Promise<void> {
  const to = assertAddress(message.to);
  const fromAddress = assertAddress(parseAddress(config.from));
  const socket = openSocket(config);
  const connection = new SmtpConnection(socket);
  const timer = setTimeout(
    () => connection.fail(new SmtpError(null, `SMTP timed out after ${config.timeoutMs ?? 15_000}ms`)),
    config.timeoutMs ?? 15_000,
  );
  try {
    await connection.expect(null, [220]);
    await connection.expect(`EHLO ${fromAddress.split("@")[1] || "localhost"}`, [250]);
    await connection.expect("AUTH LOGIN", [334]);
    await connection.expect(Buffer.from(config.user).toString("base64"), [334]);
    await connection.expect(Buffer.from(config.pass).toString("base64"), [235], "AUTH ***");
    await connection.expect(`MAIL FROM:<${fromAddress}>`, [250]);
    await connection.expect(`RCPT TO:<${to}>`, [250, 251]);
    await connection.expect("DATA", [354]);
    await connection.expect(`${dotStuff(buildMime(config.from, fromAddress, to, message))}\r\n.`, [250], "message body");
    await connection.expect("QUIT", [221]).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}

function defaultOpenSocket(config: SmtpConfig): Socket {
  return config.secure
    ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
    : netConnect({ host: config.host, port: config.port });
}

class SmtpConnection {
  private buffer = "";
  private lines: string[] = [];
  private replies: Reply[] = [];
  private waiter: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (error) => this.fail(new SmtpError(null, `SMTP connection error: ${error.message}`)));
    socket.on("close", () => this.fail(new SmtpError(null, "SMTP connection closed")));
  }

  fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.waiter?.reject(error);
    this.waiter = null;
    this.socket.destroy();
  }

  /** Sends `line` (unless null) and requires one of `codes` in the reply. */
  async expect(line: string | null, codes: number[], label = line ?? "greeting"): Promise<Reply> {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!codes.includes(reply.code)) {
      throw new SmtpError(reply.code, `SMTP ${label.split(" ")[0]} rejected: ${reply.code} ${reply.text}`.trim());
    }
    return reply;
  }

  private read(): Promise<Reply> {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.lines.push(line);
      // "250-..." continues a multi-line reply; "250 ..." (or bare "250") ends it.
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: this.lines.map((part) => part.slice(4)).join(" ").trim() };
        this.lines = [];
        if (this.waiter) {
          const { resolve } = this.waiter;
          this.waiter = null;
          resolve(reply);
        } else {
          this.replies.push(reply);
        }
      }
    }
  }
}

function parseAddress(value: string): string {
  const angle = /<([^>]+)>/.exec(value);
  return (angle ? angle[1] : value).trim();
}

function assertAddress(value: string): string {
  const address = value.trim();
  if (!/^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/.test(address)) throw new SmtpError(null, "Invalid email address");
  return address;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function base64Body(value: string): string {
  return Buffer.from(value).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function buildMime(from: string, fromAddress: string, to: string, message: SmtpMessage): string {
  const angle = /^(.*?)\s*<[^>]+>\s*$/.exec(from);
  const displayName = angle?.[1]?.replace(/^"|"$/g, "").trim();
  const fromHeader = displayName ? `${encodeHeader(displayName)} <${fromAddress}>` : fromAddress;
  const boundary = `oio-${randomUUID()}`;
  const headers = [
    `From: ${fromHeader}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${fromAddress.split("@")[1]}>`,
    "MIME-Version: 1.0",
  ];
  if (!message.html) {
    return [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Body(message.text)].join("\r\n");
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.html),
    `--${boundary}--`,
  ].join("\r\n");
}

function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, "$1..");
}
