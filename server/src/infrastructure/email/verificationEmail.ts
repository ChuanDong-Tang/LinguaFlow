import type { VerificationPurpose } from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";
import type { SmtpMessage } from "./SmtpMailer.js";

const COPY: Record<VerificationPurpose, { subject: string; action: string; note: string }> = {
  login: {
    subject: "OIO 登录验证码",
    action: "登录 OIO",
    note: "如果不是你本人操作，请忽略这封邮件。",
  },
  delete_account: {
    subject: "OIO 注销账号验证码",
    action: "注销你的 OIO 账号",
    note: "注销后账号和数据将被删除。如果不是你本人操作，请不要把验证码告诉任何人。",
  },
  bind_email: {
    subject: "OIO 绑定邮箱验证码",
    action: "把这个邮箱绑定到你的 OIO 账号",
    note: "如果不是你本人操作，请忽略这封邮件。",
  },
};

/** The verification email body; plain text plus a simple HTML version. */
export function buildVerificationEmail(input: {
  to: string;
  code: string;
  purpose: VerificationPurpose;
  ttlMinutes: number;
}): SmtpMessage {
  const copy = COPY[input.purpose];
  const text = [
    `你的验证码是 ${input.code}，${input.ttlMinutes} 分钟内有效，用于${copy.action}。`,
    "",
    copy.note,
    "",
    "OIO",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f4;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;color:#1f2a1f">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px 24px">
<p style="margin:0 0 16px;font-size:15px">你的验证码，用于${copy.action}：</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#2f8f4e">${input.code}</p>
<p style="margin:0 0 20px;font-size:14px;color:#5b665b">${input.ttlMinutes} 分钟内有效。${copy.note}</p>
<p style="margin:0;font-size:13px;color:#8a948a">OIO</p>
</div></body></html>`;
  return { to: input.to, subject: copy.subject, text, html };
}
