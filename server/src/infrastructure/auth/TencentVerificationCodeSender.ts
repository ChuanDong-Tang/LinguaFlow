import type { VerificationCodeSender } from "@lf/core/ports/auth/VerificationCodeSender.js";
import type { VerificationPurpose } from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";
import { callTencentCloudApi, type TencentCloudCredentials } from "../tencent/TencentCloudApi.js";
import { sendSmtpMail, type SmtpConfig } from "../email/SmtpMailer.js";
import { buildVerificationEmail } from "../email/verificationEmail.js";

/**
 * Sends verification codes with Tencent Cloud SMS (SendSms 2021-01-11) and
 * Simple Email Service (SendEmail 2020-10-02).
 *
 * One approved "verification code" template per channel is enough: SMS
 * `{1}` = code, `{2}` = minutes; email template variables `code`, `minutes`.
 * A purpose-specific template id, when configured, overrides the default.
 * With `smtp` set, email goes through SES SMTP with our own body instead of a
 * SendEmail template (no template review needed).
 */
export interface TencentVerificationCodeSenderConfig {
  credentials: TencentCloudCredentials;
  sms: {
    sdkAppId: string;
    signName: string;
    templateId: string;
    templateIds?: Partial<Record<VerificationPurpose, string>>;
    region: string;
  };
  email: {
    from: string;
    templateId: number;
    templateIds?: Partial<Record<VerificationPurpose, number>>;
    region: string;
  };
  smtp?: SmtpConfig | null;
}

const EMAIL_SUBJECTS: Record<VerificationPurpose, string> = {
  login: "OIO 登录验证码",
  delete_account: "OIO 注销账号验证码",
  bind_email: "OIO 绑定邮箱验证码",
};

export class TencentVerificationCodeSender implements VerificationCodeSender {
  constructor(private readonly config: TencentVerificationCodeSenderConfig) {}

  async sendSms(input: { phone: string; code: string; purpose: VerificationPurpose; ttlMinutes: number }): Promise<void> {
    const { sms } = this.config;
    const response = await callTencentCloudApi<{ SendStatusSet?: Array<{ Code?: string; Message?: string }> }>({
      credentials: this.config.credentials,
      service: "sms",
      host: "sms.tencentcloudapi.com",
      action: "SendSms",
      version: "2021-01-11",
      region: sms.region,
      payload: {
        PhoneNumberSet: [`+86${input.phone}`],
        SmsSdkAppId: sms.sdkAppId,
        SignName: sms.signName,
        TemplateId: sms.templateIds?.[input.purpose] ?? sms.templateId,
        TemplateParamSet: [input.code, String(input.ttlMinutes)],
      },
    });
    const status = response.SendStatusSet?.[0];
    if (!status || status.Code !== "Ok") {
      throw new Error(`SMS not sent: ${status?.Code ?? "NO_STATUS"} ${status?.Message ?? ""}`.trim());
    }
  }

  async sendEmail(input: { email: string; code: string; purpose: VerificationPurpose; ttlMinutes: number }): Promise<void> {
    const { email, smtp } = this.config;
    if (smtp) {
      await sendSmtpMail(smtp, buildVerificationEmail({ to: input.email, code: input.code, purpose: input.purpose, ttlMinutes: input.ttlMinutes }));
      return;
    }
    await callTencentCloudApi({
      credentials: this.config.credentials,
      service: "ses",
      host: "ses.tencentcloudapi.com",
      action: "SendEmail",
      version: "2020-10-02",
      region: email.region,
      payload: {
        FromEmailAddress: email.from,
        Destination: [input.email],
        Subject: EMAIL_SUBJECTS[input.purpose],
        Template: {
          TemplateID: email.templateIds?.[input.purpose] ?? email.templateId,
          TemplateData: JSON.stringify({ code: input.code, minutes: String(input.ttlMinutes) }),
        },
      },
    });
  }
}
