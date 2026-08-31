import { createSign, createVerify } from "node:crypto";

export type AlipayFormFields = Record<string, string>;

export function buildAlipaySignContent(fields: AlipayFormFields): string {
  return Object.entries(fields)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    // Alipay requires byte-wise dictionary order; localeCompare is locale-dependent.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function signAlipayFields(fields: AlipayFormFields, privateKey: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(buildAlipaySignContent(fields), "utf8");
  signer.end();
  return signer.sign(normalizePem(privateKey, "PRIVATE KEY"), "base64");
}

export function verifyAlipayFields(fields: AlipayFormFields, publicKey: string): boolean {
  if (!fields.sign) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(buildAlipaySignContent(fields), "utf8");
  verifier.end();
  return verifier.verify(normalizePem(publicKey, "PUBLIC KEY"), fields.sign, "base64");
}

export function verifyAlipayResponseContent(content: string, signature: string, publicKey: string): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(content, "utf8");
  verifier.end();
  return verifier.verify(normalizePem(publicKey, "PUBLIC KEY"), signature, "base64");
}

function normalizePem(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const decoded = value.replace(/\\n/g, "\n").trim();
  if (decoded.includes("-----BEGIN")) return decoded;
  const compact = decoded.replace(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g)?.join("\n") ?? compact;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}
