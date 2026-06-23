import type {
  GetTtsObjectUrlResult,
  TtsStorageProvider,
  UploadTtsObjectInput,
  UploadTtsObjectResult,
} from "../../services/tts/TtsStorageProvider.js";

type CosClient = {
  putObject(input: Record<string, unknown>, callback: (error: unknown) => void): void;
  getObjectUrl(input: Record<string, unknown>, callback: (error: unknown, data: { Url?: string }) => void): void;
  deleteObject(input: Record<string, unknown>, callback: (error: unknown) => void): void;
};
type CosConstructor = new (options: { SecretId: string; SecretKey: string }) => CosClient;

export class CosStorageProvider implements TtsStorageProvider {
  private cos: CosClient | null = null;
  private cosPromise: Promise<CosClient | null> | null = null;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl: string | null;
  private readonly signedUrlExpiresSeconds: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.secretId = env.TENCENT_COS_SECRET_ID ?? env.COS_SECRET_ID ?? "";
    this.secretKey = env.TENCENT_COS_SECRET_KEY ?? env.COS_SECRET_KEY ?? "";
    this.bucket = env.TENCENT_COS_BUCKET ?? env.COS_BUCKET ?? "";
    this.region = env.TENCENT_COS_REGION ?? env.COS_REGION ?? "";
    this.publicBaseUrl = normalizeBaseUrl(env.TENCENT_COS_PUBLIC_BASE_URL ?? env.COS_PUBLIC_BASE_URL ?? null);
    this.signedUrlExpiresSeconds = readPositiveInt(env.TTS_SIGNED_URL_EXPIRES_SECONDS, 3600);
  }

  async upload(input: UploadTtsObjectInput): Promise<UploadTtsObjectResult> {
    const cos = await this.ensureConfigured();
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
    const cos = await this.ensureConfigured();
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
    const cos = await this.ensureConfigured();
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

  private async ensureConfigured(): Promise<CosClient> {
    const cos = await this.getCosClient();
    if (!cos || !this.bucket || !this.region) {
      throw new Error("COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET and COS_REGION are required");
    }
    return cos;
  }

  private async getCosClient(): Promise<CosClient | null> {
    if (this.cos) return this.cos;
    if (!this.secretId || !this.secretKey || !this.bucket || !this.region) return null;
    this.cosPromise ??= loadCosModule().then(({ default: COS }) => {
      this.cos = new COS({
        SecretId: this.secretId,
        SecretKey: this.secretKey,
      });
      return this.cos;
    });
    return this.cosPromise;
  }
}

async function loadCosModule(): Promise<{ default: CosConstructor }> {
  try {
    const module = await import("cos-nodejs-sdk-v5") as unknown as { default?: CosConstructor } & CosConstructor;
    return { default: module.default ?? module };
  } catch (error) {
    throw new Error(
      `cos-nodejs-sdk-v5 is required for COS storage: ${error instanceof Error ? error.message : String(error)}`
    );
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
