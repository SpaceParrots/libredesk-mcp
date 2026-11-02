/**
 * @module errors
 * Typed error hierarchy. Every error carries a machine-readable `code` and an optional `hint`
 * telling the user what to do next. This module is a leaf: it imports nothing from the package.
 */

/** Options accepted by every {@link LibreDeskError} constructor. */
export interface LibreDeskErrorOptions {
  /** Machine-readable error category. Subclasses with a fixed code ignore it. */
  readonly code?: string;
  /** Suggestion of what to do next. */
  readonly hint?: string;
  /** The original error. */
  readonly cause?: unknown;
}

/** Base class for all errors raised by this package. */
export class LibreDeskError extends Error {
  /** Machine-readable error category. */
  readonly code: string;
  /** Actionable next step shown below the message. */
  readonly hint?: string;

  constructor(message: string, options: LibreDeskErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? "UNKNOWN";
    this.hint = options.hint;
  }
}

/** Options for errors with a fixed code. */
export type FixedCodeOptions = Omit<LibreDeskErrorOptions, "code">;

/** The config file is unreadable, invalid or cannot be written. */
export class ConfigError extends LibreDeskError {
  constructor(message: string, options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "CONFIG" });
  }
}

/** No profile could be resolved at all. */
export class NoProfileError extends LibreDeskError {
  constructor(message: string, options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "NO_PROFILE" });
  }
}

/** A named profile does not exist. */
export class ProfileNotFoundError extends LibreDeskError {
  constructor(message: string, options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "PROFILE_NOT_FOUND" });
  }
}

/** The server could not be reached at the transport level (DNS, TCP, TLS, timeout). */
export class NetworkError extends LibreDeskError {
  constructor(message: string, options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "NETWORK" });
  }
}

/** Options for {@link ApiError} and its subclasses. */
export interface ApiErrorOptions extends FixedCodeOptions {
  /** HTTP status code. */
  readonly status: number;
  /** The `error_type` field of the LibreDesk error body, when present. */
  readonly errorType?: string;
  /** The `data` field of the LibreDesk error body, when present. */
  readonly data?: unknown;
}

/** The server answered with an error status. */
export class ApiError extends LibreDeskError {
  /** HTTP status code. */
  readonly status: number;
  /** LibreDesk `error_type`, when present. */
  readonly errorType?: string;
  /** LibreDesk error `data`, when present. */
  readonly data?: unknown;

  constructor(message: string, options: ApiErrorOptions, code = "API") {
    super(message, { hint: options.hint, cause: options.cause, code });
    this.status = options.status;
    this.errorType = options.errorType;
    this.data = options.data;
  }
}

/** HTTP 401: credentials missing or wrong. */
export class AuthError extends ApiError {
  constructor(message: string, options: ApiErrorOptions) {
    super(message, options, "AUTH");
  }
}

/** Options for {@link PermissionError}. */
export interface PermissionErrorOptions extends ApiErrorOptions {
  /** The permission the server says is missing. */
  readonly permission?: string;
}

/** HTTP 403: the user lacks a permission. */
export class PermissionError extends ApiError {
  /** The missing permission, when known. */
  readonly permission?: string;

  constructor(message: string, options: PermissionErrorOptions) {
    super(message, options, "PERMISSION");
    this.permission = options.permission;
  }
}

/** HTTP 404: the resource does not exist. */
export class NotFoundError extends ApiError {
  constructor(message: string, options: ApiErrorOptions) {
    super(message, options, "NOT_FOUND");
  }
}

/** Options for {@link InputError}. */
export interface InputErrorOptions extends FixedCodeOptions {
  /** Names of the missing or invalid fields. */
  readonly fields?: readonly string[];
}

/** The caller's input is missing or invalid. */
export class InputError extends LibreDeskError {
  /** Names of the missing or invalid fields. */
  readonly fields: readonly string[];

  constructor(message: string, options: InputErrorOptions = {}) {
    super(message, { hint: options.hint, cause: options.cause, code: "INPUT" });
    this.fields = options.fields ?? [];
  }
}

/** An operation needs confirmation that was not given. */
export class ConfirmationRequiredError extends LibreDeskError {
  constructor(message: string, options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "CONFIRMATION_REQUIRED" });
  }
}

/** The user cancelled an interactive prompt. */
export class CancelledError extends LibreDeskError {
  constructor(message = "Cancelled.", options: FixedCodeOptions = {}) {
    super(message, { ...options, code: "CANCELLED" });
  }
}

const NETWORK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"]);

function errnoCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  return cause === undefined ? undefined : errnoCode(cause);
}

/** Convert any thrown value into a {@link LibreDeskError}. */
export function toLibreDeskError(err: unknown): LibreDeskError {
  if (err instanceof LibreDeskError) return err;
  const code = errnoCode(err);
  if (err instanceof Error) {
    if (code !== undefined && NETWORK_CODES.has(code)) {
      return new NetworkError(err.message, {
        hint: "Check the LibreDesk URL and that the server is reachable.",
        cause: err,
      });
    }
    return new LibreDeskError(err.message, { code: "UNKNOWN", cause: err });
  }
  return new LibreDeskError(typeof err === "string" ? err : String(err), { code: "UNKNOWN", cause: err });
}
