/**
 * Vercel-only serverless source entry.
 *
 * Vercel's function runtime does not reliably include local monorepo packages
 * outside the api-next root (for example @lf/core and @lf/server-next). The
 * vercel-build script bundles this file with esbuild into dist/serverless-bundle.cjs,
 * and api/serverless.js re-exports that bundle for Vercel to execute.
 *
 * Non-serverless deployments such as Tencent Cloud, PM2, Docker, Render, or
 * Railway should use src/server.ts instead.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app.js";

const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit("request", req, res);
}
