import { describe, expect, it } from "vitest";
import { parseStartupPayloadLine } from "./runtimeStartup";

describe("runtime startup payload parsing", () => {
  it("parses the ready payload emitted by the sidecar", () => {
    expect(
      parseStartupPayloadLine(
        JSON.stringify({
          status: "ready",
          base_url: "http://127.0.0.1:6884",
          port: 6884,
          auth_required: true,
          auth_token: "token_123"
        })
      )
    ).toEqual({
      status: "ready",
      base_url: "http://127.0.0.1:6884",
      port: 6884,
      auth_required: true,
      auth_token: "token_123"
    });
  });

  it("ignores non-json runtime chatter", () => {
    expect(parseStartupPayloadLine("runtime ready on http://127.0.0.1:6884")).toBeNull();
  });

  it("ignores unrelated json frames", () => {
    expect(
      parseStartupPayloadLine(
        JSON.stringify({
          status: "starting",
          base_url: "http://127.0.0.1:6884",
          port: 6884,
          auth_required: false,
          auth_token: null
        })
      )
    ).toBeNull();
  });
});
