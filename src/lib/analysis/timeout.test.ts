import { describe, expect, it } from "vitest";
import { DEFAULT_UPSTREAM_TIMEOUT_SECONDS, parseUpstreamTimeoutSeconds, workerTransportTimeoutMs } from "./timeout";

describe("analysis timeout configuration", () => {
  it("defaults to the shared 45-minute upstream budget and adds one minute for worker transport", () => {
    expect(parseUpstreamTimeoutSeconds(undefined)).toBe(DEFAULT_UPSTREAM_TIMEOUT_SECONDS);
    expect(workerTransportTimeoutMs(parseUpstreamTimeoutSeconds(undefined))).toBe(46 * 60 * 1000);
  });

  it.each(["", "  ", "45m", "59", "3601", "1.5", "-1"]) ("rejects invalid upstream timeout %j", (value) => {
    expect(() => parseUpstreamTimeoutSeconds(value)).toThrow("OPENLLMS_UPSTREAM_TIMEOUT_SECONDS");
  });

  it.each(["60", "2700", "3600"]) ("accepts upstream timeout %s seconds", (value) => {
    expect(parseUpstreamTimeoutSeconds(value)).toBe(Number(value));
  });
});
