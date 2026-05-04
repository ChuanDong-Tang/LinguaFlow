import type {
  CreatePaymentEventInput,
  PaymentEventEntity,
  PaymentEventRepository,
} from "@lf/core/ports/repository/PaymentEventRepository.js";

type PrismaPaymentEventClient = {
  paymentEvent: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
};

export class PrismaPaymentEventRepository implements PaymentEventRepository {
  constructor(private readonly prisma: PrismaPaymentEventClient) {}

  async findByProviderEventId(input: {
    provider: string;
    providerEventId: string;
  }): Promise<PaymentEventEntity | null> {
    const row = await this.prisma.paymentEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.providerEventId,
        },
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async create(input: CreatePaymentEventInput): Promise<PaymentEventEntity> {
    const row = await this.prisma.paymentEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId ?? null,
        eventType: input.eventType,
        rawPayload: input.rawPayload,
        status: "received",
      },
    });

    return this.toEntity(row);
  }

  async markProcessed(id: string): Promise<PaymentEventEntity> {
    const row = await this.prisma.paymentEvent.update({
      where: { id },
      data: {
        status: "processed",
        processedAt: new Date(),
      },
    });

    return this.toEntity(row);
  }

  async markIgnored(id: string, errorMessage?: string | null): Promise<PaymentEventEntity> {
    const row = await this.prisma.paymentEvent.update({
      where: { id },
      data: {
        status: "ignored",
        errorMessage: errorMessage ?? null,
        processedAt: new Date(),
      },
    });

    return this.toEntity(row);
  }

  async markFailed(id: string, errorMessage: string): Promise<PaymentEventEntity> {
    const row = await this.prisma.paymentEvent.update({
      where: { id },
      data: {
        status: "failed",
        errorMessage,
        processedAt: new Date(),
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    provider: string;
    providerEventId: string;
    providerOrderId: string | null;
    eventType: string;
    status: "received" | "processed" | "ignored" | "failed";
    rawPayload: unknown;
    errorMessage: string | null;
    createdAt: Date;
    processedAt: Date | null;
  }): PaymentEventEntity {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      providerOrderId: row.providerOrderId,
      eventType: row.eventType,
      status: row.status,
      rawPayload: row.rawPayload,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
    };
  }
}
