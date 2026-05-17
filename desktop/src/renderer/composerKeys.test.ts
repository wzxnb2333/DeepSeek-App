import { describe, expect, it } from "vitest";
import { composerKeyIntent } from "./composerKeys";

describe("composer key handling", () => {
  it("sends on Enter", () => {
    expect(composerKeyIntent({ ctrlKey: false, isComposing: false, key: "Enter", metaKey: false })).toBe("send");
  });

  it("inserts a newline on Ctrl+Enter or Meta+Enter", () => {
    expect(composerKeyIntent({ ctrlKey: true, isComposing: false, key: "Enter", metaKey: false })).toBe("newline");
    expect(composerKeyIntent({ ctrlKey: false, isComposing: false, key: "Enter", metaKey: true })).toBe("newline");
  });

  it("ignores composition and other keys", () => {
    expect(composerKeyIntent({ ctrlKey: false, isComposing: true, key: "Enter", metaKey: false })).toBe("ignore");
    expect(composerKeyIntent({ ctrlKey: false, isComposing: false, key: "A", metaKey: false })).toBe("ignore");
  });
});
