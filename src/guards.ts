/**
 * @module guards
 * Small type guards shared across modules.
 */

/** True for non-null, non-array objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
