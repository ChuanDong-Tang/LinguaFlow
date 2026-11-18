import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AuthVerificationCodeRepository,
  VerificationChannel,
  VerificationPurpose,
} from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";
import type { VerificationCodeSender } from "@lf/core/ports/auth/VerificationCodeSender.js";

export type VerificationCodeErrorCode =
  | "PASSCODE_TOO_FREQUENT"
  | "PASSCODE_LIMIT_REACHED"
  | "PASSCODE_INVALID"
  | "PASSCODE_SEND_FAILED";

export class VerificationCodeError extends Error {
  constructor(readonly code: VerificationCodeErrorCode, message: string) {
    super(message);
  }
}

export interface VerificationCodePolicy {
  ttlMs: number;
  resendCooldownMs: number;
  maxPerTargetPerDay: number;
  maxPerIpPerHour: number;
  maxAttempts: number;
}

export const DEFAULT_VERIFICATION_CODE_POLICY: VerificationCodePolicy = {
  ttlMs: 10 * 60_000,
  resendCooldownMs: 60_000,
  maxPerTargetPerDay: 10,
  maxPerIpPerHour: 30,
  maxAttempts: 5,
};

/**
 * Issues and checks one-time codes. Only an HMAC of the code is stored; every
 * check counts as an attempt before comparing, so a code survives at most
 * `maxAttempts` guesses.
 */
export class VerificationCodeService {
  constructor(
    private readonly repository: AuthVerificationCodeRepository,
    private readonly sender: VerificationCodeSender,
    private readonly hashKey: string,
    private readonly policy: VerificationCodePolicy = DEFAULT_VERIFICATION_CODE_POLICY,
    private readonly now: () => Date = () => new Date(),
    private readonly generateCode: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
  ) {}

  async issue(input: {
    channel: VerificationChannel;
    target: string;
    purpose: VerificationPurpose;
    userId?: string | null;
    requestIp?: string | null;
  }): Promise<void> {
    const now = this.now();
    const latest = await this.repository.findLatest(input.target, input.purpose);
    if (latest && now.getTime() - latest.createdAt.getTime() < this.policy.resendCooldownMs) {
      throw new VerificationCodeError("PASSCODE_TOO_FREQUENT", "Please wait before requesting another code");
    }
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    if (await this.repository.countSinceForTarget(input.target, dayAgo) >= this.policy.maxPerTargetPerDay) {
      throw new VerificationCodeError("PASSCODE_LIMIT_REACHED", "Too many codes for this account today");
    }
    if (input.requestIp) {
      const hourAgo = new Date(now.getTime() - 60 * 60_000);
      if (await this.repository.countSinceForIp(input.requestIp, hourAgo) >= this.policy.maxPerIpPerHour) {
        throw new VerificationCodeError("PASSCODE_LIMIT_REACHED", "Too many codes from this network");
      }
    }

    const id = randomUUID();
    const code = this.generateCode();
    await this.repository.create({
      id,
      channel: input.channel,
      target: input.target,
      purpose: input.purpose,
      userId: input.userId ?? null,
      codeHash: this.hash(id, code),
      expiresAt: new Date(now.getTime() + this.policy.ttlMs),
      requestIp: input.requestIp ?? null,
    });
    const ttlMinutes = Math.round(this.policy.ttlMs / 60_000);
    try {
      if (input.channel === "phone") await this.sender.sendSms({ phone: input.target, code, purpose: input.purpose, ttlMinutes });
      else await this.sender.sendEmail({ email: input.target, code, purpose: input.purpose, ttlMinutes });
    } catch (error) {
      // Nothing was delivered: free the cooldown and the daily allowance.
      await this.repository.delete(id).catch(() => undefined);
      throw new VerificationCodeError("PASSCODE_SEND_FAILED", error instanceof Error ? error.message : "Send failed");
    }
  }

  /** Returns the userId recorded when the code was issued (null for login). */
  async verify(input: { target: string; purpose: VerificationPurpose; code: string }): Promise<{ userId: string | null }> {
    const code = input.code.trim();
    const record = await this.repository.findLatest(input.target, input.purpose);
    const now = this.now();
    if (
      !record
      || record.consumedAt
      || record.expiresAt.getTime() <= now.getTime()
      || record.attempts >= this.policy.maxAttempts
      || !/^\d{6}$/.test(code)
    ) {
      throw new VerificationCodeError("PASSCODE_INVALID", "Verification code is invalid or expired");
    }
    const attempts = await this.repository.incrementAttempts(record.id);
    if (attempts > this.policy.maxAttempts || !this.matches(record.id, code, record.codeHash)) {
      throw new VerificationCodeError("PASSCODE_INVALID", "Verification code is invalid or expired");
    }
    if (!await this.repository.consume(record.id, now)) {
      throw new VerificationCodeError("PASSCODE_INVALID", "Verification code was already used");
    }
    return { userId: record.userId };
  }

  private hash(id: string, code: string): string {
    return createHmac("sha256", this.hashKey).update(`${id}:${code}`).digest("hex");
  }

  private matches(id: string, code: string, stored: string): boolean {
    const actual = Buffer.from(this.hash(id, code), "hex");
    const expected = Buffer.from(stored, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
