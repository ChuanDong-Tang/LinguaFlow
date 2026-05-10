export interface TrustedCertEntity {
  id: string;
  provider: "wechat" | "apple";
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
  provider: "wechat" | "apple";
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
  listActiveByProvider(provider: "wechat" | "apple"): Promise<TrustedCertEntity[]>;
  deleteExpiredBefore(input: { provider?: "wechat" | "apple"; before: Date }): Promise<number>;
}
