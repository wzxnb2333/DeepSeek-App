export type ThreadSummary = {
  id: string;
  title: string;
  preview: string;
  model: string;
  workspace: string;
  mode: string;
  archived: boolean;
  updated_at: string;
  latest_turn_id?: string | null;
  latest_turn_status?: string | null;
};

export type RuntimeEvent = {
  seq?: number;
  timestamp?: string;
  thread_id?: string;
  turn_id?: string | null;
  item_id?: string | null;
  event?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ThreadDetail = {
  thread: ThreadRecord;
  turns: TurnRecord[];
  items: TurnItemRecord[];
  events: RuntimeEvent[];
  latest_seq?: number;
  context?: ContextWindowStatus | null;
};

export type StartTurnResponse = {
  thread: ThreadRecord;
  turn: TurnRecord;
};

export type ThreadRecord = {
  id: string;
  title?: string | null;
  model: string;
  workspace: string;
  mode: string;
  allow_shell: boolean;
  trust_mode: boolean;
  auto_approve: boolean;
  latest_turn_id?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type TurnRecord = {
  id: string;
  thread_id: string;
  status: string;
  input_summary: string;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
};

export type ContextWindowStatus = {
  window_tokens?: number | null;
  used_tokens?: number | null;
  remaining_tokens?: number | null;
  percent_used?: number | null;
  compression_status?: string | null;
  compacted_at?: string | null;
  last_compaction_at?: string | null;
};

export type TurnItemRecord = {
  id: string;
  turn_id: string;
  kind: string;
  status: string;
  summary: string;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
  started_at?: string | null;
  ended_at?: string | null;
};

export type TaskSummary = {
  id: string;
  status: string;
  prompt_summary: string;
  model: string;
  mode: string;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
};

export type TasksResponse = {
  tasks: TaskSummary[];
  counts: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    canceled: number;
  };
};

export type AutomationRecord = {
  id: string;
  name: string;
  prompt: string;
  rrule: string;
  cwds: string[];
  status: string;
  created_at: string;
  updated_at: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
};

export type EffectiveConfig = {
  config_path?: string | null;
  config_present: boolean;
  workspace: string;
  provider: string;
  default_model: string;
  base_url: string;
  api_key_source: string;
  approval_policy: string;
  sandbox_mode: string;
  allow_shell: boolean;
  yolo: boolean;
  reasoning_effort: string;
  mcp_config_path: string;
  skills_dir: string;
};

export type ConfigPatch = {
  provider?: string;
  default_text_model?: string;
  reasoning_effort?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  allow_shell?: boolean;
  yolo?: boolean;
};

export type ModelsResponse = {
  provider: string;
  default_model: string;
  live: boolean;
  error?: string | null;
  models: Array<{ id: string; owned_by?: string | null; created?: number | null }>;
};

export type SkillEntry = {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
};

export type SkillsResponse = {
  directory: string;
  warnings: string[];
  skills: SkillEntry[];
};

export type McpServersResponse = {
  servers: Array<{
    name: string;
    enabled: boolean;
    required: boolean;
    command?: string | null;
    url?: string | null;
    connected: boolean;
    enabled_tools?: string[];
    disabled_tools?: string[];
  }>;
};

export type UsageResponse = {
  totals?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
    cost_usd: number;
    turns: number;
  };
  context?: ContextWindowStatus | null;
};

export type WorkspaceTree = {
  root: string;
  path: string;
  entries: Array<{ path: string; name: string; is_dir: boolean; size?: number | null }>;
  truncated: boolean;
};

export type WorkspaceFile = {
  path: string;
  content: string;
  truncated: boolean;
  bytes_read: number;
  size: number;
};

export type WorkspaceSearch = {
  query: string;
  matches: Array<{ path: string; line: number; snippet: string }>;
  truncated: boolean;
};

export type Approval = {
  approvalId: string;
  callId?: string;
  turnId?: string;
  tool?: string;
  command?: string;
  cwd?: string;
  reason?: string;
  permissions?: string[];
  createdAt?: string;
  status: "pending" | "allowed" | "denied";
};
