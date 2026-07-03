import { createHash, createHmac } from "node:crypto";

export type TencentTmsSuggestion = "Pass" | "Review" | "Block" | string;

export interface TencentTmsModerationResult {
  requestId: string;
  suggestion: TencentTmsSuggestion;
  label: string;
  subLabel: string;
  score: number;
  keywords: string[];
  detailResults?: unknown;
}

export interface TencentTmsClientOptions {
  secretId: string;
  secretKey: string;
  region: string;
  bizType?: string | null;
  timeoutMs: number;
}

type TencentTmsApiResponse = {
  Response?: {
    RequestId?: string;
    Suggestion?: string;
    Label?: string;
    SubLabel?: string;
    Score?: number;
    Keywords?: string[] | null;
    DetailResults?: unknown;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
};

const TENCENT_TMS_ENDPOINT = "https://tms.tencentcloudapi.com";
const TENCENT_TMS_HOST = "tms.tencentcloudapi.com";
const TENCENT_TMS_SERVICE = "tms";
const TENCENT_TMS_ACTION = "TextModeration";
const TENCENT_TMS_VERSION = "2020-12-29";

export class TencentTmsClient {
  constructor(private readonly options: TencentTmsClientOptions) {}

  async moderateText(input: {
    text: string;
    dataId: string;
    userId?: string | null;
    sessionId?: string | null;
  }): Promise<TencentTmsModerationResult> {
    const payload = JSON.stringify({
      Content: Buffer.from(input.text, "utf8").toString("base64"),
      Type: "TEXT",
      SourceLanguage: "zh",
      DataId: sanitizeTencentDataId(input.dataId),
      ...(this.options.bizType ? { BizType: this.options.bizType } : {}),
      ...(input.sessionId ? { SessionId: sanitizeTencentDataId(input.sessionId) } : {}),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = buildAuthorizationHeader({
      secretId: this.options.secretId,
      secretKey: this.options.secretKey,
      timestamp,
      payload,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(TENCENT_TMS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json; charset=utf-8",
          Host: TENCENT_TMS_HOST,
          "X-TC-Action": TENCENT_TMS_ACTION,
          "X-TC-Version": TENCENT_TMS_VERSION,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Region": this.options.region,
        },
        body: payload,
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as TencentTmsApiResponse;
      const body = data.Response ?? {};

      if (!response.ok || body.Error) {
        const error = new Error(body.Error?.Message || `Tencent TMS HTTP ${response.status}`) as Error & {
          code?: string;
          requestId?: string;
        };
        error.code = body.Error?.Code || "TENCENT_TMS_ERROR";
        error.requestId = body.RequestId;
        throw error;
      }

      return {
        requestId: body.RequestId ?? "",
        suggestion: body.Suggestion ?? "Pass",
        label: body.Label ?? "Normal",
        subLabel: body.SubLabel ?? "",
        score: Number(body.Score ?? 0),
        keywords: Array.isArray(body.Keywords) ? body.Keywords : [],
        detailResults: body.DetailResults,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildAuthorizationHeader(input: {
  secretId: string;
  secretKey: string;
  timestamp: number;
  payload: string;
}): string {
  const algorithm = "TC3-HMAC-SHA256";
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_TMS_HOST}\n`;
  const signedHeaders = "content-type;host";
  const hashedRequestPayload = sha256Hex(input.payload);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_TMS_SERVICE}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(input.timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(Buffer.from(`TC3${input.secretKey}`, "utf8"), date);
  const secretService = hmacSha256(secretDate, TENCENT_TMS_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");

  return `${algorithm} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sanitizeTencentDataId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_@#-]/g, "_");
  return normalized.slice(0, 64) || `lf_${Date.now()}`;
}
