import { describe, expect, it } from "vitest";
import {
  buildWorkspaceGroups,
  compactWorkspacePath,
  filterVisibleWorkspaces,
  isEmptyPlaceholderThread,
  isHiddenWorkspace,
  mergeVisibleWorkspaces,
  nextThreadSelectionAfterRefresh,
  nextThreadSelectionAfterRemoval,
  revealWorkspaceKey,
  sameWorkspacePath,
  workspaceDisplayName
} from "./workspaceGroups";
import type { ThreadSummary } from "./types";

function thread(id: string, workspace: string, title = "Fix UI", latestTurnId: string | null = "turn_1"): ThreadSummary {
  return {
    id,
    title,
    preview: title,
    model: "deepseek-v4-pro",
    workspace,
    mode: "agent",
    archived: false,
    updated_at: "2026-05-15T12:00:00Z",
    latest_turn_id: latestTurnId,
    latest_turn_status: latestTurnId ? "completed" : null
  };
}

describe("workspace grouping", () => {
  it("deduplicates workspaces and keeps the existing workspace order", () => {
    const groups = buildWorkspaceGroups({
      activeWorkspace: "E:\\repo\\app",
      recentWorkspaces: ["E:\\repo\\docs", "E:\\repo\\app\\"],
      tree: { root: "E:\\repo\\app", path: "", entries: [], truncated: false },
      threads: [thread("a", "E:\\repo\\docs"), thread("b", "E:\\repo\\app")]
    });

    expect(groups.map((group) => group.path)).toEqual(["E:\\repo\\docs", "E:\\repo\\app"]);
    expect(groups[1]?.active).toBe(true);
    expect(groups[1]?.threads.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps workspace order stable when the active workspace changes", () => {
    const groups = buildWorkspaceGroups({
      activeWorkspace: "E:\\repo\\app",
      workspaceOrder: ["E:\\repo\\docs", "E:\\repo\\app"],
      recentWorkspaces: ["E:\\repo\\app", "E:\\repo\\docs"],
      tree: { root: "E:\\repo\\app", path: "", entries: [], truncated: false },
      threads: [thread("a", "E:\\repo\\docs"), thread("b", "E:\\repo\\app")]
    });

    expect(groups.map((group) => group.path)).toEqual(["E:\\repo\\docs", "E:\\repo\\app"]);
    expect(groups[1]?.active).toBe(true);
  });

  it("normalizes workspace path comparisons for Windows paths", () => {
    expect(sameWorkspacePath("E:\\Repo\\App\\", "e:\\repo\\app")).toBe(true);
    expect(workspaceDisplayName("E:\\Repo\\App")).toBe("App");
    expect(compactWorkspacePath("E:\\AI_collection\\deepseek-tui\\desktop")).toBe(".../AI_collection/deepseek-tui/desktop");
  });

  it("filters locally hidden workspaces with normalized paths", () => {
    const hidden = new Set(["e:\\repo\\docs"]);

    expect(isHiddenWorkspace("E:\\Repo\\Docs\\", hidden)).toBe(true);
    expect(filterVisibleWorkspaces(["E:\\repo\\app", "E:\\repo\\docs"], hidden)).toEqual(["E:\\repo\\app"]);
  });

  it("reveals a hidden workspace when the user explicitly selects it again", () => {
    const hidden = new Set(["e:\\repo\\docs", "e:\\repo\\old"]);
    const revealed = revealWorkspaceKey(hidden, "E:\\Repo\\Docs\\");

    expect([...revealed]).toEqual(["e:\\repo\\old"]);
    expect(mergeVisibleWorkspaces([], ["E:\\repo\\docs"], revealed)).toEqual(["E:\\repo\\docs"]);
  });

  it("detects empty placeholder threads that should be archived or hidden", () => {
    expect(isEmptyPlaceholderThread(thread("empty", "E:\\repo", "New Thread", null))).toBe(true);
    expect(isEmptyPlaceholderThread(thread("used", "E:\\repo", "New Thread", "turn_1"))).toBe(false);
    expect(isEmptyPlaceholderThread(thread("named", "E:\\repo", "Real request", null))).toBe(false);
  });

  it("uses local project aliases for workspace labels", () => {
    const groups = buildWorkspaceGroups({
      activeWorkspace: "E:\\repo\\app",
      workspaceAliases: { "e:\\repo\\app": "桌面应用" },
      recentWorkspaces: [],
      tree: null,
      threads: [thread("a", "E:\\repo\\app")]
    });

    expect(workspaceDisplayName("E:\\repo\\app", { "e:\\repo\\app": "桌面应用" })).toBe("桌面应用");
    expect(groups[0]?.name).toBe("桌面应用");
  });

  it("keeps removal selection inside the current workspace", () => {
    const threads = [thread("a", "E:\\repo\\app"), thread("b", "E:\\repo\\app"), thread("c", "E:\\repo\\docs")];

    expect(nextThreadSelectionAfterRemoval(threads, "a", "a")).toBe("b");
    expect(nextThreadSelectionAfterRemoval(threads, "c", "a")).toBe("a");
    expect(nextThreadSelectionAfterRemoval([thread("a", "E:\\repo\\app"), thread("c", "E:\\repo\\docs")], "a", "a")).toBeNull();
  });

  it("keeps refreshed selection inside the active workspace", () => {
    const threads = [thread("docs", "E:\\repo\\docs")];

    expect(
      nextThreadSelectionAfterRefresh({
        activeThreadId: null,
        activeWorkspace: "E:\\repo\\app",
        threads
      })
    ).toBeNull();
  });

  it("keeps a draft new conversation empty during refresh", () => {
    const threads = [thread("app", "E:\\repo\\app"), thread("docs", "E:\\repo\\docs")];

    expect(
      nextThreadSelectionAfterRefresh({
        activeThreadId: null,
        activeWorkspace: "E:\\repo\\app",
        preserveEmptySelection: true,
        threads
      })
    ).toBeNull();
  });
});
