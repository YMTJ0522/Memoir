export type ErrorCode =
  | "invalid_path"
  | "unsupported_extension"
  | "not_found"
  | "conflict"
  | "io"
  | "serialization"
  | "unknown";

export type GatewayErrorPayload = {
  code: ErrorCode;
  message: string;
  details?: string;
};

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;

  constructor(payload: GatewayErrorPayload) {
    super(payload.message);
    this.name = "GatewayError";
    this.code = payload.code;
    this.details = payload.details;
  }
}

export function mapGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;

  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<GatewayErrorPayload>;
    const message =
      typeof candidate.message === "string" ? candidate.message : undefined;
    if (message !== undefined) {
      // Keep details even when `code` is missing (some hosts strip it), so
      // callers can still react to structured error details.
      return new GatewayError({
        code: typeof candidate.code === "string" ? (candidate.code as ErrorCode) : "unknown",
        message,
        details: typeof candidate.details === "string" ? candidate.details : undefined,
      });
    }
  }

  return new GatewayError({
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  });
}
