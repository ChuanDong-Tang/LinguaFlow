import type { PrismaClient } from "@prisma/client";
import type {
  AuthVerificationCodeRecord,
  AuthVerificationCodeRepository,
  VerificationChannel,
  VerificationPurpose,
} from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";

export class PrismaAuthVerificationCodeRepository implements AuthVerificationCodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Parameters<AuthVerificationCodeRepository["create"]>[0]): Promise<void> {
    await this.prisma.authVerificationCode.create({ data: input });
  }

  async findLatest(target: string, purpose: VerificationPurpose): Promise<AuthVerificationCodeRecord | null> {
    const row = await this.prisma.authVerificationCode.findFirst({
      where: { target, purpose },
      orderBy: { createdAt: "desc" },
    });
    return row ? {
      id: row.id,
      channel: row.channel as VerificationChannel,
      target: row.target,
      purpose: row.purpose as VerificationPurpose,
      userId: row.userId,
      codeHash: row.codeHash,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
    } : null;
  }

  countSinceForTarget(target: string, since: Date): Promise<number> {
    return this.prisma.authVerificationCode.count({ where: { target, createdAt: { gte: since } } });
  }

  countSinceForIp(ip: string, since: Date): Promise<number> {
    return this.prisma.authVerificationCode.count({ where: { requestIp: ip, createdAt: { gte: since } } });
  }

  async incrementAttempts(id: string): Promise<number> {
    const row = await this.prisma.authVerificationCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return row.attempts;
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.authVerificationCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: at },
    });
    return result.count === 1;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.authVerificationCode.deleteMany({ where: { id } });
  }
}
