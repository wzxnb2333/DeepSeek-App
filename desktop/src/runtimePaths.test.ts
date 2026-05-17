import { describe, expect, it } from "vitest";
import { resolveSidecarBinaryPath, resolveWorkspacePath } from "./runtimePaths";

describe("runtime path resolution", () => {
  it("resolves an explicit workspace override", () => {
    expect(
      resolveWorkspacePath({
        configuredWorkspace: "E:\\AI_collection\\deepseek-tui\\sample-workspace",
        cwd: "E:\\AI_collection\\deepseek-tui\\desktop",
        documentsPath: "C:\\Users\\Administrator\\Documents",
        installRoots: ["C:\\Program Files\\DeepSeek App"],
        isPackaged: true
      })
    ).toBe("E:\\AI_collection\\deepseek-tui\\sample-workspace");
  });

  it("does not choose the install root as a packaged workspace", () => {
    expect(
      resolveWorkspacePath({
        configuredWorkspace: "",
        cwd: "C:\\Program Files\\DeepSeek App\\resources\\app",
        documentsPath: "C:\\Users\\Administrator\\Documents",
        installRoots: ["C:\\Program Files\\DeepSeek App", "C:\\Program Files\\DeepSeek App\\resources"],
        isPackaged: true
      })
    ).toBe("");
  });

  it("uses the recent workspace before packaged install-root fallback", () => {
    expect(
      resolveWorkspacePath({
        configuredWorkspace: "",
        recentWorkspace: "E:\\AI_collection\\deepseek-tui",
        cwd: "C:\\Program Files\\DeepSeek App\\resources\\app",
        documentsPath: "C:\\Users\\Administrator\\Documents",
        installRoots: ["C:\\Program Files\\DeepSeek App", "C:\\Program Files\\DeepSeek App\\resources"],
        isPackaged: true
      })
    ).toBe("E:\\AI_collection\\deepseek-tui");
  });

  it("prefers the first existing development runtime binary", () => {
    expect(
      resolveSidecarBinaryPath({
        cwd: "E:\\AI_collection\\deepseek-tui\\desktop",
        envBinary: "",
        existsSync: (candidate) => candidate.endsWith("target\\release\\deepseek.exe"),
        isPackaged: false,
        moduleDir: "E:\\AI_collection\\deepseek-tui\\desktop\\.vite\\build",
        platform: "win32",
        resourcesPath: "C:\\Program Files\\DeepSeek App\\resources"
      })
    ).toBe("E:\\AI_collection\\deepseek-tui\\target\\release\\deepseek.exe");
  });

  it("honors an explicit runtime binary override", () => {
    expect(
      resolveSidecarBinaryPath({
        cwd: "E:\\AI_collection\\deepseek-tui\\desktop",
        envBinary: "E:\\custom\\deepseek.exe",
        existsSync: () => false,
        isPackaged: true,
        moduleDir: "E:\\AI_collection\\deepseek-tui\\desktop\\.vite\\build",
        platform: "win32",
        resourcesPath: "C:\\Program Files\\DeepSeek App\\resources"
      })
    ).toBe("E:\\custom\\deepseek.exe");
  });
});
