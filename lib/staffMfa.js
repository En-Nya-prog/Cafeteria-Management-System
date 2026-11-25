import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function staffMfaKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || "")) throw new Error("STAFF_MFA_KEY must be 64 hexadecimal characters.");
  return Buffer.from(value, "hex");
}

export function sealMfa(value, key, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

export function unsealMfa(value, key, purpose) {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString());
  } catch {
    return null;
  }
}

export function createMfaSecret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(20);
  const bits = [...bytes].map(byte => byte.toString(2).padStart(8, "0")).join("");
  return bits.match(/.{5}/g).map(group => alphabet[parseInt(group, 2)]).join("");
}

export function matchingMfaCounter(secret, code, now = Date.now()) {
  if (!/^[A-Z2-7]{32}$/.test(secret || "") || typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const time = Math.floor(now / 30000);
  for (const counter of [time, time - 1, time + 1]) {
    if (counter < 0) continue;
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", key).update(message).digest();
    const offset = digest.at(-1) & 15;
    const expected = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return counter;
  }
  return null;
}
