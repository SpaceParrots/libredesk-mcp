/**
 * @module ops/merge
 * Read-modify-write helper for LibreDesk PUT endpoints, which replace the whole record: a field
 * missing from the request body is reset, so updates send the current value for every field the
 * caller did not change.
 */

import { BASE_URL_HINT } from "../constants.js";
import { ApiError } from "../errors.js";
import { isRecord } from "../guards.js";

/** Return `value` when it is a plain object, else throw an error that points at the base URL. */
export function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError(`Expected ${what} to be an object.`, { status: 200, hint: BASE_URL_HINT });
  return value;
}

/** Return `value` when it is an array, else throw an error that points at the base URL. */
export function requireList(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ApiError(`Expected ${what} to be a list.`, { status: 200, hint: BASE_URL_HINT });
  return value;
}

/**
 * Build an update body from the `allowed` keys: `changes[k]` when it is not `undefined`, else
 * `current[k]`. Keys whose value is `undefined` in both are left out. Neither argument is modified.
 */
export function mergeForUpdate<T extends Record<string, unknown>>(
  current: T,
  changes: Record<string, unknown>,
  allowed: readonly (keyof T & string)[],
): Partial<T> {
  requireRecord(current, "the current record");
  const entries = allowed
    .map((key) => [key, changes[key] !== undefined ? changes[key] : current[key]] as const)
    .filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}
