import type { RuntimeEventMessage } from "../shared";
import type { WorkspaceOpenTarget, WorkspacePathOpenTarget } from "../shared";
import type {
  AutomationRecord,
  ConfigPatch,
  EffectiveConfig,
  McpServersResponse,
  ModelsResponse,
  SkillsResponse,
  StartTurnResponse,
  TasksResponse,
  TaskSummary,
  ThreadDetail,
  ThreadRecord,
  ThreadSummary,
  UsageResponse,
  WorkspaceFile,
  WorkspaceSearch,
  WorkspaceTree
} from "./types";

async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const response = await window.deepseekDesktop.request<T>({ method, path, body });
  if (!response.ok) {
    const message =
      typeof response.data === "object" && response.data && "error" in response.data
        ? JSON.stringify(response.data)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.data;
}

export const api = {
  runtimeStatus: () => window.deepseekDesktop.runtimeStatus(),
  restartRuntime: () => window.deepseekDesktop.restartRuntime(),
  workspaceCurrent: () => window.deepseekDesktop.workspaceCurrent(),
  workspaceChooseDirectory: () => window.deepseekDesktop.workspaceChooseDirectory(),
  workspaceSwitch: (workspacePath: string) => window.deepseekDesktop.workspaceSwitch(workspacePath),
  workspaceForget: (workspacePath: string) => window.deepseekDesktop.workspaceForget(workspacePath),
  workspaceOpen: (target: WorkspaceOpenTarget) => window.deepseekDesktop.workspaceOpen(target),
  workspaceOpenPath: (path: string, target: WorkspacePathOpenTarget) => window.deepseekDesktop.workspaceOpenPath(path, target),
  workspaceCreateWorktree: () => window.deepseekDesktop.workspaceCreateWorktree(),
  threads: (workspace?: string | null) => {
    const path = workspace
      ? `/v1/threads/summary?limit=120&workspace=${encodeURIComponent(workspace)}`
      : "/v1/threads/summary?limit=120";
    return request<ThreadSummary[]>("GET", path);
  },
  createThread: (body: Record<string, unknown>) => request<ThreadRecord>("POST", "/v1/threads", body),
  getThread: (id: string) => request<ThreadDetail>("GET", `/v1/threads/${id}`),
  archiveThread: (id: string) => request<ThreadRecord>("PATCH", `/v1/threads/${id}`, { archived: true }),
  renameThread: (id: string, title: string) => request<ThreadRecord>("PATCH", `/v1/threads/${id}`, { title }),
  deleteThread: (id: string) => request<ThreadRecord>("DELETE", `/v1/threads/${id}`),
  startTurn: (
    threadId: string,
    prompt: string,
    options?: {
      model?: string;
      mode?: string;
      allow_shell?: boolean;
      trust_mode?: boolean;
      auto_approve?: boolean;
      reasoning_effort?: string;
    }
  ) =>
    request<StartTurnResponse>("POST", `/v1/threads/${threadId}/turns`, {
      prompt,
      model: options?.model || undefined,
      mode: options?.mode || undefined,
      allow_shell: options?.allow_shell,
      trust_mode: options?.trust_mode,
      auto_approve: options?.auto_approve,
      reasoning_effort: options?.reasoning_effort || undefined
    }),
  interruptTurn: (threadId: string, turnId: string) =>
    request<Record<string, unknown>>("POST", `/v1/threads/${threadId}/turns/${turnId}/interrupt`),
  compactThread: (threadId: string) => request<Record<string, unknown>>("POST", `/v1/threads/${threadId}/compact`),
  updateThread: (id: string, body: Record<string, unknown>) => request<ThreadRecord>("PATCH", `/v1/threads/${id}`, body),
  decideApproval: (approvalId: string, decision: "allow" | "deny", remember = false) =>
    request<Record<string, unknown>>("POST", `/v1/approvals/${approvalId}`, { decision, remember }),
  tasks: () => request<TasksResponse>("GET", "/v1/tasks"),
  createTask: (prompt: string) => request<Record<string, unknown>>("POST", "/v1/tasks", { prompt }),
  cancelTask: (id: string) => request<TaskSummary>("POST", `/v1/tasks/${id}/cancel`),
  deleteTask: (id: string) => request<TaskSummary>("DELETE", `/v1/tasks/${id}`),
  automations: () => request<AutomationRecord[]>("GET", "/v1/automations"),
  automationAction: (id: string, action: "pause" | "resume" | "run") =>
    request<Record<string, unknown>>("POST", `/v1/automations/${id}/${action}`),
  config: () => request<EffectiveConfig>("GET", "/v1/config/effective"),
  patchConfig: (body: ConfigPatch) => request<EffectiveConfig>("PATCH", "/v1/config", body),
  models: () => request<ModelsResponse>("GET", "/v1/models"),
  skills: () => request<SkillsResponse>("GET", "/v1/skills"),
  setSkill: (name: string, enabled: boolean) => request<Record<string, unknown>>("POST", `/v1/skills/${name}`, { enabled }),
  mcpServers: () => request<McpServersResponse>("GET", "/v1/apps/mcp/servers"),
  usage: () => request<UsageResponse>("GET", "/v1/usage?group_by=day"),
  workspaceTree: () => request<WorkspaceTree>("GET", "/v1/workspace/tree?depth=5&limit=500000"),
  workspaceFile: (path: string) =>
    request<WorkspaceFile>("GET", `/v1/workspace/file?path=${encodeURIComponent(path)}&max_bytes=65536`),
  workspaceSearch: (query: string) =>
    request<WorkspaceSearch>("GET", `/v1/workspace/search?q=${encodeURIComponent(query)}&limit=50`),
  subscribeThreadEvents: (threadId: string, onEvent: (message: RuntimeEventMessage) => void, sinceSeq = 0) => {
    const channelId = `thread:${threadId}:${Date.now()}`;
    const unsubscribeEvent = window.deepseekDesktop.onRuntimeEvent((message) => {
      if (message.channelId === channelId) {
        onEvent(message);
      }
    });
    void window.deepseekDesktop.subscribeThreadEvents({ channelId, threadId, sinceSeq });
    return () => {
      unsubscribeEvent();
      void window.deepseekDesktop.unsubscribe(channelId);
    };
  }
};
