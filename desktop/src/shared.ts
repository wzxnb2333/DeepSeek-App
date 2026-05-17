export type RuntimeStatus = {
  running: boolean;
  baseUrl: string | null;
  port: number | null;
  pid: number | null;
  authRequired: boolean;
  ready: boolean;
  workspace: string | null;
  lastError: string | null;
};

export type WorkspaceState = {
  active: string | null;
  recent: string[];
};

export type WorkspaceOpenTarget = "file-explorer" | "terminal" | "vscode" | "visual-studio";

export type WorkspaceOpenResult = {
  ok: boolean;
  message?: string;
};

export type WorkspacePathOpenTarget = "file" | "folder";

export type RuntimeRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

export type RuntimeResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

export type RuntimeLogEntry = {
  ts: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type RuntimeEventMessage = {
  channelId: string;
  event: string;
  data: unknown;
};

export type SubscribeRequest = {
  channelId: string;
  threadId: string;
  sinceSeq?: number;
};

export type DesktopApi = {
  runtimeStatus(): Promise<RuntimeStatus>;
  restartRuntime(): Promise<RuntimeStatus>;
  workspaceCurrent(): Promise<WorkspaceState>;
  workspaceChooseDirectory(): Promise<WorkspaceState>;
  workspaceSwitch(path: string): Promise<WorkspaceState>;
  workspaceForget(path: string): Promise<WorkspaceState>;
  workspaceOpen(target: WorkspaceOpenTarget): Promise<WorkspaceOpenResult>;
  workspaceOpenPath(path: string, target: WorkspacePathOpenTarget): Promise<WorkspaceOpenResult>;
  workspaceCreateWorktree(): Promise<WorkspaceState>;
  request<T = unknown>(request: RuntimeRequest): Promise<RuntimeResponse<T>>;
  subscribeThreadEvents(request: SubscribeRequest): Promise<void>;
  unsubscribe(channelId: string): Promise<void>;
  onRuntimeEvent(callback: (message: RuntimeEventMessage) => void): () => void;
  onRuntimeLog(callback: (entry: RuntimeLogEntry) => void): () => void;
};
