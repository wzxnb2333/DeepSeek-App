import { describe, expect, it } from "vitest";
import { parentWorkspacePath, visibleWorkspaceEntries } from "./workspaceTree";
import type { WorkspaceTree } from "./types";

const entries: WorkspaceTree["entries"] = [
  { path: "README.md", name: "README.md", is_dir: false, size: 10 },
  { path: "docs", name: "docs", is_dir: true, size: null },
  { path: "docs/guide.md", name: "guide.md", is_dir: false, size: 20 },
  { path: "src", name: "src", is_dir: true, size: null },
  { path: "src/lib", name: "lib", is_dir: true, size: null },
  { path: "src/lib/main.ts", name: "main.ts", is_dir: false, size: 30 }
];

describe("workspace tree visibility", () => {
  it("keeps root entries visible by default", () => {
    expect(visibleWorkspaceEntries(entries, new Set()).map((entry) => entry.path)).toEqual(["README.md", "docs", "src"]);
  });

  it("reveals descendants only when their ancestors are expanded", () => {
    expect(visibleWorkspaceEntries(entries, new Set(["src"])).map((entry) => entry.path)).toEqual([
      "README.md",
      "docs",
      "src",
      "src/lib"
    ]);
    expect(visibleWorkspaceEntries(entries, new Set(["src", "src/lib"])).map((entry) => entry.path)).toContain(
      "src/lib/main.ts"
    );
  });

  it("reports parent paths and child presence", () => {
    const visible = visibleWorkspaceEntries(entries, new Set(["docs"]));
    expect(parentWorkspacePath("docs/guide.md")).toBe("docs");
    expect(visible.find((entry) => entry.path === "docs")?.hasChildren).toBe(true);
    expect(visible.find((entry) => entry.path === "README.md")?.depth).toBe(0);
  });
});
