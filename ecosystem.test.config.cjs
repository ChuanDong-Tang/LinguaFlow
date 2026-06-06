const fs = require("fs");

function loadEnvFile(path) {
  const env = {};
  const raw = fs.readFileSync(path, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index < 0) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }

  return env;
}

const testEnv = {
  ...loadEnvFile("/opt/oio-test/.env"),
  NODE_ENV: "test",
  LF_MODE: "test",
};

module.exports = {
  apps: [
    {
      name: "oio-api-test",
      cwd: "/opt/oio-test",
      script: "npm",
      args: "--prefix api run start",
      env: testEnv,
    },
    {
      name: "oio-worker-test",
      cwd: "/opt/oio-test",
      script: "npm",
      args: ["run", "start:worker"],
      env: testEnv,
    }
  ],
};