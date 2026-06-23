export interface UploadTtsObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface UploadTtsObjectResult {
  objectKey: string;
  objectUrl: string | null;
  objectUrlExpiresAt: Date | null;
}

export interface GetTtsObjectUrlResult {
  objectUrl: string | null;
  objectUrlExpiresAt: Date | null;
}

export interface TtsStorageProvider {
  upload(input: UploadTtsObjectInput): Promise<UploadTtsObjectResult>;
  getObjectUrl(key: string): Promise<GetTtsObjectUrlResult>;
  deleteObject(key: string): Promise<void>;
}
