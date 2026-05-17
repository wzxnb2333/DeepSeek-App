import type { Approval, EffectiveConfig, RuntimeEvent, ThreadDetail, ThreadRecord, TurnItemRecord, TurnRecord, UsageResponse } from "./types";

const LIVE_TURN_STATUSES = new Set(["queued", "running", "in_progress"]);

export function approvalFromEvent(eventName: string, data: unknown): Approval | null {
  if (eventName !== "approval.required" || typeof data !== "object" || data === null) {
    return null;
  }
  const payload = data as RuntimeEvent;
  const envelope = asRecord(payload.payload) ?? asRecord(payload) ?? {};
  const body =
    asRecord(envelope.request) ??
    asRecord(envelope.payload) ??
    asRecord(envelope.approval) ??
    envelope;
  const input =
    asRecord(body.input) ??
    asRecord(body.arguments) ??
    asRecord(body.args) ??
    asRecord(body.params) ??
    {};
  const toolObject = asRecord(body.tool);
  const approvalId =
    firstString(body.approval_id, body.approvalId, body.id, body.tool_id, body.toolId, body.call_id, body.callId) ?? "";
  if (!approvalId) {
    return null;
  }
  const tool =
    firstString(body.tool_name, body.toolName, body.name, toolObject?.name, input.tool_name, input.toolName) ??
    undefined;
  const command =
    firstString(
      body.command,
      body.commandline,
      body.command_line,
      body.cmd,
      input.command,
      input.commandline,
      input.command_line,
      input.cmd,
      input.script
    ) ?? undefined;
  const reason = firstString(body.reason, body.description, body.message, input.reason, input.description) ?? undefined;
  const cwd =
    firstString(
      body.cwd,
      body.working_directory,
      body.workingDirectory,
      body.workspace,
      input.cwd,
      input.working_directory,
      input.workingDirectory
    ) ?? undefined;
  return {
    approvalId,
    callId: firstString(body.call_id, body.callId) ?? undefined,
    turnId: firstString(body.turn_id, body.turnId, payload.turn_id, payload.turnId) ?? undefined,
    tool,
    command,
    cwd,
    reason,
    permissions: collectPermissions(body),
    createdAt: firstString(payload.timestamp, body.timestamp, body.created_at, body.createdAt) ?? undefined,
    status: "pending"
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function collectPermissions(body: Record<string, unknown>): string[] | undefined {
  const permissions = [
    ...stringArray(body.additional_permissions),
    ...stringArray(body.additionalPermissions),
    ...stringArray(body.proposed_execpolicy_amendment),
    ...stringArray(body.proposedExecpolicyAmendment)
  ];
  const networkContext = asRecord(body.network_approval_context) ?? asRecord(body.networkApprovalContext);
  const host = firstString(networkContext?.host);
  if (host) {
    permissions.push(`network:${host}`);
  }
  return permissions.length ? Array.from(new Set(permissions)).slice(0, 4) : undefined;
}

export function eventLabel(eventName: string, data: unknown) {
  if (eventName === "item.delta" && typeof data === "object" && data) {
    const payload = (data as RuntimeEvent).payload as Record<string, unknown> | undefined;
    if (payload?.kind === "agent_reasoning") {
      return "思考流式更新";
    }
    if (payload?.kind === "agent_message") {
      return "回复流式更新";
    }
    if (payload?.kind === "tool_call") {
      return "工具输出更新";
    }
    return "流式更新";
  }
  if (eventName === "turn.completed") {
    return "turn completed";
  }
  if (eventName === "approval.required") {
    return "approval required";
  }
  return eventName;
}

export function formatElapsed(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function turnElapsedMs(turn: TurnRecord | null | undefined, nowMs = Date.now()) {
  if (!turn) {
    return null;
  }
  const isLive = turn.status && LIVE_TURN_STATUSES.has(turn.status);
  if (!isLive && typeof turn.duration_ms === "number" && Number.isFinite(turn.duration_ms)) {
    return Math.max(0, turn.duration_ms);
  }
  const start = Date.parse(turn.started_at ?? turn.created_at);
  if (Number.isNaN(start)) {
    return null;
  }
  const end = turn.ended_at ? Date.parse(turn.ended_at) : nowMs;
  return Math.max(0, (Number.isNaN(end) ? nowMs : end) - start);
}

export function turnProgressLabel(turn: TurnRecord | null | undefined, nowMs = Date.now()) {
  const elapsed = turnElapsedMs(turn, nowMs);
  if (elapsed === null) {
    return null;
  }
  const status = turn?.status;
  const prefix = status && LIVE_TURN_STATUSES.has(status) ? "处理中" : status === "failed" ? "失败" : "耗时";
  return `${prefix} ${formatElapsed(elapsed)}`;
}

export function turnStatusLine(turn: TurnRecord | null | undefined, nowMs = Date.now()) {
  const elapsed = turnProgressLabel(turn, nowMs);
  if (!elapsed) {
    return null;
  }
  if (turn?.status === "queued") {
    return `${elapsed} · 等待开始`;
  }
  if (turn?.status === "running" || turn?.status === "in_progress") {
    return `${elapsed} · 持续接收进度`;
  }
  if (turn?.status === "failed") {
    return `${elapsed} · ${turn.error || "处理失败"}`;
  }
  return elapsed;
}

export function turnItemTitle(item: TurnItemRecord) {
  if (item.kind === "agent_reasoning") {
    return item.status === "completed" ? "已整理思路" : "正在整理思路";
  }
  if (item.kind.includes("command")) {
    return item.status === "completed" ? "命令已完成" : "正在运行命令";
  }
  if (item.kind.includes("tool")) {
    return item.status === "completed" ? "工具已完成" : "正在使用工具";
  }
  if (item.kind.includes("file")) {
    return item.status === "completed" ? "文件已更新" : "正在更新文件";
  }
  if (item.kind.includes("error")) {
    return "出现错误";
  }
  return item.kind.replaceAll("_", " ");
}

export function turnItemSummary(item: TurnItemRecord) {
  const fileChange = fileChangeSummary(item);
  if (fileChange) {
    return fileChange;
  }
  const command = firstStringFromRecord(item.metadata, "command", "cmd", "command_line", "commandline");
  if (command) {
    return command;
  }
  const tool = firstStringFromRecord(item.metadata, "tool", "tool_name", "name");
  if (tool) {
    return tool;
  }
  return item.summary || item.detail || "";
}

export function fileChangeSummary(item: TurnItemRecord) {
  const metadata = asRecord(item.metadata);
  if (!metadata && !item.kind.includes("file")) {
    return null;
  }
  const path =
    firstStringFromRecord(metadata, "path", "file", "file_path", "filename", "name") ??
    firstChangedPath(metadata) ??
    firstPathFromText(item.summary) ??
    firstPathFromText(item.detail);
  const added =
    firstNumberFromRecord(metadata, "added", "additions", "insertions", "lines_added", "added_lines") ??
    firstNumberFromNestedChanges(metadata, ["added", "additions", "insertions", "lines_added", "added_lines"]);
  const removed =
    firstNumberFromRecord(metadata, "removed", "deletions", "deleted", "lines_removed", "removed_lines", "deleted_lines") ??
    firstNumberFromNestedChanges(metadata, ["removed", "deletions", "deleted", "lines_removed", "removed_lines", "deleted_lines"]);
  if (!path && added === null && removed === null) {
    return null;
  }
  const parts = [path ?? "文件"];
  if (added !== null) {
    parts.push(`+${added}`);
  }
  if (removed !== null) {
    parts.push(`-${removed}`);
  }
  return parts.join(" ");
}

export function contextStatusLabel(detail: ThreadDetail | null | undefined, usage: UsageResponse | null | undefined) {
  const precise = detail?.context ?? usage?.context ?? null;
  const status = precise?.compression_status?.trim();
  const used = precise?.used_tokens ?? null;
  const windowTokens = precise?.window_tokens ?? null;
  const percent =
    typeof precise?.percent_used === "number"
      ? precise.percent_used
      : used !== null && windowTokens ? Math.round((used / windowTokens) * 100)
      : null;
  if (used !== null || percent !== null || status) {
    const usagePart = used !== null ? `${formatCompactNumber(used)} tok` : percent !== null ? `${percent}%` : "有用量";
    return `${status ? contextCompressionLabel(status) : "上下文"} · ${usagePart}${percent !== null && used !== null ? ` · ${percent}%` : ""}`;
  }
  const estimatedTokens = estimateThreadTokens(detail);
  const compacted = Boolean(detail?.turns.some((turn) => /compact/i.test(turn.input_summary)));
  if (estimatedTokens > 0) {
    return `${compacted ? "已压缩" : "上下文"} · 约 ${formatCompactNumber(estimatedTokens)} tok`;
  }
  return "上下文 · 新线程";
}

export function shouldShowApprovalComposer({
  approval,
  mode,
  thread
}: {
  approval: Approval | null;
  config: EffectiveConfig | null;
  mode: string;
  thread?: ThreadRecord | null;
}) {
  if (!approval || approval.status !== "pending") {
    return false;
  }
  const frontendYolo = mode === "yolo" || thread?.auto_approve === true || thread?.trust_mode === true;
  return !frontendYolo;
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(Math.max(0, Math.round(value)));
}

function contextCompressionLabel(status: string) {
  if (/compact|compress|summar/i.test(status)) {
    return "已压缩";
  }
  if (/pending|needed|near/i.test(status)) {
    return "接近压缩";
  }
  return "上下文";
}

function estimateThreadTokens(detail: ThreadDetail | null | undefined) {
  if (!detail) {
    return 0;
  }
  const chars = detail.items.reduce((count, item) => count + (item.summary?.length ?? 0) + (item.detail?.length ?? 0), 0);
  return Math.ceil(chars / 4);
}

function firstStringFromRecord(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!record) {
    return null;
  }
  return firstString(...keys.map((key) => record[key]));
}

function firstNumberFromRecord(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return Number(value);
    }
  }
  return null;
}

function firstChangedPath(record: Record<string, unknown> | null | undefined) {
  const changes = Array.isArray(record?.changes) ? record.changes : Array.isArray(record?.files) ? record.files : [];
  for (const change of changes) {
    const path = firstStringFromRecord(asRecord(change), "path", "file", "file_path", "filename", "name");
    if (path) {
      return path;
    }
  }
  return null;
}

function firstNumberFromNestedChanges(record: Record<string, unknown> | null | undefined, keys: string[]) {
  const changes = Array.isArray(record?.changes) ? record.changes : Array.isArray(record?.files) ? record.files : [];
  let total = 0;
  let seen = false;
  for (const change of changes) {
    const value = firstNumberFromRecord(asRecord(change), ...keys);
    if (value !== null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

function firstPathFromText(text?: string | null) {
  if (!text) {
    return null;
  }
  const match = text.match(/(?:^|\s)([A-Za-z]:\\[^\s]+|[\w./-]+\.[A-Za-z0-9]+)(?:\s|$)/);
  return match?.[1] ?? null;
}
