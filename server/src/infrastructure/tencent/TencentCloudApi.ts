import { createHash, createHmac } from "node:crypto";

/** Minimal Tencent Cloud API 3.0 caller (TC3-HMAC-SHA256), no SDK dependency. */
export interface TencentCloudCredentials {
  secretId: string;
  secretKey: string;
}

export class TencentCloudApiError extends Error {
  constructor(readonly code: string, message: string, readonly requestId?: string) {
    super(message);
  }
}

export async function callTencentCloudApi<T = Record<string, unknown>>(input: {
  credentials: TencentCloudCredentials;
  service: string;
  host: string;
  action: string;
  version: string;
  region: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  now?: () => Date;
}): Promise<T & { RequestId?: string }> {
  const body = JSON.stringify(input.payload);
  const timestamp = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
  const authorization = buildTc3Authorization({
    ...input.credentials,
    service: input.service,
    host: input.host,
    timestamp,
    payload: body,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000);
  try {
    const response = await fetch(`https://${input.host}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: input.host,
        "X-TC-Action": input.action,
        "X-TC-Version": input.version,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Region": input.region,
      },
      body,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as { Response?: T & { RequestId?: string; Error?: { Code?: string; Message?: string } } };
    const result = data.Response;
    if (!response.ok || !result || result.Error) {
      throw new TencentCloudApiError(
        result?.Error?.Code ?? `HTTP_${response.status}`,
        result?.Error?.Message ?? `Tencent Cloud ${input.service} ${input.action} failed (${response.status})`,
        result?.RequestId,
      );
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export function buildTc3Authorization(input: {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  timestamp: number;
  payload: string;
}): string {
  const algorithm = "TC3-HMAC-SHA256";
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:application/json; charset=utf-8\nhost:${input.host}\n`,
    signedHeaders,
    sha256Hex(input.payload),
  ].join("\n");
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [algorithm, String(input.timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, input.service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `${algorithm} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
