import type { CreateSystemEventLogInput } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export interface SystemEventLogWriter {
  create: (input: CreateSystemEventLogInput) => Promise<unknown>;
}

export async function writeSystemEventLog(
  writer: SystemEventLogWriter | undefined,
  input: CreateSystemEventLogInput
): Promise<void> {
  if (!writer) return;

  try {
    await writer.create(input);
  } catch {
    // Event logging must not change the user-facing result.
  }
}
