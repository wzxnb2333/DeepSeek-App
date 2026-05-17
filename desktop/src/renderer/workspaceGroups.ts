import type { ThreadSummary, WorkspaceTree } from "./types";

const EMPTY_THREAD_TITLES = new Set(["", "new thread", "新线程", "新会话", "未命名会话"]);

export type WorkspaceThreadGroup = {
  path: string;
  name: string;
  shortPath: string;
  active: boolean;
  threads: ThreadSummary[];
};

export type WorkspaceAliases = Record<string, string>;

export function normalizeWorkspacePath(value?: string | null) {
  return (value ?? "").trim().replace(/[\\/]+$/, "");
}

export function workspaceKey(value?: string | null) {
  return normalizeWorkspacePath(value).toLocaleLowerCase();
}

export function sameWorkspacePath(left?: string | null, right?: string | null) {
  const leftKey = workspaceKey(left);
  const rightKey = workspaceKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function isHiddenWorkspace(value: string | null | undefined, hiddenWorkspaceKeys: ReadonlySet<string>) {
  const key = workspaceKey(value);
  return Boolean(key && hiddenWorkspaceKeys.has(key));
}

export function filterVisibleWorkspaces(values: string[], hiddenWorkspaceKeys: ReadonlySet<string>) {
  return values.filter((value) => !isHiddenWorkspace(value, hiddenWorkspaceKeys));
}

export function revealWorkspaceKey(hiddenWorkspaceKeys: ReadonlySet<string>, value?: string | null) {
  const key = workspaceKey(value);
  if (!key || !hiddenWorkspaceKeys.has(key)) {
    return hiddenWorkspaceKeys;
  }
  const next = new Set(hiddenWorkspaceKeys);
  next.delete(key);
  return next;
}

export function mergeVisibleWorkspaces(existing: string[], incoming: string[], hiddenWorkspaceKeys: ReadonlySet<string>) {
  const merged = [...existing];
  const seen = new Set(existing.map((value) => workspaceKey(value)).filter(Boolean));
  for (const value of incoming) {
    const key = workspaceKey(value);
    if (!key || hiddenWorkspaceKeys.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalizeWorkspacePath(value));
  }
  return merged;
}

export function workspaceDisplayName(value?: string | null, aliases?: WorkspaceAliases) {
  const alias = aliases?.[workspaceKey(value)]?.trim();
  if (alias) {
    return alias;
  }
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return "DeepSeek 项目";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function compactWorkspacePath(value?: string | null) {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : normalized;
}

export function isEmptyPlaceholderThread(thread: ThreadSummary) {
  if (thread.latest_turn_id) {
    return false;
  }
  const title = (thread.title ?? "").trim().toLocaleLowerCase();
  const preview = (thread.preview ?? "").trim().toLocaleLowerCase();
  return EMPTY_THREAD_TITLES.has(title) && (EMPTY_THREAD_TITLES.has(preview) || preview === title);
}

export function nextThreadSelectionAfterRemoval(threads: ThreadSummary[], removedThreadId: string, activeThreadId: string | null) {
  if (activeThreadId !== removedThreadId) {
    return activeThreadId;
  }
  const removedThread = threads.find((thread) => thread.id === removedThreadId);
  const remainingThreads = threads.filter((thread) => thread.id !== removedThreadId);
  return remainingThreads.find((thread) => sameWorkspacePath(thread.workspace, removedThread?.workspace))?.id ?? null;
}

export function nextThreadSelectionAfterRefresh({
  activeThreadId,
  activeWorkspace,
  preserveEmptySelection,
  threads
}: {
  activeThreadId: string | null;
  activeWorkspace: string | null;
  preserveEmptySelection?: boolean;
  threads: ThreadSummary[];
}) {
  if (activeThreadId && threads.some((thread) => thread.id === activeThreadId)) {
    return activeThreadId;
  }
  if (preserveEmptySelection) {
    return null;
  }
  if (activeWorkspace) {
    return threads.find((thread) => sameWorkspacePath(thread.workspace, activeWorkspace))?.id ?? null;
  }
  return threads[0]?.id ?? null;
}

export function buildWorkspaceGroups({
  activeWorkspace,
  workspaceAliases = {},
  workspaceOrder = [],
  pinnedWorkspaces = [],
  recentWorkspaces,
  threads,
  tree
}: {
  activeWorkspace: string | null;
  workspaceAliases?: WorkspaceAliases;
  workspaceOrder?: string[];
  pinnedWorkspaces?: string[];
  recentWorkspaces: string[];
  threads: ThreadSummary[];
  tree: WorkspaceTree | null;
}): WorkspaceThreadGroup[] {
  const pinnedKeys = new Set(pinnedWorkspaces.map(workspaceKey).filter(Boolean));
  const orderIndex = new Map(workspaceOrder.map((path, index) => [workspaceKey(path), index]));
  const byKey = new Map<string, string>();
  const addWorkspace = (value?: string | null) => {
    const normalized = normalizeWorkspacePath(value);
    const key = workspaceKey(normalized);
    if (key && !byKey.has(key)) {
      byKey.set(key, normalized);
    }
  };

  recentWorkspaces.forEach(addWorkspace);
  threads.forEach((thread) => addWorkspace(thread.workspace));
  addWorkspace(tree?.root);
  addWorkspace(activeWorkspace);

  return [...byKey.values()]
    .map((path) => {
      const groupThreads = threads.filter((thread) => sameWorkspacePath(thread.workspace, path));
      return {
        path,
        name: workspaceDisplayName(path, workspaceAliases),
        shortPath: compactWorkspacePath(path),
        active: sameWorkspacePath(path, activeWorkspace),
        threads: groupThreads
      };
    })
    .sort((left, right) => {
      const leftPinned = pinnedKeys.has(workspaceKey(left.path));
      const rightPinned = pinnedKeys.has(workspaceKey(right.path));
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }
      const leftOrder = orderIndex.get(workspaceKey(left.path)) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderIndex.get(workspaceKey(right.path)) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return 0;
    });
}
