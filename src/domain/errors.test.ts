import { describe, expect, it } from "vitest";
import { GatewayError, mapGatewayError } from "./errors";

describe("mapGatewayError", () => {
  it("passes through GatewayError instances", () => {
    const original = new GatewayError({
      code: "io",
      message: "List remote folder failed.",
      details: "HTTP 503 (rate limited)",
    });
    expect(mapGatewayError(original)).toBe(original);
  });

  it("keeps details when code is missing but message exists", () => {
    const mapped = mapGatewayError({
      message: "The cloud service is temporarily rate-limited.",
      details: "HTTP 503 (rate limited)",
    });
    expect(mapped).toBeInstanceOf(GatewayError);
    expect(mapped.code).toBe("unknown");
    expect(mapped.message).toContain("rate-limited");
    expect(mapped.details).toBe("HTTP 503 (rate limited)");
  });

  it("maps a full payload with code and details", () => {
    const mapped = mapGatewayError({
      code: "not_found",
      message: "Remote folder was not found.",
      details: "HTTP 404",
    });
    expect(mapped.code).toBe("not_found");
    expect(mapped.details).toBe("HTTP 404");
  });

  it("falls back for plain errors", () => {
    const mapped = mapGatewayError(new Error("plain"));
    expect(mapped.code).toBe("unknown");
    expect(mapped.message).toBe("plain");
    expect(mapped.details).toBeUndefined();
  });

  it("falls back for non-objects", () => {
    expect(mapGatewayError("nope").message).toBe("nope");
    expect(mapGatewayError(undefined).message).toBe("undefined");
  });
});