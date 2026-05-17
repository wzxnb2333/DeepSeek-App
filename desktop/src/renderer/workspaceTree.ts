import type { WorkspaceTree } from "./types";

type WorkspaceEntry = WorkspaceTree["entries"][number];

export type VisibleWorkspaceEntry = WorkspaceEntry & {
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  parentPath: string | null;
};

function pathParts(path: string) {
  return path.split(/[\\/]/).filter(Boolean);
}

export function parentWorkspacePath(path: string) {
  const parts = pathParts(path);
  if (parts.length <= 1) {
    return null;
  }
  parts.pop();
  return parts.join("/");
}

function ancestorPaths(path: string) {
  const parts = pathParts(path);
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

export function visibleWorkspaceEntries(entries: WorkspaceEntry[], expandedPaths: ReadonlySet<string>) {
  const parentPaths = new Set<string>();
  for (const entry of entries) {
    const parent = parentWorkspacePath(entry.path);
    if (parent) {
      parentPaths.add(parent);
    }
  }

  return entries
    .filter((entry) => ancestorPaths(entry.path).every((path) => expandedPaths.has(path)))
    .map<VisibleWorkspaceEntry>((entry) => ({
      ...entry,
      depth: Math.max(0, pathParts(entry.path).length - 1),
      expanded: expandedPaths.has(entry.path),
      hasChildren: parentPaths.has(entry.path),
      parentPath: parentWorkspacePath(entry.path)
    }));
}
