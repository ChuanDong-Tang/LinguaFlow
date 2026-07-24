type CosClient = {
  getAuth(input: Record<string, unknown>): string;
  putObject(input: Record<string, unknown>, callback: (error: unknown) => void): void;
  getObject(input: Record<string, unknown>, callback: (error: unknown, data: { Body?: Buffer }) => void): void;
  getObjectUrl(input: Record<string, unknown>, callback: (error: unknown, data: { Url?: string }) => void): void;
  deleteObject(input: Record<string, unknown>, callback: (error: unknown) => void): void;
};
type CosConstructor = new (options: { SecretId: string; SecretKey: string }) => CosClient;

export class CardImageStorageProvider {
  private clientPromise: Promise<CosClient> | null = null;
  private readonly secretId = process.env.TENCENT_COS_SECRET_ID ?? process.env.COS_SECRET_ID ?? "";
  private readonly secretKey = process.env.TENCENT_COS_SECRET_KEY ?? process.env.COS_SECRET_KEY ?? "";
  private readonly bucket = process.env.TENCENT_COS_BUCKET ?? process.env.COS_BUCKET ?? "";
  private readonly region = process.env.TENCENT_COS_REGION ?? process.env.COS_REGION ?? "";

  async createUploadAuthorization(key: string, expiresSeconds = 900): Promise<{
    uploadUrl: string;
    headers: Record<string, string>;
    expiresAt: Date;
  }> {
    const client = await this.client();
    const authorization = client.getAuth({
      Method: "PUT",
      Key: key,
      Expires: expiresSeconds,
    });
    return {
      uploadUrl: `https://${this.bucket}.cos.${this.region}.myqcloud.com/${encodeKey(key)}`,
      headers: { Authorization: authorization },
      expiresAt: new Date(Date.now() + expiresSeconds * 1_000),
    };
  }

  async download(key: string): Promise<Buffer> {
    const client = await this.client();
    return new Promise((resolve, reject) => client.getObject(
      { Bucket: this.bucket, Region: this.region, Key: key },
      (error, data) => error ? reject(error) : resolve(Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body ?? "")),
    ));
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = await this.client();
    await new Promise<void>((resolve, reject) => client.putObject(
      { Bucket: this.bucket, Region: this.region, Key: key, Body: body, ContentType: contentType },
      (error) => error ? reject(error) : resolve(),
    ));
  }

  async getSignedUrl(key: string, expiresSeconds = 900): Promise<{ url: string; expiresAt: Date }> {
    const client = await this.client();
    const url = await new Promise<string>((resolve, reject) => client.getObjectUrl(
      { Bucket: this.bucket, Region: this.region, Key: key, Sign: true, Expires: expiresSeconds },
      (error, data) => error ? reject(error) : resolve(data.Url ?? ""),
    ));
    if (!url) throw new Error("COS_SIGNED_URL_EMPTY");
    return { url, expiresAt: new Date(Date.now() + expiresSeconds * 1_000) };
  }

  async delete(key: string): Promise<void> {
    const client = await this.client();
    await new Promise<void>((resolve, reject) => client.deleteObject(
      { Bucket: this.bucket, Region: this.region, Key: key },
      (error) => error ? reject(error) : resolve(),
    ));
  }

  private async client(): Promise<CosClient> {
    if (!this.secretId || !this.secretKey || !this.bucket || !this.region) throw new Error("COS_IMAGE_STORAGE_NOT_CONFIGURED");
    this.clientPromise ??= import("cos-nodejs-sdk-v5").then((module) => {
      const COS = (module.default ?? module) as unknown as CosConstructor;
      return new COS({ SecretId: this.secretId, SecretKey: this.secretKey });
    });
    return this.clientPromise;
  }
}

function encodeKey(key: string): string { return key.split("/").map(encodeURIComponent).join("/"); }
