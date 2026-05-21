import type {
  CreateSystemEventLogInput,
  SystemEventLogEntity,
  SystemEventLogRepository,
} from "@lf/core/ports/repository/SystemEventLogRepository.js";

type PrismaSystemEventLogClient = {
  systemEventLog: {
    create: (args: any) => Promise<any>;
  };
};

export class PrismaSystemEventLogRepository implements SystemEventLogRepository {
  constructor(private readonly prisma: PrismaSystemEventLogClient) {}

  async create(input: CreateSystemEventLogInput): Promise<SystemEventLogEntity> {
    const row = await this.prisma.systemEventLog.create({
      data: {
        requestId: input.requestId ?? null,
        userId: input.userId ?? null,
        module: input.module,
        event: input.event,
        level: input.level,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    requestId: string | null;
    userId: string | null;
    module: string;
    event: string;
    level: "info" | "warn" | "error";
    status: "success" | "failed" | "ignored";
    errorCode: string | null;
    errorMessage: string | null;
    metadata: unknown | null;
    createdAt: Date;
  }): SystemEventLogEntity {
    return {
      id: row.id,
      requestId: row.requestId,
      userId: row.userId,
      module: row.module,
      event: row.event,
      level: row.level,
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      metadata: row.metadata,
      createdAt: row.createdAt,
    };
  }
}
