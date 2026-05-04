export type PaymentEventStatus = "received" | "processed" | "ignored" | "failed";

export interface PaymentEventEntity {
  id: string;
  provider: string;
  providerEventId: string;
  providerOrderId: string | null;
  eventType: string;
  status: PaymentEventStatus;
  rawPayload: unknown;
  errorMessage: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface CreatePaymentEventInput {
  provider: string;
  providerEventId: string;
  providerOrderId?: string | null;
  eventType: string;
  rawPayload: unknown;
}

export interface PaymentEventRepository {
  findByProviderEventId(input: {
    provider: string;
    providerEventId: string;
  }): Promise<PaymentEventEntity | null>;
  create(input: CreatePaymentEventInput): Promise<PaymentEventEntity>;
  markProcessed(id: string): Promise<PaymentEventEntity>;
  markIgnored(id: string, errorMessage?: string | null): Promise<PaymentEventEntity>;
  markFailed(id: string, errorMessage: string): Promise<PaymentEventEntity>;
}
