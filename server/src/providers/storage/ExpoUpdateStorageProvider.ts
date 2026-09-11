type CosClient = {
  getObject(input: Record<string, unknown>, callback: (error: unknown, data: { Body?: Buffer | string }) => void): void;
};

type CosConstructor = new (options: { SecretId: string; SecretKey: string }) => CosClient;

export class ExpoUpdateStorageProvider {
  private clientPromise: Promise<CosClient> | null = null;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly bucket: string;
  private readonly region: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.secretId = env.LF_EXPO_UPDATES_COS_SECRET_ID ?? env.TENCENT_COS_SECRET_ID ?? env.COS_SECRET_ID ?? "";
    this.secretKey = env.LF_EXPO_UPDATES_COS_SECRET_KEY ?? env.TENCENT_COS_SECRET_KEY ?? env.COS_SECRET_KEY ?? "";
    this.bucket = env.LF_EXPO_UPDATES_COS_BUCKET ?? env.TENCENT_COS_BUCKET ?? env.COS_BUCKET ?? "";
    this.region = env.LF_EXPO_UPDATES_COS_REGION ?? env.TENCENT_COS_REGION ?? env.COS_REGION ?? "";
  }

  async download(key: string): Promise<Buffer> {
    const client = await this.client();
    return new Promise((resolve, reject) => client.getObject(
      { Bucket: this.bucket, Region: this.region, Key: key },
      (error, data) => error
        ? reject(error)
        : resolve(Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body ?? "")),
    ));
  }

  private async client(): Promise<CosClient> {
    if (!this.secretId || !this.secretKey || !this.bucket || !this.region) {
      throw new Error("COS_UPDATE_STORAGE_NOT_CONFIGURED");
    }
    this.clientPromise ??= import("cos-nodejs-sdk-v5").then((module) => {
      const COS = (module.default ?? module) as unknown as CosConstructor;
      return new COS({ SecretId: this.secretId, SecretKey: this.secretKey });
    });
    return this.clientPromise;
  }
}
