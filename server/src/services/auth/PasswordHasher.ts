import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/** scrypt password hashes, stored as "scrypt$N$r$p$saltBase64$hashBase64". */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SEPARATOR = "$";

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password is required");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ["scrypt", String(N), String(R), String(P), salt.toString("base64"), key.toString("base64")].join(SEPARATOR);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!password || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, n, r, p);
  return timingSafeEqual(actual, expected);
}
