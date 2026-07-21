import { createHash, createHmac } from "node:crypto";

export type TencentImsResult = {
  requestId: string;
  suggestion: string;
  label: string;
  subLabel: string;
  score: number;
};

export class TencentImsClient {
  constructor(private readonly options: {
    secretId: string;
    secretKey: string;
    region: string;
    bizType?: string | null;
    timeoutMs: number;
  }) {}

  async moderateImage(input: { fileUrl: string; dataId: string }): Promise<TencentImsResult> {
    const payload = JSON.stringify({
      FileUrl: input.fileUrl,
      DataId: input.dataId.replace(/[^A-Za-z0-9_@#-]/g, "_").slice(0, 64),
      ...(this.options.bizType ? { BizType: this.options.bizType } : {}),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const host = "ims.tencentcloudapi.com";
    const authorization = authorizationHeader({
      secretId: this.options.secretId,
      secretKey: this.options.secretKey,
      timestamp,
      payload,
      host,
      service: "ims",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`https://${host}`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json; charset=utf-8",
          Host: host,
          "X-TC-Action": "ImageModeration",
          "X-TC-Version": "2020-12-29",
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Region": this.options.region,
        },
        body: payload,
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({})) as any;
      const body = json.Response ?? {};
      if (!response.ok || body.Error) {
        const error = new Error(body.Error?.Message ?? `Tencent IMS HTTP ${response.status}`) as Error & { code?: string };
        error.code = body.Error?.Code ?? "TENCENT_IMS_ERROR";
        throw error;
      }
      return {
        requestId: body.RequestId ?? "",
        suggestion: body.Suggestion ?? "Block",
        label: body.Label ?? "Unknown",
        subLabel: body.SubLabel ?? "",
        score: Number(body.Score ?? 0),
      };
    } finally { clearTimeout(timer); }
  }
}

function authorizationHeader(input: {
  secretId: string; secretKey: string; timestamp: number; payload: string; host: string; service: string;
}): string {
  const algorithm = "TC3-HMAC-SHA256";
  const date = new Date(input.timestamp * 1_000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${input.host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(input.payload)].join("\n");
  const scope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [algorithm, String(input.timestamp), scope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(Buffer.from(`TC3${input.secretKey}`), date);
  const secretService = hmac(secretDate, input.service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `${algorithm} Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hmac(key: Buffer, value: string): Buffer { return createHmac("sha256", key).update(value).digest(); }
