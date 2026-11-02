/**
 * @module http
 * Authenticated HTTP client for the LibreDesk API. Unwraps the success envelope and maps
 * failures to typed errors with secrets redacted from every message and hint.
 */

import type { Profile } from "./config.js";
import { HTTP_TIMEOUT_MS } from "./constants.js";
import { ApiError, AuthError, NetworkError, NotFoundError, PermissionError } from "./errors.js";
import { isRecord } from "./guards.js";
import { redactText } from "./mask.js";

/** HTTP methods used by the LibreDesk API. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A query string value; `undefined` values are skipped. */
export type QueryValue = string | number | boolean | undefined;

/** Options for {@link request}. */
export interface RequestOptions {
  /** Query parameters. */
  readonly query?: Readonly<Record<string, QueryValue>>;
  /** JSON request body. */
  readonly body?: unknown;
  /** Replacement for the global `fetch`, used by tests. */
  readonly fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. Defaults to `HTTP_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

const BODY_SNIPPET_LENGTH = 200;

/** Join a base URL (which may carry a path prefix), a path and query parameters into one URL. */
export function buildUrl(baseUrl: string, path: string, query?: Readonly<Record<string, QueryValue>>): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.append(key, String(value));
  }
  const qs = params.toString();
  return `${base}${suffix}${qs ? `?${qs}` : ""}`;
}

/** The `Authorization` header value for a profile: `token <apiKey>:<apiSecret>`. */
export function authHeader(profile: Profile): string {
  return `token ${profile.apiKey}:${profile.apiSecret}`;
}

function isJsonContent(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorMessage(response: Response, parsed: unknown, text: string): string {
  if (isRecord(parsed) && typeof parsed.message === "string" && parsed.message !== "") return parsed.message;
  const base = `HTTP ${response.status} ${response.statusText}`.trim();
  const snippet = parsed === undefined ? text.trim().slice(0, BODY_SNIPPET_LENGTH) : "";
  return snippet ? `${base}: ${snippet}` : base;
}

function toApiError(response: Response, parsed: unknown, text: string, redact: (s: string) => string): ApiError {
  const body = isRecord(parsed) ? parsed : {};
  const options = {
    status: response.status,
    errorType: typeof body.error_type === "string" ? body.error_type : undefined,
    data: body.data,
  };
  const message = redact(errorMessage(response, parsed, text));
  switch (response.status) {
    case 401:
      return new AuthError(message, {
        ...options,
        hint: "The API key or secret is wrong or revoked. Run `ldesk login` (or fix the LIBREDESK_* env vars).",
      });
    case 403:
      return new PermissionError(message, {
        ...options,
        hint: "The agent's role lacks the permission this endpoint needs.",
      });
    case 404:
      return new NotFoundError(message, options);
    default:
      return new ApiError(message, options);
  }
}

/** Send one request to the LibreDesk API and return the unwrapped `data` (or the raw body when not enveloped). */
export async function request<T = unknown>(
  profile: Profile,
  method: HttpMethod,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const redact = (text: string): string => redactText(text, [authHeader(profile), profile.apiSecret]);
  const url = buildUrl(profile.url, path, opts.query);
  const headers: Record<string, string> = { Authorization: authHeader(profile), Accept: "application/json" };
  const hasBody = opts.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const doFetch = opts.fetchImpl ?? fetch;

  let response: Response;
  let text: string;
  try {
    response = await doFetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? HTTP_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NetworkError(redact(`${method} ${url} failed: ${reason}`), {
      hint: "Check the LibreDesk URL and that the server is reachable.",
      cause: error,
    });
  }

  const parsed = isJsonContent(response) || text.trimStart().startsWith("{") ? parseJson(text) : undefined;
  if (!response.ok) throw toApiError(response, parsed, text, redact);
  if (parsed === undefined) return text as T;
  if (isRecord(parsed) && parsed.status === "success" && "data" in parsed) return parsed.data as T;
  return parsed as T;
}
