/**
 * @module ops/bulk
 * Operations that take one id or a list of ids. A single id returns the plain result; a list runs
 * one id after the other and returns an ok or error entry per id, so one failure does not stop
 * the rest.
 */

import { z } from "zod";
import { toLibreDeskError } from "../errors.js";

/** Most ids one call takes, so a mistaken list cannot run for minutes. */
export const MAX_BULK_IDS = 100;

/** An `id` field that also takes a list, such as `42` or `[42, 43]`. */
export function idOrIds(description: string): z.ZodUnion<readonly [z.ZodNumber, z.ZodArray<z.ZodNumber>]> {
  const id = z.number().int().positive();
  return z.union([id, z.array(id).min(1).max(MAX_BULK_IDS)]).describe(description);
}

/** The result of one id in a list. */
export type BulkEntry = { readonly id: number; readonly ok: true; readonly result: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

/** The result of a list of ids. */
export interface BulkResult {
  readonly ok: number;
  readonly failed: number;
  readonly results: readonly BulkEntry[];
}

/**
 * Run `fn` for one id, returning its result, or for each id of a list in order, returning a
 * {@link BulkResult}. Errors of a single id are thrown as usual; in a list they become entries.
 */
export async function forIds(ids: number | readonly number[], fn: (id: number) => Promise<unknown>): Promise<unknown> {
  if (typeof ids === "number") return fn(ids);
  const results: BulkEntry[] = [];
  for (const id of new Set(ids)) {
    try {
      results.push({ id, ok: true, result: await fn(id) });
    } catch (error) {
      results.push({ id, ok: false, error: toLibreDeskError(error).message });
    }
  }
  const ok = results.filter((entry) => entry.ok).length;
  return { ok, failed: results.length - ok, results };
}
