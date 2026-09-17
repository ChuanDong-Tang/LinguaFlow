import type { FastifyInstance } from "fastify";

type AppPlatform = "ios" | "android";
type AppDistribution = "china" | "google" | null;

export function registerAppVersionRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { platform?: string; distribution?: string } }>("/app/version", async (req, reply) => {
    const platform = req.query.platform;
    if (platform !== "ios" && platform !== "android") {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_PLATFORM", message: "platform must be ios or android" } });
    }

    const policy = appVersionPolicy(platform, appDistribution(req.query.distribution));
    reply.header("Cache-Control", "public, max-age=300");
    return reply.status(200).send({ ok: true, data: policy });
  });
}

export function appVersionPolicy(
  platform: AppPlatform,
  distribution: AppDistribution,
  env: NodeJS.ProcessEnv = process.env,
) {
  const defaultLatestVersion = env.LF_APP_LATEST_VERSION?.trim() || null;
  const latestVersion = platform === "ios"
    ? env.LF_APP_IOS_LATEST_VERSION?.trim() || defaultLatestVersion
    : distribution === "china"
      ? env.LF_APP_CHINA_ANDROID_LATEST_VERSION?.trim() || defaultLatestVersion
      : env.LF_APP_GOOGLE_ANDROID_LATEST_VERSION?.trim() || defaultLatestVersion;
  const storeUrl = platform === "ios"
    ? "https://apps.apple.com/app/id6776898160"
    : distribution === "china"
      ? env.LF_APP_CHINA_ANDROID_DOWNLOAD_URL?.trim() || "https://yueyantech.com"
      : "https://play.google.com/store/apps/details?id=com.yueyantech.oio";

  return {
    platform,
    enabled: Boolean(latestVersion),
    latestVersion,
    storeUrl,
  };
}

function appDistribution(value: string | undefined): AppDistribution {
  return value === "china" || value === "google" ? value : null;
}
