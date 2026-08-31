import type { TrustedCertRepository } from "@lf/core/ports/repository/TrustedCertRepository.js";
import { isAppleIapConfigured, loadAppleIapConfig } from "../../providers/payment/apple/AppleIapConfig.js";
import { createHash } from "node:crypto";

export class PaymentCertSyncService {
  constructor(private readonly trustedCertRepository: TrustedCertRepository) {}

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
