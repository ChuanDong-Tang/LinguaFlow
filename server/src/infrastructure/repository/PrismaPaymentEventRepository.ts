import type {
  CreatePaymentEventInput,
  PaymentEventEntity,
  PaymentEventRepository,
  PaymentEventStatus,
} from "@lf/core/ports/repository/PaymentEventRepository.js";

type PrismaPaymentEventClient = {
  paymentEvent: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
};

export class PrismaPaymentEventRepository implements PaymentEventRepository {
  constructor(private readonly prisma: PrismaPaymentEventClient) {}

  async findByProviderEventId(input: {
    provider: string;
    providerEventId: string;
    eventType: string;
  }): Promise<PaymentEventEntity | null> {
    const row = await this.prisma.paymentEvent.findUnique({
      where: {
        provider_providerEventId_eventType: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
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

  async markProcessed(
    id: string,
    options?: { expectedCurrentStatuses?: PaymentEventStatus[] }
  ): Promise<PaymentEventEntity | null> {
    return this.markWithGuard(id, "processed", null, options?.expectedCurrentStatuses);
  }

  async markIgnored(
    id: string,
    errorMessage?: string | null,
    options?: { expectedCurrentStatuses?: PaymentEventStatus[] }
  ): Promise<PaymentEventEntity | null> {
    return this.markWithGuard(id, "ignored", errorMessage ?? null, options?.expectedCurrentStatuses);
  }

  async markFailed(
    id: string,
    errorMessage: string,
    options?: { expectedCurrentStatuses?: PaymentEventStatus[] }
  ): Promise<PaymentEventEntity | null> {
    return this.markWithGuard(id, "failed", errorMessage, options?.expectedCurrentStatuses);
  }

  private async markWithGuard(
    id: string,
    nextStatus: "processed" | "ignored" | "failed",
    errorMessage: string | null,
    expectedCurrentStatuses: PaymentEventStatus[] = ["received"]
  ): Promise<PaymentEventEntity | null> {
    const result = await this.prisma.paymentEvent.updateMany({
      where: {
        id,
        status: { in: expectedCurrentStatuses },
      },
      data: {
        status: nextStatus,
        errorMessage,
        processedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await this.prisma.paymentEvent.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
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
