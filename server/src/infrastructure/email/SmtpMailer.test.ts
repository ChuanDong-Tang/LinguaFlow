import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Server } from "node:net";
import test from "node:test";
import { sendSmtpMail, SmtpError } from "./SmtpMailer.js";
import { buildVerificationEmail } from "./verificationEmail.js";

/** A scripted SMTP server: records commands, answers like SES SMTP does. */
async function fakeSmtp(options: { rejectAuth?: boolean } = {}) {
  const commands: string[] = [];
  let data = "";
  const server: Server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let authStep = 0;
    socket.write("220 smtp.example ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 queued\r\n"); } else data += `${line}\r\n`;
          continue;
        }
        commands.push(line);
        if (authStep === 1) { authStep = 2; socket.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authStep === 2) { authStep = 0; socket.write(options.rejectAuth ? "535 Authentication failed\r\n" : "235 ok\r\n"); continue; }
        if (line.startsWith("EHLO")) socket.write("250-smtp.example\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n");
        else if (line === "AUTH LOGIN") { authStep = 1; socket.write("334 VXNlcm5hbWU6\r\n"); }
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line === "DATA") { inData = true; socket.write("354 go\r\n"); }
        else if (line === "QUIT") { socket.end("221 bye\r\n"); }
        else socket.write("500 unknown\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const config = { host: "127.0.0.1", port, secure: false, user: "noreply@yueyantech.com", pass: "secret", from: "OIO <noreply@yueyantech.com>" };
  return { config, commands, data: () => data, close: () => new Promise((resolve) => server.close(resolve)) };
}

function decodeParts(raw: string): string[] {
  return [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)]
    .map((match) => Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
}

test("sends a verification email over SMTP with AUTH LOGIN and a UTF-8 body", async () => {
  const smtp = await fakeSmtp();
  try {
    await sendSmtpMail(smtp.config, buildVerificationEmail({ to: "user@example.com", code: "042517", purpose: "login", ttlMinutes: 10 }));
    assert.deepEqual(smtp.commands, [
      "EHLO yueyantech.com",
      "AUTH LOGIN",
      Buffer.from("noreply@yueyantech.com").toString("base64"),
      Buffer.from("secret").toString("base64"),
      "MAIL FROM:<noreply@yueyantech.com>",
      "RCPT TO:<user@example.com>",
      "DATA",
      "QUIT",
    ]);
    const raw = smtp.data();
    assert.match(raw, /^From: OIO <noreply@yueyantech\.com>\r\n/);
    assert.match(raw, /\r\nTo: <user@example\.com>\r\n/);
    assert.match(raw, new RegExp(`Subject: =\\?UTF-8\\?B\\?${Buffer.from("OIO 登录验证码").toString("base64").replace(/[+/=]/g, "\\$&")}\\?=`));
    const [text, html] = decodeParts(raw);
    assert.match(text, /你的验证码是 042517，10 分钟内有效，用于登录 OIO。/);
    assert.match(html, />042517</);
  } finally {
    await smtp.close();
  }
});

test("a rejected login surfaces as an SmtpError without leaking the password", async () => {
  const smtp = await fakeSmtp({ rejectAuth: true });
  try {
    await assert.rejects(
      sendSmtpMail(smtp.config, { to: "user@example.com", subject: "x", text: "y" }),
      (error: unknown) => error instanceof SmtpError && error.replyCode === 535 && !error.message.includes("secret") && !error.message.includes(Buffer.from("secret").toString("base64")),
    );
  } finally {
    await smtp.close();
  }
});

test("header injection through the recipient is refused", async () => {
  await assert.rejects(
    sendSmtpMail({ host: "127.0.0.1", port: 1, secure: false, user: "a", pass: "b", from: "a@b.co" }, { to: "x@y.co\r\nBcc: z@y.co", subject: "s", text: "t" }),
    SmtpError,
  );
});
