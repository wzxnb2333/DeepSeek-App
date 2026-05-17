import { describe, expect, it } from "vitest";
import { railTabAfter } from "./railTabs";

describe("railTabAfter", () => {
  it("wraps forward and backward through right rail tabs", () => {
    expect(railTabAfter("workspace", "next")).toBe("runtime");
    expect(railTabAfter("runtime", "next")).toBe("extensions");
    expect(railTabAfter("extensions", "next")).toBe("logs");
    expect(railTabAfter("logs", "next")).toBe("workspace");
    expect(railTabAfter("workspace", "previous")).toBe("logs");
  });

  it("jumps to first and last tabs", () => {
    expect(railTabAfter("logs", "first")).toBe("workspace");
    expect(railTabAfter("workspace", "last")).toBe("logs");
  });
});
