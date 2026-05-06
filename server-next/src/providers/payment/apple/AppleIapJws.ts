import { X509Certificate, createHash, createPrivateKey, createSign, createVerify } from "node:crypto";
import { AppleIapVerifyError } from "./AppleIapErrors.js";

export function createAppleServerToken(input: {
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

export function verifyAndDecodeAppleJws(
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
  if (
    !isCertValidNow(leafCert, now) ||
    !isCertValidNow(intermediateCert, now) ||
    !isCertValidNow(rootCert, now)
  ) {
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

export function hashSignedPayload(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 48);
}

function isCertValidNow(cert: X509Certificate, nowMs: number): boolean {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  return Number.isFinite(from) && Number.isFinite(to) && nowMs >= from && nowMs <= to;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
