import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const PORT = Number.parseInt(process.env.PORT ?? "3200", 10);
const ROOT = process.cwd();
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3101").replace(/\/$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const requestBody = req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await readRequestBody(req);
      const response = await fetch(`${API_PROXY_TARGET}${url.pathname.slice(4)}${url.search}`, {
        method: req.method,
        headers: {
          ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers["x-request-id"] ? { "x-request-id": req.headers["x-request-id"] } : {}),
        },
        body: requestBody,
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        ...(response.headers.get("x-request-id") ? { "x-request-id": response.headers.get("x-request-id") } : {}),
      });
      res.end(body);
      return;
    }
    const relativePath = url.pathname.endsWith("/")
      ? `${url.pathname}index.html`
      : url.pathname;
    const filePath = join(ROOT, relativePath.replace(/^\/+/, ""));
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`[website] page running at http://localhost:${PORT}`);
  console.log(`[website] /api proxying to ${API_PROXY_TARGET}`);
});
