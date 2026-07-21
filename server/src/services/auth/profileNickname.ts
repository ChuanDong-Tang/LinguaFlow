import { randomBytes } from "node:crypto";

const DEFAULT_NICKNAME_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateDefaultProfileNickname(random = randomBytes): string {
  const bytes = random(6);
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix += DEFAULT_NICKNAME_ALPHABET[bytes[index]! % DEFAULT_NICKNAME_ALPHABET.length];
  }
  return `OIO-${suffix}`;
}
