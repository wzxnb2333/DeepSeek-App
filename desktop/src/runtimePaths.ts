import path from "node:path";

export type ResolveWorkspacePathOptions = {
  configuredWorkspace?: string | null;
  cwd: string;
  documentsPath: string;
  installRoots: string[];
  isPackaged: boolean;
  recentWorkspace?: string | null;
};

export function resolveWorkspacePath(options: ResolveWorkspacePathOptions) {
  const configured = options.configuredWorkspace?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const recent = options.recentWorkspace?.trim();
  if (recent) {
    return path.resolve(recent);
  }

  const cwd = path.resolve(options.cwd);
  if (!options.isPackaged) {
    return cwd;
  }

  const normalizedCwd = cwd.toLowerCase();
  const normalizedRoots = options.installRoots.map((root) => path.resolve(root).toLowerCase());
  if (normalizedRoots.some((root) => normalizedCwd === root || normalizedCwd.startsWith(`${root}${path.sep}`))) {
    return "";
  }

  return cwd || options.documentsPath;
}

export type ResolveSidecarBinaryPathOptions = {
  cwd: string;
  envBinary?: string | null;
  existsSync(candidate: string): boolean;
  isPackaged: boolean;
  moduleDir: string;
  platform: NodeJS.Platform;
  resourcesPath: string;
};

export function resolveSidecarBinaryPath(options: ResolveSidecarBinaryPathOptions) {
  const configured = options.envBinary?.trim();
  if (configured) {
    return configured;
  }

  const suffix = options.platform === "win32" ? ".exe" : "";
  const names = [`deepseek-tui${suffix}`, `deepseek${suffix}`];
  const candidates = options.isPackaged
    ? names.flatMap((name) => [path.join(options.resourcesPath, "bin", name), path.join(options.resourcesPath, name)])
    : names.flatMap((name) => [
        path.resolve(options.moduleDir, "..", "..", "..", "target", "release", name),
        path.resolve(options.moduleDir, "..", "..", "..", "target", "debug", name),
        path.resolve(options.cwd, "..", "target", "release", name),
        path.resolve(options.cwd, "..", "target", "debug", name)
      ]);

  return candidates.find((candidate) => options.existsSync(candidate)) || candidates[0];
}
