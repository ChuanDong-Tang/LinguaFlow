import { X509Certificate, createHash, createPrivateKey, createSign, createVerify } from "node:crypto";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";

const APPLE_PROD_BASE_URL = "https://api.storekit.itunes.apple.com";
const APPLE_SANDBOX_BASE_URL = "https://api.storekit-sandbox.itunes.apple.com";
const APPLE_PROVIDER = "apple_iap";

export class AppleIapConfigError extends Error {
  readonly code = "IAP_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
  }
}

export class AppleIapVerifyError extends Error {
  readonly code = "IAP_VERIFY_FAILED";

  constructor(message: string) {
    super(message);
  }
}

export interface VerifyAppleIapTransactionResult {
  environment: "production" | "sandbox";
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  sourceOrderId: string;
  alreadyApplied: boolean;
}

type AppleTransactionPayload = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
};

type AppleServerNotificationPayload = {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
  };
};

export class AppleIapService {
  constructor(
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly paymentEventRepository: PaymentEventRepository
  ) {}

  isConfigured(): boolean {
    const config = getRuntimeConfig();
    return Boolean(
      config.appleIapIssuerId &&
        config.appleIapKeyId &&
        config.appleIapBundleId &&
        config.appleIapPrivateKey &&
        config.appleIapRootCa &&
        config.appleIapProMonthlyProductId
    );
  }

  async verifyProMonthlyTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<VerifyAppleIapTransactionResult> {
    const config = getRuntimeConfig();
    const issuerId = requireConfig(config.appleIapIssuerId, "APPLE_IAP_ISSUER_ID");
    const keyId = requireConfig(config.appleIapKeyId, "APPLE_IAP_KEY_ID");
    const bundleId = requireConfig(config.appleIapBundleId, "APPLE_IAP_BUNDLE_ID");
    const privateKey = requireConfig(config.appleIapPrivateKey, "APPLE_IAP_PRIVATE_KEY");
    const rootCa = requireConfig(config.appleIapRootCa, "APPLE_IAP_ROOT_CA");
    const proProductId = requireConfig(
      config.appleIapProMonthlyProductId,
      "APPLE_IAP_PRO_MONTHLY_PRODUCT_ID"
    );

    const token = createAppleServerToken({
      issuerId,
      keyId,
      bundleId,
      privateKeyPem: normalizePem(privateKey),
    });

    const transaction = await this.fetchTransactionInfo(input.transactionId, token, normalizePem(rootCa));

    if (transaction.bundleId !== bundleId) {
      throw new AppleIapVerifyError("Bundle id mismatch");
    }

    if (transaction.productId !== proProductId) {
      throw new AppleIapVerifyError("Product id mismatch");
    }

    const originalTransactionId = transaction.originalTransactionId || transaction.transactionId;
    if (!originalTransactionId) {
      throw new AppleIapVerifyError("Missing originalTransactionId");
    }

    const sourceOrderId = `apple_iap:${originalTransactionId}`;
    const granted = await this.paymentEntitlementService.grantAfterPayment({
      userId: input.userId,
      sourceOrderId,
      productCode: "pro_monthly",
      channel: "ios_iap",
    });

    return {
      environment: transaction.environment,
      transactionId: transaction.transactionId,
      originalTransactionId,
      productId: transaction.productId,
      sourceOrderId,
      alreadyApplied: granted.alreadyApplied,
    };
  }

  async handleServerNotification(input: { signedPayload: string }): Promise<{
    status: "success" | "ignored";
    eventId: string;
    eventType: string;
  }> {
    const config = getRuntimeConfig();
    const bundleId = requireConfig(config.appleIapBundleId, "APPLE_IAP_BUNDLE_ID");
    const rootCa = requireConfig(config.appleIapRootCa, "APPLE_IAP_ROOT_CA");

    const signedPayload = input.signedPayload?.trim();
    if (!signedPayload) {
      throw new AppleIapVerifyError("signedPayload is required");
    }

    const decoded = verifyAndDecodeAppleJws(signedPayload, normalizePem(rootCa));
    const notification = decoded.payload as AppleServerNotificationPayload;
    const eventId = String(notification.notificationUUID ?? "").trim() || hashSignedPayload(signedPayload);
    const eventType = [
      String(notification.notificationType ?? "").trim() || "UNKNOWN",
      String(notification.subtype ?? "").trim(),
    ]
      .filter(Boolean)
      .join(".");

    const existing = await this.paymentEventRepository.findByProviderEventId({
      provider: APPLE_PROVIDER,
      providerEventId: eventId,
    });
    if (existing?.status === "processed" || existing?.status === "ignored") {
      return { status: "ignored", eventId, eventType };
    }

    const event =
      existing ??
      (await this.paymentEventRepository.create({
        provider: APPLE_PROVIDER,
        providerEventId: eventId,
        providerOrderId: null,
        eventType,
        rawPayload: {
          notification,
          header: decoded.header,
        },
      }));

    try {
      const signedTransactionInfo = notification.data?.signedTransactionInfo?.trim();
      if (signedTransactionInfo) {
        const txDecoded = verifyAndDecodeAppleJws(signedTransactionInfo, normalizePem(rootCa));
        const tx = decodeTransactionPayload(txDecoded.payload);
        if (tx.bundleId !== bundleId) {
          await this.paymentEventRepository.markIgnored(event.id, "Bundle id mismatch");
          return { status: "ignored", eventId, eventType };
        }
      }

      // V1 骨架：先做签名验证 + 幂等落库。
      // 续订/退款/撤销等自动权益同步在下一步按事件类型补全。
      await this.paymentEventRepository.markProcessed(event.id);
      return { status: "success", eventId, eventType };
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async fetchTransactionInfo(
    transactionId: string,
    token: string,
    rootCaPem: string
  ): Promise<
    { environment: "production" | "sandbox" } & AppleTransactionPayload
  > {
    const prod = await this.requestTransactionInfo(APPLE_PROD_BASE_URL, transactionId, token);
    if (prod.ok) {
      const verified = verifyAndDecodeAppleJws(prod.signedTransactionInfo, rootCaPem);
      return {
        environment: "production",
        ...decodeTransactionPayload(verified.payload),
      };
    }

    if (prod.status !== 404) {
      throw new AppleIapVerifyError(`Apple production verify failed: HTTP ${prod.status}`);
    }

    const sandbox = await this.requestTransactionInfo(
      APPLE_SANDBOX_BASE_URL,
      transactionId,
      token
    );
    if (!sandbox.ok) {
      throw new AppleIapVerifyError(`Apple sandbox verify failed: HTTP ${sandbox.status}`);
    }

    const verified = verifyAndDecodeAppleJws(sandbox.signedTransactionInfo, rootCaPem);
    return {
      environment: "sandbox",
      ...decodeTransactionPayload(verified.payload),
    };
  }

  private async requestTransactionInfo(
    baseUrl: string,
    transactionId: string,
    token: string
  ): Promise<
    | { ok: true; signedTransactionInfo: string }
    | { ok: false; status: number; message: string }
  > {
    const response = await fetch(
      `${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return { ok: false, status: response.status, message };
    }

    const payload = (await response.json()) as { signedTransactionInfo?: string };
    const signedTransactionInfo = payload.signedTransactionInfo?.trim();
    if (!signedTransactionInfo) {
      return { ok: false, status: 502, message: "Missing signedTransactionInfo" };
    }

    return { ok: true, signedTransactionInfo };
  }
}

function requireConfig(value: string | null, key: string): string {
  if (!value) throw new AppleIapConfigError(`${key} is required`);
  return value;
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function createAppleServerToken(input: {
  issuerId: string;
  keyId: string;
  bundleId: string;
  privateKeyPem: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    JSON.stringify({
      alg: "ES256",
      kid: input.keyId,
      typ: "JWT",
    })
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: input.issuerId,
      iat: now,
      exp: now + 60 * 5,
      aud: "appstoreconnect-v1",
      bid: input.bundleId,
    })
  );

  const unsigned = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(createPrivateKey(input.privateKeyPem)).toString("base64url");
  return `${unsigned}.${signature}`;
}

function decodeTransactionPayload(payload: Record<string, unknown>): AppleTransactionPayload {
  const transactionId = String(payload.transactionId ?? "").trim();
  const originalTransactionId = String(payload.originalTransactionId ?? "").trim();
  const bundleId = String(payload.bundleId ?? "").trim();
  const productId = String(payload.productId ?? "").trim();

  if (!transactionId || !bundleId || !productId) {
    throw new AppleIapVerifyError("Transaction payload missing required fields");
  }

  return {
    transactionId,
    originalTransactionId,
    bundleId,
    productId,
  };
}

function verifyAndDecodeAppleJws(
  signedPayload: string,
  rootCaPem: string
): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerB64, payloadB64, signatureB64] = signedPayload.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new AppleIapVerifyError("Invalid signed payload format");
  }

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

  const alg = String(header.alg ?? "");
  if (alg !== "ES256") {
    throw new AppleIapVerifyError(`Unsupported JWS algorithm: ${alg || "unknown"}`);
  }

  const chainRaw = header.x5c;
  if (!Array.isArray(chainRaw) || chainRaw.length < 2) {
    throw new AppleIapVerifyError("x5c certificate chain is required");
  }
  const [leafRaw, intermediateRaw] = chainRaw;
  if (typeof leafRaw !== "string" || typeof intermediateRaw !== "string") {
    throw new AppleIapVerifyError("Invalid x5c certificate chain");
  }

  const leafCert = new X509Certificate(Buffer.from(leafRaw, "base64"));
  const intermediateCert = new X509Certificate(Buffer.from(intermediateRaw, "base64"));
  const rootCert = new X509Certificate(rootCaPem);

  if (!leafCert.verify(intermediateCert.publicKey)) {
    throw new AppleIapVerifyError("Leaf certificate signature verification failed");
  }
  if (!intermediateCert.verify(rootCert.publicKey)) {
    throw new AppleIapVerifyError("Intermediate certificate signature verification failed");
  }

  const now = Date.now();
  if (!isCertValidNow(leafCert, now) || !isCertValidNow(intermediateCert, now) || !isCertValidNow(rootCert, now)) {
    throw new AppleIapVerifyError("Certificate is not valid at current time");
  }

  const verifier = createVerify("SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = Buffer.from(signatureB64, "base64url");
  const valid = verifier.verify(leafCert.publicKey, signature);
  if (!valid) {
    throw new AppleIapVerifyError("JWS signature verification failed");
  }

  return { header, payload };
}

function isCertValidNow(cert: X509Certificate, nowMs: number): boolean {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  return Number.isFinite(from) && Number.isFinite(to) && nowMs >= from && nowMs <= to;
}

function hashSignedPayload(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 48);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
