import type { FastifyInstance } from "fastify";

type AppPlatform = "ios" | "android";

export function registerAppVersionRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { platform?: string } }>("/app/version", async (req, reply) => {
    const platform = req.query.platform;
    if (platform !== "ios" && platform !== "android") {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_PLATFORM", message: "platform must be ios or android" } });
    }

    const policy = appVersionPolicy(platform);
    reply.header("Cache-Control", "public, max-age=300");
    return reply.status(200).send({ ok: true, data: policy });
  });
}

function appVersionPolicy(platform: AppPlatform) {
  const latestVersion = process.env.LF_APP_LATEST_VERSION?.trim() || null;
  const storeUrl = platform === "ios"
    ? "https://apps.apple.com/app/id6776898160"
    : "https://play.google.com/store/apps/details?id=com.yueyantech.oio";

  return {
    platform,
    enabled: Boolean(latestVersion),
    latestVersion,
    storeUrl,
  };
}
