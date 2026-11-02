/**
 * @module tests/live/helpers
 * Shared helpers for live tests against a local LibreDesk. Credentials come from the
 * LIBREDESK_* environment variables only; without them the live suites skip.
 */

import { describe } from "vitest";
import type { Profile } from "../../src/config.js";

/** The profile described by `LIBREDESK_URL`, `LIBREDESK_API_KEY` and `LIBREDESK_API_SECRET`, or `undefined` when any is missing. */
export function liveProfile(): Profile | undefined {
  const url = process.env.LIBREDESK_URL;
  const apiKey = process.env.LIBREDESK_API_KEY;
  const apiSecret = process.env.LIBREDESK_API_SECRET;
  if (!url || !apiKey || !apiSecret) return undefined;
  return { name: "live", url, apiKey, apiSecret };
}

/** `describe` that skips when no live profile is configured. */
export const describeLive = describe.skipIf(!liveProfile());

/** False when `LIBREDESK_LIVE_SCOPE=readonly`: live tests must then not create, change or delete anything. */
export function writesAllowed(): boolean {
  return process.env.LIBREDESK_LIVE_SCOPE !== "readonly";
}

/** A unique, recognisable name for test records: `ldesk-live-<prefix>-<timestamp>`. */
export function uniqueName(prefix: string): string {
  return `ldesk-live-${prefix}-${Date.now()}`;
}
