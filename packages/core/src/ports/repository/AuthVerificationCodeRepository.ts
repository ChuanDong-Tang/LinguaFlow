/** One-time verification codes for self-hosted login, deletion and email binding. */

export type VerificationChannel = "phone" | "email";
export type VerificationPurpose = "login" | "delete_account" | "bind_email";

export interface AuthVerificationCodeRecord {
  id: string;
  channel: VerificationChannel;
  /** Normalized phone (11-digit CN) or lower-case email. */
  target: string;
  purpose: VerificationPurpose;
  userId: string | null;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface AuthVerificationCodeRepository {
  create(input: {
    id: string;
    channel: VerificationChannel;
    target: string;
    purpose: VerificationPurpose;
    userId: string | null;
    codeHash: string;
    expiresAt: Date;
    requestIp: string | null;
  }): Promise<void>;
  /** Most recent code for the target and purpose (consumed or not). */
  findLatest(target: string, purpose: VerificationPurpose): Promise<AuthVerificationCodeRecord | null>;
  countSinceForTarget(target: string, since: Date): Promise<number>;
  countSinceForIp(ip: string, since: Date): Promise<number>;
  /** Atomically add one attempt; returns the new count. */
  incrementAttempts(id: string): Promise<number>;
  /** Mark consumed only if still unconsumed; true when this call consumed it. */
  consume(id: string, at: Date): Promise<boolean>;
  delete(id: string): Promise<void>;
}

/** Who sends and checks codes for a channel: Authing, or our own SMS/email. */
export type PasscodeProvider = "authing" | "local";
export type PasscodeProviderResolver = (channel: VerificationChannel) => PasscodeProvider;
