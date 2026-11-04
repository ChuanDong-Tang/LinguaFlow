import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sanitizeGoogleBillingDiagnostic } from "@lf/core/payment/googleBillingDiagnostics.js";
import { writeSystemEventLog, type SystemEventLogWriter } from "../lib/systemEventLog.js";

export function registerGoogleBillingDiagnostics(app: FastifyInstance, deps: {
  authorize: (req: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null | undefined>;
  allowed: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  writer?: SystemEventLogWriter;
}): void {
  app.post("/payment/google-play/client-error", { bodyLimit: 4096 }, async (req, reply) => {
    if (!await deps.allowed(req, reply)) return;
    const user = await deps.authorize(req, reply);
    if (!user) return;
    const metadata = sanitizeGoogleBillingDiagnostic(req.body);
    if (!metadata) return reply.status(400).send({ ok: false, error: { code: "INVALID_DIAGNOSTIC" } });
    await writeSystemEventLog(deps.writer, {
      userId: user.userId, requestId: req.id, module: "payment", event: "payment.google_play.client_error",
      status: "failed", level: "warn", errorCode: "GOOGLE_PLAY_CLIENT_ERROR",
      metadata: { ...metadata, source: "untrusted_client", platform: "android", distribution: "google" },
    });
    return reply.status(202).send({ ok: true });
  });
}
