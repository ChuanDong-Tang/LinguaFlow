import COS from "cos-nodejs-sdk-v5";
import type {
  GetTtsObjectUrlResult,
  TtsStorageProvider,
  UploadTtsObjectInput,
  UploadTtsObjectResult,
} from "../../services/tts/TtsStorageProvider.js";

export class CosStorageProvider implements TtsStorageProvider {
  private readonly cos: any | null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl: string | null;
  private readonly signedUrlExpiresSeconds: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const secretId = env.TENCENT_COS_SECRET_ID ?? env.COS_SECRET_ID ?? "";
    const secretKey = env.TENCENT_COS_SECRET_KEY ?? env.COS_SECRET_KEY ?? "";
    this.bucket = env.TENCENT_COS_BUCKET ?? env.COS_BUCKET ?? "";
    this.region = env.TENCENT_COS_REGION ?? env.COS_REGION ?? "";
    this.publicBaseUrl = normalizeBaseUrl(env.TENCENT_COS_PUBLIC_BASE_URL ?? env.COS_PUBLIC_BASE_URL ?? null);
    this.signedUrlExpiresSeconds = readPositiveInt(env.TTS_SIGNED_URL_EXPIRES_SECONDS, 3600);

    this.cos = secretId && secretKey && this.bucket && this.region
      ? new COS({
          SecretId: secretId,
          SecretKey: secretKey,
        })
      : null;
  }

  async upload(input: UploadTtsObjectInput): Promise<UploadTtsObjectResult> {
    const cos = this.ensureConfigured();
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        },
        (error: unknown) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    const url = await this.getObjectUrl(input.key);
    return {
      objectKey: input.key,
      objectUrl: url.objectUrl,
      objectUrlExpiresAt: url.objectUrlExpiresAt,
    };
  }

  async getObjectUrl(key: string): Promise<GetTtsObjectUrlResult> {
    const cos = this.ensureConfigured();
    if (this.publicBaseUrl) {
      return {
        objectUrl: `${this.publicBaseUrl}/${encodeObjectKey(key)}`,
        objectUrlExpiresAt: null,
      };
    }

    const objectUrl = await new Promise<string>((resolve, reject) => {
      cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Sign: true,
          Expires: this.signedUrlExpiresSeconds,
        },
        (error: unknown, data: { Url?: string }) => {
          if (error) reject(error);
          else resolve(data.Url ?? "");
        }
      );
    });

    return {
      objectUrl,
      objectUrlExpiresAt: new Date(Date.now() + this.signedUrlExpiresSeconds * 1000),
    };
  }

  async deleteObject(key: string): Promise<void> {
    const cos = this.ensureConfigured();
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
        },
        (error: unknown) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });
  }

  private ensureConfigured(): any {
    if (!this.cos || !this.bucket || !this.region) {
      throw new Error("COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET and COS_REGION are required");
    }
    return this.cos;
  }
}

function normalizeBaseUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
