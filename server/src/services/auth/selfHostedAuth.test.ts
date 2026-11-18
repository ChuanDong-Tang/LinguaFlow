import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthVerificationCodeRecord,
  AuthVerificationCodeRepository,
} from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";
import type { UserEntity } from "@lf/core/ports/repository/UserRepository.js";
import { normalizeCnPhone, normalizeEmailAddress, InvalidContactError } from "./contactNormalization.js";
import { hashPassword, verifyPassword } from "./PasswordHasher.js";
import { VerificationCodeError, VerificationCodeService } from "./VerificationCodeService.js";
import { AuthLoginService, PasswordLoginError } from "./AuthLoginService.js";
import { AccountDeletionService } from "./AccountDeletionService.js";
import { AccountEmailBindingService } from "./AccountEmailBindingService.js";

// ---------------------------------------------------------------- helpers

class MemoryCodes implements AuthVerificationCodeRepository {
  rows: Array<AuthVerificationCodeRecord & { requestIp: string | null }> = [];
  constructor(private readonly clock: () => Date) {}
  async create(input: Parameters<AuthVerificationCodeRepository["create"]>[0]) {
    this.rows.push({ ...input, attempts: 0, consumedAt: null, createdAt: this.clock() });
  }
  async findLatest(target: string, purpose: string) {
    return [...this.rows].reverse().find((row) => row.target === target && row.purpose === purpose) ?? null;
  }
  async countSinceForTarget(target: string, since: Date) {
    return this.rows.filter((row) => row.target === target && row.createdAt >= since).length;
  }
  async countSinceForIp(ip: string, since: Date) {
    return this.rows.filter((row) => row.requestIp === ip && row.createdAt >= since).length;
  }
  async incrementAttempts(id: string) {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    row.attempts += 1;
    return row.attempts;
  }
  async consume(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    if (row.consumedAt) return false;
    row.consumedAt = at;
    return true;
  }
  async delete(id: string) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

function codeService(options: { failSend?: boolean } = {}) {
  let now = new Date("2026-11-18T08:00:00Z");
  const clock = () => now;
  const repository = new MemoryCodes(clock);
  const sent: Array<{ to: string; code: string }> = [];
  let next = 0;
  const service = new VerificationCodeService(
    repository,
    {
      async sendSms({ phone, code }) { if (options.failSend) throw new Error("provider down"); sent.push({ to: phone, code }); },
      async sendEmail({ email, code }) { if (options.failSend) throw new Error("provider down"); sent.push({ to: email, code }); },
    },
    "test-key",
    undefined,
    clock,
    () => String(123456 + next++),
  );
  return { service, repository, sent, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

function user(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: "user-1", nickname: null, email: null, phone: "13800000000", avatarUrl: null,
    status: "active", role: "user", createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
  };
}

function loginService(options: {
  users?: UserEntity[];
  hashes?: Map<string, string>;
  authingPasswordFallback?: boolean;
  authingSub?: string;
  passcodeProvider?: "authing" | "local";
  codes?: VerificationCodeService;
}) {
  const users = options.users ?? [];
  const hashes = options.hashes ?? new Map<string, string>();
  const authingCalls: string[] = [];
  const repository = {
    findByEmail: async (email: string) => users.find((candidate) => candidate.email === email) ?? null,
    findByPhone: async (phone: string) => users.find((candidate) => candidate.phone === phone) ?? null,
    findOrCreateByContact: async (input: { phone?: string | null; email?: string | null }) => {
      const found = users.find((candidate) => (input.phone && candidate.phone === input.phone) || (input.email && candidate.email === input.email));
      if (found) return { user: found, isNewUser: false };
      const created = user({ id: `user-${users.length + 1}`, phone: input.phone ?? null, email: input.email ?? null });
      users.push(created);
      return { user: created, isNewUser: true };
    },
    getPasswordHash: async (id: string) => hashes.get(id) ?? null,
    setPasswordHash: async (id: string, hash: string) => { hashes.set(id, hash); },
    findOrCreateByAuthIdentity: async () => ({ user: users.find((candidate) => candidate.id === "user-1")!, isNewUser: false }),
  };
  const sessions = { create: async () => undefined };
  const service = new AuthLoginService(repository as never, sessions as never, {
    passcodeProvider: () => options.passcodeProvider ?? "local",
    authingPasswordFallback: () => options.authingPasswordFallback ?? true,
    verificationCodes: options.codes,
    authing: {
      passwordToken: async ({ account, password }) => {
        authingCalls.push(account);
        if (password !== "authing-secret") throw new Error("Authing: wrong password");
        return "authing-token";
      },
      userInfo: async () => ({ sub: options.authingSub ?? "authing-sub", nickname: null, email: null, phone: "13800000000", picture: null }),
    },
  });
  return { service, users, hashes, authingCalls };
}

// ---------------------------------------------------------------- contacts

test("phones are stored as 11-digit mainland numbers; other regions are refused", () => {
  assert.equal(normalizeCnPhone("138 0000 0000"), "13800000000");
  assert.equal(normalizeCnPhone("+8613800000000"), "13800000000");
  assert.equal(normalizeCnPhone("13800000000", "+86"), "13800000000");
  assert.throws(() => normalizeCnPhone("1380000000"), InvalidContactError);
  assert.throws(() => normalizeCnPhone("91234567", "+852"), InvalidContactError);
  assert.equal(normalizeEmailAddress("  Foo@Example.COM "), "foo@example.com");
  assert.throws(() => normalizeEmailAddress("not-an-email"), InvalidContactError);
});

// ---------------------------------------------------------------- passwords

test("password hashes verify the right password only", async () => {
  const stored = await hashPassword("correct horse");
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse", stored), true);
  assert.equal(await verifyPassword("correct horsE", stored), false);
  assert.equal(await verifyPassword("correct horse", "garbage"), false);
  assert.notEqual(await hashPassword("correct horse"), stored, "salted");
});

// ---------------------------------------------------------------- codes

test("a code is single-use, expires, and survives at most five guesses", async () => {
  const { service, sent, advance } = codeService();
  await service.issue({ channel: "phone", target: "13800000000", purpose: "login" });
  assert.deepEqual(sent, [{ to: "13800000000", code: "123456" }]);
  for (let guess = 0; guess < 5; guess += 1) {
    await assert.rejects(service.verify({ target: "13800000000", purpose: "login", code: "000000" }), VerificationCodeError);
  }
  await assert.rejects(service.verify({ target: "13800000000", purpose: "login", code: "123456" }), /invalid or expired/, "locked after five wrong guesses");

  advance(61_000);
  await service.issue({ channel: "phone", target: "13800000000", purpose: "login" });
  assert.deepEqual(await service.verify({ target: "13800000000", purpose: "login", code: "123457" }), { userId: null });
  await assert.rejects(service.verify({ target: "13800000000", purpose: "login", code: "123457" }), VerificationCodeError, "already used");

  advance(61_000);
  await service.issue({ channel: "email", target: "a@b.co", purpose: "login" });
  advance(10 * 60_000 + 1);
  await assert.rejects(service.verify({ target: "a@b.co", purpose: "login", code: "123458" }), VerificationCodeError, "expired");
});

test("codes for one purpose cannot be used for another", async () => {
  const { service } = codeService();
  await service.issue({ channel: "phone", target: "13800000000", purpose: "delete_account", userId: "user-1" });
  await assert.rejects(service.verify({ target: "13800000000", purpose: "login", code: "123456" }), VerificationCodeError);
  assert.deepEqual(await service.verify({ target: "13800000000", purpose: "delete_account", code: "123456" }), { userId: "user-1" });
});

test("sending is rate limited per number and per network, and a failed send costs nothing", async () => {
  const { service, advance } = codeService();
  await service.issue({ channel: "phone", target: "13800000000", purpose: "login" });
  await assert.rejects(service.issue({ channel: "phone", target: "13800000000", purpose: "login" }), (error: unknown) => (error as VerificationCodeError).code === "PASSCODE_TOO_FREQUENT");
  for (let i = 1; i < 10; i += 1) { advance(61_000); await service.issue({ channel: "phone", target: "13800000000", purpose: "login" }); }
  advance(61_000);
  await assert.rejects(service.issue({ channel: "phone", target: "13800000000", purpose: "login" }), (error: unknown) => (error as VerificationCodeError).code === "PASSCODE_LIMIT_REACHED");

  const ip = codeService();
  for (let i = 0; i < 30; i += 1) await ip.service.issue({ channel: "phone", target: `139000000${String(i).padStart(2, "0")}`, purpose: "login", requestIp: "1.2.3.4" });
  await assert.rejects(ip.service.issue({ channel: "phone", target: "13700000000", purpose: "login", requestIp: "1.2.3.4" }), (error: unknown) => (error as VerificationCodeError).code === "PASSCODE_LIMIT_REACHED");

  const failing = codeService({ failSend: true });
  await assert.rejects(failing.service.issue({ channel: "phone", target: "13800000000", purpose: "login" }), (error: unknown) => (error as VerificationCodeError).code === "PASSCODE_SEND_FAILED");
  assert.equal(failing.repository.rows.length, 0, "no cooldown left behind");
});

// ---------------------------------------------------------------- login

test("self-hosted code login finds the existing account by phone and returns an account token", async () => {
  const codes = codeService();
  const existing = user({ id: "user-1", phone: "13800000000" });
  const { service } = loginService({ users: [existing], codes: codes.service });
  await service.sendAuthingPasscode({ channel: "phone", phone: "13800000000" });
  const result = await service.loginWithAuthingPasscode({ channel: "phone", phone: "13800000000", passCode: "123456" });
  assert.equal(result.user.id, "user-1");
  assert.equal(result.isNewUser, false);
  assert.ok(result.accessToken && result.refreshToken);
  assert.equal(JSON.parse(Buffer.from(result.authingToken.split(".")[1], "base64url").toString()).typ, "account");
});

test("self-hosted code login creates an account for a new email and refuses a disabled one", async () => {
  const codes = codeService();
  const { service, users } = loginService({ users: [user({ id: "banned", phone: "13900000000", status: "disabled" })], codes: codes.service });
  await service.sendAuthingPasscode({ channel: "email", email: "New@Example.com" });
  const created = await service.loginWithAuthingPasscode({ channel: "email", email: "new@example.com", passCode: "123456" });
  assert.equal(created.isNewUser, true);
  assert.equal(users.at(-1)?.email, "new@example.com");

  codes.advance(61_000);
  await service.sendAuthingPasscode({ channel: "phone", phone: "13900000000" });
  await assert.rejects(service.loginWithAuthingPasscode({ channel: "phone", phone: "13900000000", passCode: "123457" }), /disabled/);
});

test("a password is checked by Authing once, then only locally", async () => {
  const { service, hashes, authingCalls } = loginService({ users: [user()] });
  const first = await service.loginWithAuthingPassword({ account: "13800000000", password: "authing-secret" });
  assert.equal(first.user.id, "user-1");
  assert.deepEqual(authingCalls, ["13800000000"]);
  assert.ok(hashes.get("user-1")?.startsWith("scrypt$"), "hash captured");

  const second = await service.loginWithAuthingPassword({ account: "13800000000", password: "authing-secret" });
  assert.equal(second.user.id, "user-1");
  assert.deepEqual(authingCalls, ["13800000000"], "Authing not called again");
  await assert.rejects(service.loginWithAuthingPassword({ account: "13800000000", password: "wrong" }), (error: unknown) => (error as PasswordLoginError).reason === "PASSWORD_MISMATCH");
  assert.deepEqual(authingCalls, ["13800000000"], "a wrong local password never falls back to Authing");
});

test("after Authing is switched off an unmigrated password is refused, and usernames still go to Authing before that", async () => {
  const off = loginService({ users: [user()], authingPasswordFallback: false });
  await assert.rejects(off.service.loginWithAuthingPassword({ account: "13800000000", password: "authing-secret" }), (error: unknown) => (error as PasswordLoginError).reason === "PASSWORD_NOT_SET");
  assert.deepEqual(off.authingCalls, []);

  const on = loginService({ users: [user()] });
  await on.service.loginWithAuthingPassword({ account: "oio_reader", password: "authing-secret" });
  assert.deepEqual(on.authingCalls, ["oio_reader"]);
});

// ---------------------------------------------------------------- deletion & email binding


test("self-hosted deletion sends the code to the account's own phone and only that account's code deletes it", async () => {
  const codes = codeService();
  const accounts = [user({ id: "user-1", phone: "13800000000" }), user({ id: "user-2", phone: null, email: "two@example.com" })];
  const deleted: string[] = [];
  const revoked: string[] = [];
  const repository = {
    findById: async (id: string) => accounts.find((candidate) => candidate.id === id) ?? null,
    markPendingDeleteById: async (id: string) => { deleted.push(id); return accounts[0]; },
  };
  const sessions = { revokeAllByUserId: async (id: string) => { revoked.push(id); } };
  const service = new AccountDeletionService(repository as never, sessions as never, { verificationCodes: codes.service, passcodeProvider: () => "local" });

  const prepared = await service.prepare({ userId: "user-1" });
  assert.deepEqual(prepared, { authingToken: "local", method: "PHONE_PASSCODE", target: "138****0000" });
  assert.deepEqual(codes.sent.at(-1), { to: "13800000000", code: "123456" });
  await assert.rejects(service.confirm({ userId: "user-1", method: "PHONE_PASSCODE", passCode: "999999" }), VerificationCodeError);
  assert.deepEqual(await service.confirm({ userId: "user-1", method: "PHONE_PASSCODE", passCode: "123456" }), { success: true });
  assert.deepEqual(deleted, ["user-1"]);
  assert.deepEqual(revoked, ["user-1"]);

  const emailOnly = await service.prepare({ userId: "user-2", authingToken: "old-client-token" });
  assert.deepEqual(emailOnly, { authingToken: "old-client-token", method: "EMAIL_PASSCODE", target: "tw***@example.com" });
});

test("self-hosted email binding verifies the new address and stores it lower-case", async () => {
  const codes = codeService();
  const account = user({ id: "user-1", phone: "13800000000", email: null });
  let saved: string | null = null;
  const repository = {
    findById: async () => account,
    findByEmail: async () => null,
    updateEmailById: async (_id: string, email: string) => { saved = email; return { ...account, email }; },
  };
  const service = new AccountEmailBindingService(repository as never, { verificationCodes: codes.service, passcodeProvider: () => "local" });
  const prepared = await service.prepare({ userId: "user-1", email: "Me@Example.com" });
  assert.equal(prepared.target, "me***@example.com");
  assert.deepEqual(codes.sent.at(-1), { to: "me@example.com", code: "123456" });
  await service.confirm({ userId: "user-1", email: "me@example.com", passCode: "123456" });
  assert.equal(saved, "me@example.com");
});
