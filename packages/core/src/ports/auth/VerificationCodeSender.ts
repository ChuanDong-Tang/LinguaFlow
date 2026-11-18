import type { VerificationPurpose } from "../repository/AuthVerificationCodeRepository.js";

/** Delivers a verification code by SMS or email (Tencent Cloud in production). */
export interface VerificationCodeSender {
  sendSms(input: { phone: string; code: string; purpose: VerificationPurpose; ttlMinutes: number }): Promise<void>;
  sendEmail(input: { email: string; code: string; purpose: VerificationPurpose; ttlMinutes: number }): Promise<void>;
}
