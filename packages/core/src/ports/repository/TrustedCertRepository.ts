export interface TrustedCertEntity {
  id: string;
  provider: "apple";
  keyId: string;
  materialType: string;
  pem: string;
  fingerprint: string | null;
  notBefore: Date | null;
  notAfter: Date | null;
  status: "active" | "retired";
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
}

export interface UpsertTrustedCertInput {
  provider: "apple";
  keyId: string;
  materialType: string;
  pem: string;
  fingerprint?: string | null;
  notBefore?: Date | null;
  notAfter?: Date | null;
  status?: "active" | "retired";
  metadata?: unknown;
  lastSyncedAt?: Date | null;
}

export interface TrustedCertRepository {
  upsert(input: UpsertTrustedCertInput): Promise<TrustedCertEntity>;
  listActiveByProvider(provider: "apple"): Promise<TrustedCertEntity[]>;
  deleteExpiredBefore(input: { provider?: "apple"; before: Date }): Promise<number>;
}
