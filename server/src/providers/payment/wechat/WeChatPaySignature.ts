/** WeChatPaySignature：处理微信支付请求签名与回调验签。 */

import { createDecipheriv, createSign, createVerify, randomBytes } from "node:crypto";

export function createNonceStr(): string {
  return randomBytes(16).toString("hex");
}

export function createTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export function signWithRsaSha256(message: string, privateKey: string): string {
  return createSign("RSA-SHA256").update(message).sign(privateKey, "base64");
}

export function createAuthorizationHeader(input: {
  method: string;
  urlPathWithQuery: string;
  body: string;
  mchId: string;
  merchantSerialNo: string;
  privateKey: string;
}): string {
  const nonceStr = createNonceStr();
  const timestamp = createTimestamp();
  const message = [
    input.method.toUpperCase(),
    input.urlPathWithQuery,
    timestamp,
    nonceStr,
    input.body,
  ].join("\n") + "\n";
  const signature = signWithRsaSha256(message, input.privateKey);

  return [
    'WECHATPAY2-SHA256-RSA2048',
    `mchid="${input.mchId}"`,
    `nonce_str="${nonceStr}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${input.merchantSerialNo}"`,
  ].join(",");
}

export function createAppPaySign(input: {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  prepayId: string;
  privateKey: string;
}): string {
  const message = [
    input.appId,
    input.timeStamp,
    input.nonceStr,
    input.prepayId,
  ].join("\n") + "\n";

  return signWithRsaSha256(message, input.privateKey);
}

export function verifyWeChatPaySignature(input: {
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
  platformPublicKey: string;
}): boolean {
  const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`;
  return createVerify("RSA-SHA256")
    .update(message)
    .verify(input.platformPublicKey, input.signature, "base64");
}

export function decryptWeChatPayResource(input: {
  associatedData?: string;
  nonce: string;
  ciphertext: string;
  apiV3Key: string;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(input.apiV3Key, "utf8"),
    Buffer.from(input.nonce, "utf8")
  );

  if (input.associatedData) {
    decipher.setAAD(Buffer.from(input.associatedData, "utf8"));
  }

  const ciphertext = Buffer.from(input.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
