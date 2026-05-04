export type SystemEventLogLevel = "info" | "warn" | "error";
export type SystemEventLogStatus = "success" | "failed" | "ignored";

export interface SystemEventLogEntity {
  id: string;
  requestId: string | null;
  userId: string | null;
  module: string;
  event: string;
  level: SystemEventLogLevel;
  status: SystemEventLogStatus;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: unknown | null;
  createdAt: Date;
}

export interface CreateSystemEventLogInput {
  requestId?: string | null;
  userId?: string | null;
  module: string;
  event: string;
  level: SystemEventLogLevel;
  status: SystemEventLogStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: unknown | null;
}

export interface SystemEventLogRepository {
  create(input: CreateSystemEventLogInput): Promise<SystemEventLogEntity>;
}
