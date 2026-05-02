import { createApp, disconnectApp } from "./app";

const app = createApp();

async function start() {
  try {
    const port = Number(process.env.PORT ?? process.env.LF_API_PORT ?? 3101);
    await app.listen({ host: "0.0.0.0", port });
    app.log.info(`api-next running at http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();

process.on("SIGINT", async () => {
  await disconnectApp();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await disconnectApp();
  process.exit(0);
});
