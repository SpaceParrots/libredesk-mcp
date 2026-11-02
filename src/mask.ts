/**
 * @module mask
 * Secret masking for anything printed or returned: structured values and free text.
 */

import { isRecord } from "./guards.js";

/** Object keys whose values are secrets, matched case-insensitively. */
export const SECRET_KEYS: readonly string[] = [
  "api_key",
  "api_secret",
  "apiKey",
  "apiSecret",
  "secret",
  "client_secret",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
];

const MASK = "••••";
const SECRET_KEY_SET = new Set(SECRET_KEYS.map((key) => key.toLowerCase()));

/** Mask a secret value: keep the last 4 characters only when it has 8 or more. */
export function maskValue(value: string): string {
  return value.length >= 8 ? `${MASK}${value.slice(-4)}` : MASK;
}

function maskAny(value: unknown, forceMask: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => maskAny(item, forceMask));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const lower = key.toLowerCase();
      out[key] = maskAny(inner, forceMask || SECRET_KEY_SET.has(lower) || lower === "headers");
    }
    return out;
  }
  if (forceMask && value !== null && value !== undefined) {
    return typeof value === "string" ? maskValue(value) : MASK;
  }
  return value;
}

/**
 * Return a deep copy of `value` with secret values masked. Values under a secret key, and every value
 * inside a `headers` object, are masked. The input is never mutated.
 */
export function maskSecrets<T>(value: T): T {
  return maskAny(value, false) as T;
}

/** Replace every occurrence of each known secret in `text` with a mask. Empty secrets are ignored. */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(MASK);
  }
  return out;
}

/**
 * Return a deep copy of `value` with {@link redactText} applied to every string, keys included.
 * For data that should never hold a known secret but might echo one, such as a server response.
 */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  const walk = (inner: unknown): unknown => {
    if (typeof inner === "string") return redactText(inner, secrets);
    if (Array.isArray(inner)) return inner.map(walk);
    if (isRecord(inner)) return Object.fromEntries(Object.entries(inner).map(([key, item]) => [redactText(key, secrets), walk(item)]));
    return inner;
  };
  return walk(value) as T;
}
