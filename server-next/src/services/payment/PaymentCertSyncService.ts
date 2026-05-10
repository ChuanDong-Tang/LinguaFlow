import type { TrustedCertRepository } from "@lf/core/ports/repository/TrustedCertRepository.js";
import { createAuthorizationHeader, decryptWeChatPayResource } from "../../providers/payment/wechat/WeChatPaySignature.js";
import { loadWeChatPayConfig } from "../../providers/payment/wechat/WeChatPayConfig.js";
import { isAppleIapConfigured, loadAppleIapConfig } from "../../providers/payment/apple/AppleIapConfig.js";
import { createHash } from "node:crypto";

type WeChatCertResponse = {
  data?: Array<{
    serial_no?: string;
    effective_time?: string;
    expire_time?: string;
    encrypt_certificate?: {
      associated_data?: string;
      nonce?: string;
      ciphertext?: string;
    };
  }>;
};

export class PaymentCertSyncService {
  constructor(private readonly trustedCertRepository: TrustedCertRepository) {}

  async syncWeChatPlatformCerts(): Promise<number> {
    const config = loadWeChatPayConfig();
    const path = "/v3/certificates";
    const auth = createAuthorizationHeader({
      method: "GET",
      urlPathWithQuery: path,
      body: "",
      mchId: config.mchId,
      merchantSerialNo: config.merchantSerialNo,
      privateKey: config.merchantPrivateKey,
    });
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: auth,
        "User-Agent": "LinguaFlow/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`WECHAT_CERT_SYNC_FAILED: HTTP ${res.status}`);
    }
    const json = (await res.json()) as WeChatCertResponse;
    const items = json.data ?? [];
    let count = 0;
    const now = new Date();
    for (const item of items) {
      const serial = String(item.serial_no ?? "").trim();
      const enc = item.encrypt_certificate;
      if (!serial || !enc?.nonce || !enc?.ciphertext) continue;
      const pem = decryptWeChatPayResource({
        associatedData: enc.associated_data,
        nonce: enc.nonce,
        ciphertext: enc.ciphertext,
        apiV3Key: config.apiV3Key,
      });
      await this.trustedCertRepository.upsert({
        provider: "wechat",
        keyId: serial,
        materialType: "platform_public_key",
        pem,
        fingerprint: sha256(pem),
        notBefore: item.effective_time ? new Date(item.effective_time) : null,
        notAfter: item.expire_time ? new Date(item.expire_time) : null,
        status: "active",
        metadata: { source: "wechat_v3_certificates" },
        lastSyncedAt: now,
      });
      count += 1;
    }
    return count;
  }

  async syncAppleRootCert(): Promise<boolean> {
    if (!isAppleIapConfigured()) return false;
    const config = loadAppleIapConfig();
    await this.trustedCertRepository.upsert({
      provider: "apple",
      keyId: "apple_root_ca",
      materialType: "root_ca",
      pem: config.rootCaPem,
      fingerprint: sha256(config.rootCaPem),
      status: "active",
      metadata: { bundleId: config.bundleId, source: "runtime_config" },
      lastSyncedAt: new Date(),
    });
    return true;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
