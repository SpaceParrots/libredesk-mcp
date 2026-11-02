/**
 * @module ops/merge
 * Read-modify-write helper for LibreDesk PUT endpoints, which replace the whole record: a field
 * missing from the request body is reset, so updates send the current value for every field the
 * caller did not change.
 */

/**
 * Build an update body from the `allowed` keys: `changes[k]` when it is not `undefined`, else
 * `current[k]`. Keys whose value is `undefined` in both are left out. Neither argument is modified.
 */
export function mergeForUpdate<T extends Record<string, unknown>>(
  current: T,
  changes: Record<string, unknown>,
  allowed: readonly (keyof T & string)[],
): Partial<T> {
  const entries = allowed
    .map((key) => [key, changes[key] !== undefined ? changes[key] : current[key]] as const)
    .filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}
