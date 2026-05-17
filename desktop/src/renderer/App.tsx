import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Code2,
  Edit3,
  FileText,
  FolderOpen,
  FolderTree,
  Gauge,
  KeyRound,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pin,
  Play,
  Plus,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  User,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { api } from "./api";
import {
  approvalFromEvent,
  contextStatusLabel,
  shouldShowApprovalComposer,
  turnItemSummary,
  turnItemTitle,
  turnStatusLine
} from "./state";
import { composerKeyIntent } from "./composerKeys";
import { buildTurnTimeline } from "./turnTimeline";
import {
  applyFixtureAutomationAction,
  cancelFixtureTask,
  fixtureApprovals,
  fixtureAutomations,
  fixtureThreadDetail,
  fixtureThreads,
  fixtureTasks,
  mergeFixtureAutomations,
  mergeFixtureTasks
} from "./fixtures";
import { visibleWorkspaceEntries } from "./workspaceTree";
import {
  buildWorkspaceGroups,
  compactWorkspacePath,
  filterVisibleWorkspaces,
  isHiddenWorkspace,
  isEmptyPlaceholderThread,
  mergeVisibleWorkspaces,
  nextThreadSelectionAfterRefresh,
  nextThreadSelectionAfterRemoval,
  normalizeWorkspacePath,
  revealWorkspaceKey,
  sameWorkspacePath,
  workspaceDisplayName,
  workspaceKey,
  type WorkspaceAliases
} from "./workspaceGroups";
import type { RuntimeEventMessage, RuntimeLogEntry, RuntimeStatus, WorkspaceOpenTarget, WorkspacePathOpenTarget, WorkspaceState } from "../shared";
import type {
  Approval,
  AutomationRecord,
  ConfigPatch,
  EffectiveConfig,
  McpServersResponse,
  ModelsResponse,
  RuntimeEvent,
  SkillsResponse,
  TaskSummary,
  TasksResponse,
  ThreadDetail,
  ThreadSummary,
  TurnItemRecord,
  UsageResponse,
  WorkspaceFile,
  WorkspaceSearch,
  WorkspaceTree
} from "./types";

type View = "threads" | "tasks" | "automations" | "settings";

function viewFromQuery(value: string | null): View {
  return value === "tasks" || value === "automations" || value === "settings" ? value : "threads";
}

const MAX_LOGS = 160;
const PINNED_WORKSPACES_KEY = "deepseek-app:pinned-workspaces";
const WORKSPACE_ALIASES_KEY = "deepseek-app:workspace-aliases";
const HIDDEN_THREADS_KEY = "deepseek-app:hidden-threads";
const HIDDEN_WORKSPACES_KEY = "deepseek-app:hidden-workspaces";
const WORKSPACE_ORDER_KEY = "deepseek-app:workspace-order";
const THREAD_PREFERENCES_KEY = "deepseek-app:thread-preferences";
const LIVE_TURN_STATUSES = new Set(["queued", "running", "in_progress"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "canceled"]);

type ThreadPreference = {
  model?: string;
  mode?: string;
  reasoningEffort?: string;
};

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readPinnedWorkspaces() {
  try {
    const raw = window.localStorage.getItem(PINNED_WORKSPACES_KEY);
    const values = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writePinnedWorkspaces(values: Set<string>) {
  window.localStorage.setItem(PINNED_WORKSPACES_KEY, JSON.stringify([...values]));
}

function readWorkspaceAliases(): WorkspaceAliases {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ALIASES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && entry[1].trim().length > 0
      )
    );
  } catch {
    return {};
  }
}

function writeWorkspaceAliases(values: WorkspaceAliases) {
  window.localStorage.setItem(WORKSPACE_ALIASES_KEY, JSON.stringify(values));
}

function readStringSet(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    const values = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeStringSet(key: string, values: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...values]));
}

function sanitizeThreadPreference(value: unknown): ThreadPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const preference: ThreadPreference = {};
  if (typeof input.model === "string" && input.model.trim()) {
    preference.model = input.model;
  }
  if (typeof input.mode === "string" && input.mode.trim()) {
    preference.mode = input.mode;
  }
  if (typeof input.reasoningEffort === "string" && input.reasoningEffort.trim()) {
    preference.reasoningEffort = input.reasoningEffort;
  }
  return preference;
}

function readThreadPreferences(): Record<string, ThreadPreference> {
  try {
    const raw = window.localStorage.getItem(THREAD_PREFERENCES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([threadId, value]) => [threadId, sanitizeThreadPreference(value)] as const)
        .filter((entry) => entry[0].trim() && Object.keys(entry[1]).length > 0)
    );
  } catch {
    return {};
  }
}

function writeThreadPreferences(values: Record<string, ThreadPreference>) {
  window.localStorage.setItem(THREAD_PREFERENCES_KEY, JSON.stringify(values));
}

function isSmokeTask(task: TaskSummary) {
  return /runtime smoke task/i.test(task.prompt_summary);
}

function visibleTaskList(tasks: TaskSummary[]) {
  return tasks.filter((task) => !isSmokeTask(task));
}

function countTaskList(tasks: TaskSummary[]): TasksResponse["counts"] {
  return tasks.reduce<TasksResponse["counts"]>(
    (counts, task) => {
      if (task.status === "queued") {
        counts.queued += 1;
      } else if (task.status === "running") {
        counts.running += 1;
      } else if (task.status === "completed") {
        counts.completed += 1;
      } else if (task.status === "failed") {
        counts.failed += 1;
      } else if (task.status === "canceled") {
        counts.canceled += 1;
      }
      return counts;
    },
    { queued: 0, running: 0, completed: 0, failed: 0, canceled: 0 }
  );
}

function readHiddenWorkspaces() {
  return readStringSet(HIDDEN_WORKSPACES_KEY);
}

function readWorkspaceOrder() {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ORDER_KEY);
    const values = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map(normalizeWorkspacePath)
      : [];
  } catch {
    return [];
  }
}

function writeWorkspaceOrder(values: string[]) {
  window.localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify(values));
}

function readVisibleWorkspaceOrder(hiddenWorkspaceKeys: ReadonlySet<string>) {
  return filterVisibleWorkspaces(readWorkspaceOrder(), hiddenWorkspaceKeys);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(valueMs: number) {
  if (valueMs < 1000) {
    return "<1s";
  }
  const seconds = Math.round(valueMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatNumber(value?: number | null) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function formatBytes(value?: number | null) {
  const bytes = value ?? 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusText(value?: string | null) {
  if (!value) {
    return "unknown";
  }
  return value.replaceAll("_", " ");
}

function shortPath(value?: string | null) {
  return compactWorkspacePath(value);
}

function workspaceName(value?: string | null, aliases?: WorkspaceAliases) {
  return workspaceDisplayName(value, aliases);
}

function threadPreviewText(thread: ThreadSummary) {
  const title = thread.title?.trim() || "未命名会话";
  const preview = thread.preview?.trim();
  return preview && preview !== title ? preview : thread.model;
}

function compactModelLabel(value?: string | null) {
  const model = value?.trim();
  if (!model) {
    return "模型";
  }
  const leaf = model.split("/").pop() ?? model;
  return leaf.replace(/^deepseek-/, "");
}

function keySourceText(value?: string | null) {
  if (!value || value === "none" || value === "missing") {
    return "未配置";
  }
  if (value === "env") {
    return "环境变量";
  }
  if (value === "config") {
    return "配置文件";
  }
  return value;
}

function itemTone(kind: string, status: string) {
  if (status === "failed" || kind === "error") {
    return "danger";
  }
  if (kind.includes("tool") || kind.includes("command")) {
    return "amber";
  }
  if (kind.includes("reasoning")) {
    return "violet";
  }
  if (kind.includes("file")) {
    return "blue";
  }
  return "green";
}

function asEventName(message: RuntimeEventMessage) {
  if (typeof message.data === "object" && message.data && "event" in message.data) {
    const event = (message.data as { event?: unknown }).event;
    if (typeof event === "string" && event.trim()) {
      return event;
    }
  }
  return message.event;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function eventRecord(data: unknown): RuntimeEvent | null {
  return asRecord(data) as RuntimeEvent | null;
}

function eventPayload(data: unknown): Record<string, unknown> | null {
  const record = eventRecord(data);
  return asRecord(record?.payload);
}

function itemFromEventData(data: unknown): TurnItemRecord | null {
  const item = eventPayload(data)?.item;
  return asRecord(item) as TurnItemRecord | null;
}

function deltaFromEventData(data: unknown) {
  const payload = eventPayload(data);
  const delta = payload?.delta;
  return typeof delta === "string" ? delta : "";
}

function eventItemId(data: unknown) {
  const record = eventRecord(data);
  return typeof record?.item_id === "string" ? record.item_id : null;
}

function mergeTurnItem(items: TurnItemRecord[], item: TurnItemRecord) {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function applyThreadEvent(detail: ThreadDetail | null, eventName: string, data: unknown): ThreadDetail | null {
  if (!detail) {
    return detail;
  }
  if (eventName === "item.started" || eventName === "item.completed" || eventName === "item.failed") {
    const item = itemFromEventData(data);
    return item ? { ...detail, items: mergeTurnItem(detail.items, item) } : detail;
  }
  if (eventName === "item.delta") {
    const itemId = eventItemId(data);
    const delta = deltaFromEventData(data);
    if (!itemId || !delta) {
      return detail;
    }
    return {
      ...detail,
      items: detail.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              detail: `${item.detail ?? ""}${delta}`,
              summary: `${item.summary ?? ""}${delta}`.slice(0, 180)
            }
          : item
      )
    };
  }
  return detail;
}

function isMarkdownBlockStart(line: string) {
  return /^(#{1,4}\s+|[-*]\s+|>\s+|```)/.test(line.trim());
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownTableSeparator(line: string, columnCount: number) {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function isMarkdownTableStart(lines: string[], index: number) {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  if (!header.includes("|")) {
    return false;
  }
  const columns = splitMarkdownTableRow(header);
  return columns.length >= 2 && isMarkdownTableSeparator(separator, columns.length);
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let nodeIndex = 0;
  const pushText = (value: string) => {
    if (value) {
      nodes.push(value);
    }
  };

  while (index < text.length) {
    if (text.startsWith("`", index)) {
      const end = text.indexOf("`", index + 1);
      if (end > index) {
        nodes.push(<code key={`${keyPrefix}-code-${nodeIndex++}`}>{text.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${nodeIndex++}`}>
            {renderInlineMarkdown(text.slice(index + 2, end), `${keyPrefix}-strong-${nodeIndex}`)}
          </strong>
        );
        index = end + 2;
        continue;
      }
    }
    if (text.startsWith("[", index)) {
      const labelEnd = text.indexOf("]", index + 1);
      const hrefStart = labelEnd >= 0 ? text.indexOf("(", labelEnd + 1) : -1;
      const hrefEnd = hrefStart >= 0 ? text.indexOf(")", hrefStart + 1) : -1;
      if (labelEnd > index && hrefStart === labelEnd + 1 && hrefEnd > hrefStart) {
        const href = text.slice(hrefStart + 1, hrefEnd);
        if (/^https?:\/\//i.test(href)) {
          nodes.push(
            <a href={href} key={`${keyPrefix}-link-${nodeIndex++}`} rel="noreferrer" target="_blank">
              {renderInlineMarkdown(text.slice(index + 1, labelEnd), `${keyPrefix}-link-${nodeIndex}`)}
            </a>
          );
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    const nextSpecial = ["`", "**", "["]
      .map((token) => text.indexOf(token, index + 1))
      .filter((position) => position >= 0)
      .sort((a, b) => a - b)[0];
    const next = nextSpecial ?? text.length;
    pushText(text.slice(index, next));
    index = next;
  }

  return nodes;
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          {fence[1] ? <span className="markdown-code-lang">{fence[1]}</span> : null}
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min((heading[1] ?? "#").length, 4);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(<Tag key={`heading-${blocks.length}`}>{renderInlineMarkdown(heading[2] ?? "", `heading-${blocks.length}`)}</Tag>);
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const headers = splitMarkdownTableRow(lines[index] ?? "");
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (!current.trim() || !current.includes("|") || isMarkdownBlockStart(current)) {
          break;
        }
        const row = splitMarkdownTableRow(current);
        if (row.length < 2) {
          break;
        }
        rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
        index += 1;
      }
      blocks.push(
        <div className="markdown-table-wrap" key={`table-${blocks.length}`}>
          <table>
            <thead>
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`${cellIndex}:${header}`}>{renderInlineMarkdown(header, `table-${blocks.length}-head-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, `table-${blocks.length}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").trim().match(/^[-*]\s+(.+)$/);
        if (!item) {
          break;
        }
        items.push(item[1] ?? "");
        index += 1;
      }
      blocks.push(
        <ul key={`list-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}:${item}`}>{renderInlineMarkdown(item, `list-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^>\s+/.test(trimmed)) {
      const quote: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").trim().match(/^>\s+(.+)$/);
        if (!item) {
          break;
        }
        quote.push(item[1] ?? "");
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineMarkdown(quote.join(" "), `quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim() || isMarkdownBlockStart(current) || isMarkdownTableStart(lines, index)) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(" "), `p-${blocks.length}`)}</p>);
  }

  return <div className="markdown-content">{blocks}</div>;
}

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const fixtureName = queryParams.get("fixture");
  const initialView = viewFromQuery(queryParams.get("view"));
  const fixtureWorkspaceAlias = queryParams.get("workspace_alias")?.trim() ?? "";
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => new Set());
  const [pinnedWorkspaces, setPinnedWorkspaces] = useState<Set<string>>(() => readPinnedWorkspaces());
  const [workspaceAliases, setWorkspaceAliases] = useState<WorkspaceAliases>(() => readWorkspaceAliases());
  const [hiddenThreads, setHiddenThreads] = useState<Set<string>>(() => readStringSet(HIDDEN_THREADS_KEY));
  const [hiddenWorkspaces, setHiddenWorkspaces] = useState<Set<string>>(() => readHiddenWorkspaces());
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>(() => readVisibleWorkspaceOrder(hiddenWorkspaces));
  const [approvals, setApprovals] = useState<Approval[]>(() => fixtureApprovals(fixtureName));
  const [tasks, setTasks] = useState<TasksResponse | null>(() => fixtureTasks(fixtureName));
  const [automations, setAutomations] = useState<AutomationRecord[]>(() => fixtureAutomations(fixtureName));
  const [skills, setSkills] = useState<SkillsResponse | null>(null);
  const [mcp, setMcp] = useState<McpServersResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [filePreview, setFilePreview] = useState<WorkspaceFile | null>(null);
  const [searchResult, setSearchResult] = useState<WorkspaceSearch | null>(null);
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [expandedWorkspaceDirs, setExpandedWorkspaceDirs] = useState<Set<string>>(() => new Set());
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("medium");
  const [threadPreferences, setThreadPreferences] = useState<Record<string, ThreadPreference>>(() => readThreadPreferences());
  const [mode, setMode] = useState("agent");
  const [view, setView] = useState<View>(initialView);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draftConversationWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    return window.deepseekDesktop.onRuntimeLog((entry) => {
      setLogs((current) => [entry, ...current].slice(0, MAX_LOGS));
    });
  }, []);

  const refreshThreads = useCallback(async (workspaceOverride?: string | null, hiddenWorkspaceOverride?: ReadonlySet<string>) => {
    const effectiveHiddenWorkspaces = hiddenWorkspaceOverride ?? hiddenWorkspaces;
    const fixture = fixtureThreads(fixtureName);
    if (fixture.length) {
      setThreads(fixture);
      setSelectedThreadId((current) => current ?? fixture[0]?.id ?? null);
      return;
    }
    const rawThreads = await api.threads();
    const emptyThreads = rawThreads.filter(isEmptyPlaceholderThread);
    if (emptyThreads.length) {
      await Promise.allSettled(emptyThreads.map((thread) => api.archiveThread(thread.id)));
    }
    const next = rawThreads.filter(
      (thread) => !isEmptyPlaceholderThread(thread) && !hiddenThreads.has(thread.id) && !isHiddenWorkspace(thread.workspace, effectiveHiddenWorkspaces)
    );
    setThreads(next);
    setSelectedThreadId((current) => {
      const workspaceForSelection = workspaceOverride ?? activeWorkspace;
      return nextThreadSelectionAfterRefresh({
        activeThreadId: current,
        activeWorkspace: workspaceForSelection,
        preserveEmptySelection: sameWorkspacePath(draftConversationWorkspaceRef.current, workspaceForSelection),
        threads: next
      });
    });
  }, [activeWorkspace, fixtureName, hiddenThreads, hiddenWorkspaces]);

  const loadWorkspaceThreads = useCallback(async (workspacePath: string) => {
    if (!workspacePath || fixtureName) {
      return;
    }
    const rawThreads = await api.threads(workspacePath);
    const workspaceThreads = rawThreads.filter((thread) => sameWorkspacePath(thread.workspace, workspacePath));
    const emptyThreads = workspaceThreads.filter(isEmptyPlaceholderThread);
    if (emptyThreads.length) {
      await Promise.allSettled(emptyThreads.map((thread) => api.archiveThread(thread.id)));
    }
    const nextWorkspaceThreads = workspaceThreads.filter(
      (thread) => !isEmptyPlaceholderThread(thread) && !hiddenThreads.has(thread.id) && !isHiddenWorkspace(thread.workspace, hiddenWorkspaces)
    );
    setThreads((current) => [
      ...current.filter((thread) => !sameWorkspacePath(thread.workspace, workspacePath)),
      ...nextWorkspaceThreads
    ]);
  }, [fixtureName, hiddenThreads, hiddenWorkspaces]);

  const refreshSideData = useCallback(async () => {
    const [nextTasks, nextAutomations, nextSkills, nextMcp, nextUsage, nextTree] = await Promise.allSettled([
      api.tasks(),
      api.automations(),
      api.skills(),
      api.mcpServers(),
      api.usage(),
      api.workspaceTree()
    ]);
    if (nextTasks.status === "fulfilled") {
      setTasks(mergeFixtureTasks(fixtureName, nextTasks.value));
    }
    if (nextAutomations.status === "fulfilled") {
      setAutomations(mergeFixtureAutomations(fixtureName, nextAutomations.value));
    }
    if (nextSkills.status === "fulfilled") {
      setSkills(nextSkills.value);
    }
    if (nextMcp.status === "fulfilled") {
      setMcp(nextMcp.value);
    }
    if (nextUsage.status === "fulfilled") {
      setUsage(nextUsage.value);
    }
    if (nextTree.status === "fulfilled") {
      setTree(nextTree.value);
    }
  }, [fixtureName]);

  const refreshCore = useCallback(async (hiddenWorkspaceOverride?: ReadonlySet<string>) => {
    const effectiveHiddenWorkspaces = hiddenWorkspaceOverride ?? hiddenWorkspaces;
    setLoading(true);
    setError(null);
    try {
      const workspaceState = await api.workspaceCurrent();
      const visibleActiveWorkspace = isHiddenWorkspace(workspaceState.active, effectiveHiddenWorkspaces) ? null : workspaceState.active;
      setActiveWorkspace(visibleActiveWorkspace);
      setRecentWorkspaces((current) => mergeVisibleWorkspaces(current, workspaceState.recent, effectiveHiddenWorkspaces));
      setRuntime(await api.runtimeStatus());
      if (!visibleActiveWorkspace) {
        setConfig(null);
        setModels(null);
        setThreads([]);
        setSelectedThreadId(null);
        setThreadDetail(null);
        setTree(null);
        return;
      }
      const [nextConfig, nextModels] = await Promise.all([api.config(), api.models()]);
      setRuntime(await api.runtimeStatus());
      setConfig(nextConfig);
      setModels(nextModels);
      setSelectedModel(nextConfig.default_model);
      await Promise.all([refreshThreads(visibleActiveWorkspace, effectiveHiddenWorkspaces), refreshSideData()]);
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setLoading(false);
    }
  }, [hiddenWorkspaces, refreshSideData, refreshThreads]);

  useEffect(() => {
    void refreshCore();
  }, [refreshCore]);

  useEffect(() => {
    if (!fixtureWorkspaceAlias || !activeWorkspace) {
      return;
    }
    setWorkspaceAliases((current) => {
      const key = workspaceKey(activeWorkspace);
      if (current[key] === fixtureWorkspaceAlias) {
        return current;
      }
      const next = { ...current, [key]: fixtureWorkspaceAlias };
      writeWorkspaceAliases(next);
      return next;
    });
  }, [activeWorkspace, fixtureWorkspaceAlias]);

  const discoveredWorkspaces = useMemo(() => {
    const values = [
      ...recentWorkspaces,
      ...threads.map((thread) => thread.workspace),
      tree?.root,
      activeWorkspace
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const normalized = normalizeWorkspacePath(value);
      const key = workspaceKey(normalized);
      if (key && !seen.has(key)) {
        if (!hiddenWorkspaces.has(key)) {
          seen.add(key);
          out.push(normalized);
        }
      }
    }
    return out;
  }, [activeWorkspace, hiddenWorkspaces, recentWorkspaces, threads, tree?.root]);

  useEffect(() => {
    if (!discoveredWorkspaces.length) {
      return;
    }
    setWorkspaceOrder((current) => {
      const discoveredKeys = new Set(discoveredWorkspaces.map(workspaceKey));
      const next = current.filter((path) => discoveredKeys.has(workspaceKey(path)));
      for (const workspace of discoveredWorkspaces) {
        if (!next.some((path) => sameWorkspacePath(path, workspace))) {
          next.push(workspace);
        }
      }
      if (next.length === current.length && next.every((path, index) => path === current[index])) {
        return current;
      }
      writeWorkspaceOrder(next);
      return next;
    });
  }, [discoveredWorkspaces]);

  useEffect(() => {
    if (fixtureName || !activeWorkspace || (config && models)) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshCore();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, config, fixtureName, models, refreshCore]);

  useEffect(() => {
    if (!activeWorkspace || fixtureName) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshThreads().catch(() => undefined);
      void refreshSideData().catch(() => undefined);
      void api
        .runtimeStatus()
        .then((nextRuntime) => setRuntime(nextRuntime))
        .catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, fixtureName, refreshSideData, refreshThreads]);

  useEffect(() => {
    setExpandedWorkspaceDirs(new Set());
  }, [config?.workspace]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThreadDetail(null);
      return undefined;
    }
    const fixtureDetail = fixtureThreadDetail(fixtureName);
    if (fixtureDetail && fixtureDetail.thread.id === selectedThreadId) {
      setThreadDetail(fixtureDetail);
      return undefined;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const handleThreadEvent = (message: RuntimeEventMessage) => {
      const eventName = asEventName(message);
      setThreadDetail((current) => applyThreadEvent(current, eventName, message.data));
      const approval = approvalFromEvent(eventName, message.data);
      if (approval) {
        setApprovals((current) =>
          current.some((item) => item.approvalId === approval.approvalId) ? current : [approval, ...current]
        );
      }
      if (eventName === "turn.completed" || eventName === "turn.failed" || eventName === "turn.interrupted") {
        void refreshThreads();
        void refreshSideData();
        void api
          .getThread(selectedThreadId)
          .then((detail) => {
            if (!cancelled) {
              setThreadDetail(detail);
            }
          })
          .catch((nextError) => {
            if (!cancelled) {
              setError(compactError(nextError));
            }
          });
      }
    };
    void api
      .getThread(selectedThreadId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setThreadDetail(detail);
        unsubscribe = api.subscribeThreadEvents(selectedThreadId, handleThreadEvent, detail.latest_seq ?? 0);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(compactError(nextError));
        }
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [fixtureName, refreshSideData, refreshThreads, selectedThreadId]);

  const fixtureMode = fixtureName === "approval" || fixtureName === "activity";
  const activityFixtureMode = fixtureName === "activity";

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  const rememberThreadPreference = useCallback((threadId: string, patch: ThreadPreference) => {
    const cleanPatch = sanitizeThreadPreference(patch);
    if (!Object.keys(cleanPatch).length) {
      return;
    }
    setThreadPreferences((current) => {
      const next = {
        ...current,
        [threadId]: {
          ...current[threadId],
          ...cleanPatch
        }
      };
      writeThreadPreferences(next);
      return next;
    });
  }, []);

  const threadRuntimePatch = useCallback(
    (preference: ThreadPreference) => {
      const patch: Record<string, unknown> = {};
      if (preference.model) {
        patch.model = preference.model;
      }
      if (preference.mode) {
        const yoloMode = preference.mode === "yolo";
        const planMode = preference.mode === "plan";
        patch.mode = preference.mode;
        patch.allow_shell = yoloMode ? true : planMode ? false : config?.allow_shell;
        patch.trust_mode = yoloMode;
        patch.auto_approve = yoloMode;
      }
      return patch;
    },
    [config?.allow_shell]
  );

  const persistThreadRuntimePreference = useCallback(
    (threadId: string, preference: ThreadPreference) => {
      const patch = threadRuntimePatch(preference);
      if (!Object.keys(patch).length || fixtureMode) {
        return;
      }
      void api.updateThread(threadId, patch).catch((nextError) => setError(compactError(nextError)));
    },
    [fixtureMode, threadRuntimePatch]
  );

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedModel(config?.default_model ?? "");
      setSelectedReasoningEffort(config?.reasoning_effort ?? "medium");
      return;
    }
    const runtimeThread = threadDetail?.thread?.id === selectedThreadId ? threadDetail.thread : activeThread;
    const preference = threadPreferences[selectedThreadId] ?? {};
    setSelectedModel(preference.model ?? runtimeThread?.model ?? config?.default_model ?? "");
    setMode(preference.mode ?? runtimeThread?.mode ?? "agent");
    setSelectedReasoningEffort(preference.reasoningEffort ?? config?.reasoning_effort ?? "medium");
  }, [
    activeThread,
    config?.default_model,
    config?.reasoning_effort,
    selectedThreadId,
    threadDetail?.thread,
    threadPreferences
  ]);

  const activeTurnId = useMemo(() => {
    if (threadDetail?.turns.length) {
      return threadDetail.turns[threadDetail.turns.length - 1]?.id ?? activeThread?.latest_turn_id ?? null;
    }
    return activeThread?.latest_turn_id ?? null;
  }, [activeThread?.latest_turn_id, threadDetail?.turns]);

  const sendPrompt = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) {
      return;
    }
    if (!activeWorkspace) {
      setError("请先选择项目");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let threadId = selectedThreadId;
      const currentModel = selectedModel || config?.default_model;
      const currentReasoningEffort = selectedReasoningEffort || config?.reasoning_effort || "medium";
      if (!threadId) {
        const yoloMode = mode === "yolo";
        const created = await api.createThread({
          model: currentModel,
          workspace: activeWorkspace,
          mode,
          allow_shell: yoloMode ? true : config?.allow_shell,
          trust_mode: yoloMode ? true : undefined,
          auto_approve: yoloMode ? true : undefined
        });
        threadId = created.id;
        draftConversationWorkspaceRef.current = null;
        setSelectedThreadId(threadId);
        rememberThreadPreference(threadId, {
          model: currentModel,
          mode,
          reasoningEffort: currentReasoningEffort
        });
      }
      const yoloMode = mode === "yolo";
      rememberThreadPreference(threadId, {
        model: currentModel,
        mode,
        reasoningEffort: currentReasoningEffort
      });
      const runtimePatch = threadRuntimePatch({ model: currentModel, mode });
      if (!fixtureMode && Object.keys(runtimePatch).length) {
        await api.updateThread(threadId, runtimePatch);
      }
      const started = await api.startTurn(threadId, text, {
        model: currentModel,
        mode,
        allow_shell: yoloMode ? true : config?.allow_shell,
        trust_mode: yoloMode ? true : undefined,
        auto_approve: yoloMode ? true : undefined,
        reasoning_effort: currentReasoningEffort
      });
      setPrompt("");
      const detail = await api.getThread(threadId);
      setThreadDetail({
        ...detail,
        thread: started.thread,
        turns: [...detail.turns.filter((turn) => turn.id !== started.turn.id), started.turn]
      });
      await refreshThreads();
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const startNewConversation = () => {
    draftConversationWorkspaceRef.current = activeWorkspace;
    setSelectedThreadId(null);
    setThreadDetail(null);
    setPrompt("");
    setFilePreview(null);
    setSearchResult(null);
    setView("threads");
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const text = taskPrompt.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createTask(text);
      setTaskPrompt("");
      setTasks(await api.tasks());
      setView("tasks");
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const decideApproval = async (approvalId: string, decision: "allow" | "deny", remember = false) => {
    setApprovals((current) =>
      current.map((approval) =>
        approval.approvalId === approvalId
          ? { ...approval, status: decision === "allow" ? "allowed" : "denied" }
          : approval
      )
    );
    if (fixtureMode) {
      return;
    }
    try {
      await api.decideApproval(approvalId, decision, remember);
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const cancelTask = async (id: string) => {
    if (activityFixtureMode) {
      setTasks((current) => cancelFixtureTask(current, id));
      return;
    }
    await api.cancelTask(id);
    setTasks(await api.tasks());
  };

  const deleteTask = async (id: string) => {
    if (activityFixtureMode) {
      setTasks((current) => {
        if (!current) {
          return current;
        }
        const nextTasks = current.tasks.filter((task) => task.id !== id);
        return { tasks: nextTasks, counts: countTaskList(nextTasks) };
      });
      return;
    }
    await api.deleteTask(id);
    setTasks(await api.tasks());
  };

  const clearTasks = async (filter: "terminal" | "smoke") => {
    const candidates = (tasks?.tasks ?? []).filter((task) => {
      if (filter === "smoke") {
        return isSmokeTask(task) && task.status !== "running";
      }
      return TERMINAL_TASK_STATUSES.has(task.status);
    });
    if (!candidates.length) {
      return;
    }
    if (activityFixtureMode) {
      const removeIds = new Set(candidates.map((task) => task.id));
      setTasks((current) => {
        if (!current) {
          return current;
        }
        const nextTasks = current.tasks.filter((task) => !removeIds.has(task.id));
        return { tasks: nextTasks, counts: countTaskList(nextTasks) };
      });
      return;
    }
    await Promise.allSettled(candidates.map((task) => api.deleteTask(task.id)));
    setTasks(await api.tasks());
  };

  const openTaskThread = async (threadId: string) => {
    draftConversationWorkspaceRef.current = null;
    setError(null);
    try {
      const detail = await api.getThread(threadId);
      const workspace = detail.thread.workspace;
      if (workspace && !sameWorkspacePath(workspace, activeWorkspace)) {
        await switchWorkspace(workspace, threadId);
        return;
      }
      setSelectedThreadId(threadId);
      setThreadDetail(detail);
      setView("threads");
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const runAutomationAction = async (id: string, action: "pause" | "resume" | "run") => {
    if (activityFixtureMode) {
      setAutomations((current) => applyFixtureAutomationAction(current, id, action));
      return;
    }
    await api.automationAction(id, action);
    setAutomations(await api.automations());
  };

  const interruptActiveTurn = async () => {
    if (!selectedThreadId || !activeTurnId) {
      return;
    }
    setBusy(true);
    try {
      await api.interruptTurn(selectedThreadId, activeTurnId);
      await refreshThreads();
      setThreadDetail(await api.getThread(selectedThreadId));
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const restartRuntime = async () => {
    setBusy(true);
    try {
      setRuntime(await api.restartRuntime());
      await refreshCore();
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const openWorkspaceFile = async (path: string) => {
    try {
      setFilePreview(await api.workspaceFile(path));
      setView("threads");
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const toggleWorkspaceDirectory = useCallback((path: string) => {
    setExpandedWorkspaceDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const searchWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    const query = workspaceQuery.trim();
    if (!query) {
      setSearchResult(null);
      return;
    }
    try {
      setSearchResult(await api.workspaceSearch(query));
      setView("threads");
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const applyWorkspaceState = (state: WorkspaceState, options?: { revealActive?: boolean }) => {
    draftConversationWorkspaceRef.current = null;
    const nextHiddenWorkspaces = options?.revealActive ? revealWorkspaceKey(hiddenWorkspaces, state.active) : hiddenWorkspaces;
    if (nextHiddenWorkspaces !== hiddenWorkspaces) {
      const writableHiddenWorkspaces = new Set(nextHiddenWorkspaces);
      setHiddenWorkspaces(writableHiddenWorkspaces);
      writeStringSet(HIDDEN_WORKSPACES_KEY, writableHiddenWorkspaces);
    }
    const visibleActiveWorkspace = isHiddenWorkspace(state.active, nextHiddenWorkspaces) ? null : state.active;
    const incomingWorkspaces = state.active ? [state.active, ...state.recent] : state.recent;
    setActiveWorkspace(visibleActiveWorkspace);
    setRecentWorkspaces((current) => mergeVisibleWorkspaces(current, incomingWorkspaces, nextHiddenWorkspaces));
    setSelectedThreadId(null);
    setThreadDetail(null);
    setFilePreview(null);
    setSearchResult(null);
    setExpandedWorkspaceDirs(new Set());
    return nextHiddenWorkspaces;
  };

  const chooseWorkspace = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextHiddenWorkspaces = applyWorkspaceState(await api.workspaceChooseDirectory(), { revealActive: true });
      await refreshCore(nextHiddenWorkspaces);
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const switchWorkspace = async (workspacePath: string, nextThreadId?: string) => {
    draftConversationWorkspaceRef.current = null;
    if (sameWorkspacePath(workspacePath, activeWorkspace)) {
      if (nextThreadId) {
        setSelectedThreadId(nextThreadId);
        setView("threads");
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextHiddenWorkspaces = applyWorkspaceState(await api.workspaceSwitch(workspacePath), { revealActive: true });
      await refreshCore(nextHiddenWorkspaces);
      if (nextThreadId) {
        setSelectedThreadId(nextThreadId);
        setView("threads");
      }
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const togglePinnedWorkspace = (workspacePath = activeWorkspace) => {
    if (!workspacePath) {
      return;
    }
    setPinnedWorkspaces((current) => {
      const next = new Set(current);
      const existing = [...next].find((path) => sameWorkspacePath(path, workspacePath));
      if (existing) {
        next.delete(existing);
      } else {
        next.add(workspacePath);
      }
      writePinnedWorkspaces(next);
      return next;
    });
  };

  const hideWorkspaceFromUi = (workspacePath: string) => {
    if (!workspacePath) {
      return;
    }
    setHiddenWorkspaces((current) => {
      const next = new Set(current);
      next.add(workspaceKey(workspacePath));
      writeStringSet(HIDDEN_WORKSPACES_KEY, next);
      return next;
    });
    setRecentWorkspaces((current) => current.filter((path) => !sameWorkspacePath(path, workspacePath)));
    setWorkspaceOrder((current) => current.filter((path) => !sameWorkspacePath(path, workspacePath)));
    setCollapsedWorkspaces((current) => {
      const next = new Set(current);
      next.delete(workspacePath);
      return next;
    });
    if (sameWorkspacePath(workspacePath, activeWorkspace)) {
      setActiveWorkspace(null);
      setSelectedThreadId(null);
      setThreadDetail(null);
      setConfig(null);
      setModels(null);
      setTree(null);
      setSearchResult(null);
      setFilePreview(null);
    }
  };

  const openWorkspaceWith = async (target: WorkspaceOpenTarget) => {
    setError(null);
    try {
      const result = await api.workspaceOpen(target);
      if (!result.ok) {
        setError(result.message ?? "打开项目失败");
      }
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const openWorkspacePath = async (path: string, target: WorkspacePathOpenTarget) => {
    setError(null);
    try {
      const result = await api.workspaceOpenPath(path, target);
      if (!result.ok) {
        setError(result.message ?? "打开路径失败");
      }
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const createPermanentWorktree = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextHiddenWorkspaces = applyWorkspaceState(await api.workspaceCreateWorktree(), { revealActive: true });
      await refreshCore(nextHiddenWorkspaces);
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const renameWorkspace = (workspacePath = activeWorkspace) => {
    if (!workspacePath) {
      return;
    }
    const currentName = workspaceDisplayName(workspacePath, workspaceAliases);
    const defaultName = workspaceDisplayName(workspacePath);
    const nextName = window.prompt("重命名项目", currentName);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    setWorkspaceAliases((current) => {
      const key = workspaceKey(workspacePath);
      const next = { ...current };
      if (!trimmed || trimmed === defaultName) {
        delete next[key];
      } else {
        next[key] = trimmed;
      }
      writeWorkspaceAliases(next);
      return next;
    });
  };

  const removeThreadFromUi = (threadId: string) => {
    if (!threadId) {
      return;
    }
    const nextSelectedThreadId = nextThreadSelectionAfterRemoval(threads, threadId, selectedThreadId);
    setHiddenThreads((current) => {
      const next = new Set(current);
      next.add(threadId);
      writeStringSet(HIDDEN_THREADS_KEY, next);
      return next;
    });
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (nextSelectedThreadId !== selectedThreadId) {
      setSelectedThreadId(nextSelectedThreadId);
      setThreadDetail(null);
    }
  };

  const deleteThread = async (threadId: string) => {
    if (!threadId) {
      return;
    }
    const confirmed = window.confirm("删除会话会移除该会话的本地记录、turn、事件和条目。该操作不会删除项目文件。是否继续？");
    if (!confirmed) {
      return;
    }
    const nextSelectedThreadId = nextThreadSelectionAfterRemoval(threads, threadId, selectedThreadId);
    setBusy(true);
    setError(null);
    try {
      if (!fixtureMode) {
        await api.deleteThread(threadId);
      }
      setHiddenThreads((current) => {
        const next = new Set(current);
        next.delete(threadId);
        writeStringSet(HIDDEN_THREADS_KEY, next);
        return next;
      });
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      if (nextSelectedThreadId !== selectedThreadId) {
        setSelectedThreadId(nextSelectedThreadId);
        setThreadDetail(null);
      }
      await refreshThreads(activeWorkspace);
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const reorderWorkspace = useCallback((sourcePath: string, targetPath: string) => {
    if (sameWorkspacePath(sourcePath, targetPath)) {
      return;
    }
    setWorkspaceOrder((current) => {
      const merged = [...current];
      for (const workspace of discoveredWorkspaces) {
        if (!merged.some((path) => sameWorkspacePath(path, workspace))) {
          merged.push(workspace);
        }
      }
      const sourceIndex = merged.findIndex((path) => sameWorkspacePath(path, sourcePath));
      const targetIndex = merged.findIndex((path) => sameWorkspacePath(path, targetPath));
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current;
      }
      const next = [...merged];
      const [source] = next.splice(sourceIndex, 1);
      if (!source) {
        return current;
      }
      next.splice(targetIndex, 0, source);
      writeWorkspaceOrder(next);
      return next;
    });
  }, [discoveredWorkspaces]);

  const archiveThread = async (threadId: string) => {
    if (!threadId) {
      return;
    }
    const nextSelectedThreadId = nextThreadSelectionAfterRemoval(threads, threadId, selectedThreadId);
    setBusy(true);
    setError(null);
    try {
      await api.archiveThread(threadId);
      if (nextSelectedThreadId !== selectedThreadId) {
        setSelectedThreadId(nextSelectedThreadId);
        setThreadDetail(null);
      }
      await refreshThreads(activeWorkspace);
    } catch (nextError) {
      setError(compactError(nextError));
    } finally {
      setBusy(false);
    }
  };

  const toggleWorkspaceGroup = useCallback((workspacePath: string) => {
    setCollapsedWorkspaces((current) => {
      const next = new Set(current);
      if (next.has(workspacePath)) {
        next.delete(workspacePath);
      } else {
        next.add(workspacePath);
      }
      return next;
    });
  }, []);

  const patchConfig = async (patch: ConfigPatch) => {
    try {
      const next = await api.patchConfig(patch);
      setConfig(next);
      setSelectedModel(next.default_model);
      setSelectedReasoningEffort(next.reasoning_effort);
      setMode((current) => {
        if (next.yolo) {
          return "yolo";
        }
        return current === "yolo" ? "agent" : current;
      });
    } catch (nextError) {
      setError(compactError(nextError));
    }
  };

  const changeSelectedModel = (nextModel: string) => {
    setSelectedModel(nextModel);
    if (selectedThreadId) {
      rememberThreadPreference(selectedThreadId, { model: nextModel });
      persistThreadRuntimePreference(selectedThreadId, { model: nextModel });
    }
  };

  const changeReasoningEffort = (nextReasoningEffort: string) => {
    setSelectedReasoningEffort(nextReasoningEffort);
    if (selectedThreadId) {
      rememberThreadPreference(selectedThreadId, { reasoningEffort: nextReasoningEffort });
    }
  };

  const changeMode = (nextMode: string) => {
    setMode(nextMode);
    if (selectedThreadId) {
      rememberThreadPreference(selectedThreadId, { mode: nextMode });
      persistThreadRuntimePreference(selectedThreadId, { mode: nextMode });
    }
  };

  const modelOptions = models?.models ?? [];
  const pendingApprovals = approvals.filter(
    (approval) => approval.status === "pending" && (!approval.turnId || approval.turnId === activeTurnId)
  );
  const visibleApprovals = pendingApprovals.filter((approval) =>
    shouldShowApprovalComposer({ approval, config, mode, thread: threadDetail?.thread ?? null })
  );
  const primaryApproval = visibleApprovals[0] ?? null;
  const inspectorCollapsed = railCollapsed || view === "settings";
  const apiKeyMissing = config?.api_key_source === "missing" || config?.api_key_source === "none";

  return (
    <div className={`app-shell ${inspectorCollapsed ? "inspector-collapsed" : ""}`}>
      <Sidebar
        activeThreadId={selectedThreadId}
        activeWorkspace={activeWorkspace}
        automations={automations}
        collapsedWorkspaces={collapsedWorkspaces}
        currentView={view}
        onArchiveThread={(id) => void archiveThread(id)}
        onDeleteThread={(id) => void deleteThread(id)}
        onNewThread={startNewConversation}
        onRemoveThread={removeThreadFromUi}
        onRemoveWorkspace={hideWorkspaceFromUi}
        onSwitchWorkspace={(workspacePath) => void switchWorkspace(workspacePath)}
        onLoadWorkspaceThreads={(workspacePath) => void loadWorkspaceThreads(workspacePath)}
        onToggleWorkspaceGroup={toggleWorkspaceGroup}
        onRenameWorkspace={renameWorkspace}
        onTogglePinnedWorkspace={togglePinnedWorkspace}
        onWorkspaceReorder={reorderWorkspace}
        onWorkspaceChoose={() => void chooseWorkspace()}
        onSelectThread={(id, workspace) => {
          draftConversationWorkspaceRef.current = null;
          if (workspace && !sameWorkspacePath(workspace, activeWorkspace)) {
            void switchWorkspace(workspace, id);
            return;
          }
          setSelectedThreadId(id);
          setView("threads");
        }}
        onViewChange={setView}
        pinnedWorkspaces={pinnedWorkspaces}
        tasks={visibleTaskList(tasks?.tasks ?? [])}
        threads={threads}
        tree={tree}
        workspaceAliases={workspaceAliases}
        workspaceOrder={workspaceOrder}
        workspaces={recentWorkspaces}
      />

      <main className="main-surface">
        <TopBar
          activeWorkspace={activeWorkspace}
          busy={busy || loading}
          config={config}
          error={error}
          runtime={runtime}
          workspaceAliases={workspaceAliases}
        />
        {apiKeyMissing ? (
          <div className="notice danger">
            <KeyRound size={18} />
            <span>未检测到 API key。当前可浏览本地状态，发送消息前请在设置中配置密钥来源。</span>
            <button type="button" onClick={() => setView("settings")}>
              打开设置
            </button>
          </div>
        ) : null}
        {view === "settings" ? (
          <SettingsView
            config={config}
            logs={logs}
            mcp={mcp}
            modelOptions={modelOptions}
            onPatch={patchConfig}
            onRestart={() => void restartRuntime()}
            onSkillToggle={async (name, enabled) => {
              await api.setSkill(name, enabled);
              setSkills(await api.skills());
            }}
            runtime={runtime}
            selectedModel={selectedModel}
            skills={skills}
            usage={usage}
          />
        ) : (
          <ThreadWorkspace
            activeWorkspace={activeWorkspace}
            automations={automations}
            apiKeyMissing={apiKeyMissing}
            busy={busy}
            config={config}
            createTask={createTask}
            filePreview={filePreview}
            modelOptions={modelOptions}
            mode={mode}
            onArchiveThread={(id) => void archiveThread(id)}
            onApproval={decideApproval}
            onAutomationAction={runAutomationAction}
            onCancelTask={cancelTask}
            onClearTasks={(filter) => void clearTasks(filter)}
            onCloseFile={() => setFilePreview(null)}
            onCreateWorktree={() => void createPermanentWorktree()}
            onInterrupt={() => void interruptActiveTurn()}
            onOpenFile={openWorkspaceFile}
            onOpenSettings={() => setView("settings")}
            onOpenTaskThread={(threadId) => void openTaskThread(threadId)}
            onRemoveThread={removeThreadFromUi}
            onRemoveWorkspace={activeWorkspace ? () => hideWorkspaceFromUi(activeWorkspace) : undefined}
            onDeleteThread={(id) => void deleteThread(id)}
            onDeleteTask={(id) => void deleteTask(id)}
            onRenameWorkspace={renameWorkspace}
            onTogglePinnedWorkspace={togglePinnedWorkspace}
            onWorkspaceOpen={(target) => void openWorkspaceWith(target)}
            onWorkspaceChoose={() => void chooseWorkspace()}
            pinnedWorkspace={Boolean(activeWorkspace && pinnedWorkspaces.has(activeWorkspace))}
            onSendPrompt={sendPrompt}
            pendingApproval={primaryApproval}
            prompt={prompt}
            searchResult={searchResult}
            selectedThread={activeThread}
            selectedModel={selectedModel}
            selectedReasoningEffort={selectedReasoningEffort}
            setMode={changeMode}
            setSelectedModel={changeSelectedModel}
            setSelectedReasoningEffort={changeReasoningEffort}
            setPrompt={setPrompt}
            setTaskPrompt={setTaskPrompt}
            taskPrompt={taskPrompt}
            tasks={tasks}
            threadDetail={threadDetail}
            usage={usage}
            view={view}
          />
        )}
      </main>

      <RightRail
        activeWorkspace={activeWorkspace}
        compact={inspectorCollapsed}
        expandedWorkspaceDirs={expandedWorkspaceDirs}
        onCollapse={() => setRailCollapsed(true)}
        onDirectoryToggle={toggleWorkspaceDirectory}
        onExpand={() => setRailCollapsed(false)}
        onFileOpen={openWorkspaceFile}
        onPathOpen={(path, target) => void openWorkspacePath(path, target)}
        onSearch={searchWorkspace}
        searchQuery={workspaceQuery}
        setSearchQuery={setWorkspaceQuery}
        tree={tree}
      />
      <GlobalStatusBar
        activeWorkspace={activeWorkspace}
        automations={automations}
        config={config}
        mode={mode}
        pendingCount={visibleApprovals.length}
        runtime={runtime}
        tasks={visibleTaskList(tasks?.tasks ?? [])}
        usage={usage}
        workspaceAliases={workspaceAliases}
      />
    </div>
  );
}

function GlobalStatusBar(props: {
  activeWorkspace: string | null;
  automations: AutomationRecord[];
  config: EffectiveConfig | null;
  mode: string;
  pendingCount: number;
  runtime: RuntimeStatus | null;
  tasks: TaskSummary[];
  usage: UsageResponse | null;
  workspaceAliases: WorkspaceAliases;
}) {
  const activeTasks = props.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const activeAutomations = props.automations.filter((automation) => automation.status === "active").length;
  const runtimeReady = Boolean(props.runtime?.ready);
  const footerItems = [
    { icon: <Gauge size={12} />, label: props.runtime?.port ? String(props.runtime.port) : "n/a", title: `端口 ${props.runtime?.port ?? "n/a"}` },
    { icon: <Bot size={12} />, label: props.config?.default_model ?? "模型 n/a", title: props.config?.default_model ?? "模型 n/a" },
    { icon: <ShieldCheck size={12} />, label: props.mode, title: `模式 ${props.mode}` },
    { icon: <AlertTriangle size={12} />, label: `${props.pendingCount}`, title: `${props.pendingCount} 个待审批` },
    { icon: <ListChecks size={12} />, label: `${activeTasks}/${props.tasks.length}`, title: `${activeTasks}/${props.tasks.length} 个任务` },
    { icon: <Activity size={12} />, label: `${activeAutomations}/${props.automations.length}`, title: `${activeAutomations}/${props.automations.length} 个自动化` },
    { icon: <KeyRound size={12} />, label: `$${(props.usage?.totals?.cost_usd ?? 0).toFixed(4)}`, title: "用量" }
  ];
  return (
    <footer className="global-status-bar" aria-label="运行状态条">
      <div className="footer-runtime">
        <span className={`status-dot ${runtimeReady ? "online" : "offline"}`} />
        <strong>{runtimeReady ? "就绪" : "启动中"}</strong>
      </div>
      <span className="status-truncate">{workspaceName(props.activeWorkspace ?? props.config?.workspace, props.workspaceAliases)}</span>
      <div className="footer-item-group" aria-label="运行摘要">
        {footerItems.map((item) => (
          <span className="footer-item" data-footer-item title={item.title} key={item.title}>
            {item.icon}
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}

function Sidebar(props: {
  activeThreadId: string | null;
  activeWorkspace: string | null;
  automations: AutomationRecord[];
  collapsedWorkspaces: ReadonlySet<string>;
  currentView: View;
  onArchiveThread(threadId: string): void;
  onDeleteThread(threadId: string): void;
  onLoadWorkspaceThreads(workspacePath: string): void;
  onNewThread(): void;
  onRenameWorkspace(workspacePath: string): void;
  onRemoveThread(threadId: string): void;
  onRemoveWorkspace(workspacePath: string): void;
  onSelectThread(id: string, workspace: string): void;
  onSwitchWorkspace(path: string): void;
  onTogglePinnedWorkspace(workspacePath: string): void;
  onToggleWorkspaceGroup(path: string): void;
  onWorkspaceReorder(sourcePath: string, targetPath: string): void;
  onViewChange(view: View): void;
  onWorkspaceChoose(): void;
  pinnedWorkspaces: Set<string>;
  tasks: TaskSummary[];
  threads: ThreadSummary[];
  tree: WorkspaceTree | null;
  workspaceAliases: WorkspaceAliases;
  workspaceOrder: string[];
  workspaces: string[];
}) {
  const activeTaskCount = props.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const activeAutomationCount = props.automations.filter((automation) => automation.status === "active").length;
  const workspaceGroups = useMemo(
    () =>
      buildWorkspaceGroups({
        activeWorkspace: props.activeWorkspace,
        workspaceAliases: props.workspaceAliases,
        workspaceOrder: props.workspaceOrder,
        pinnedWorkspaces: [...props.pinnedWorkspaces],
        recentWorkspaces: props.workspaces,
        threads: props.threads,
        tree: props.tree
      }),
    [props.activeWorkspace, props.pinnedWorkspaces, props.threads, props.tree, props.workspaceAliases, props.workspaceOrder, props.workspaces]
  );
  const visibleThreadCount = workspaceGroups.reduce((count, group) => count + group.threads.length, 0);
  const activeWorkspaceLabel = props.activeWorkspace ? shortPath(props.activeWorkspace) : "未选择项目";
  const newThreadDisabled = !props.activeWorkspace;
  const [draggingWorkspace, setDraggingWorkspace] = useState<string | null>(null);
  const [threadMenu, setThreadMenu] = useState<{ thread: ThreadSummary; x: number; y: number } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragPathRef = useRef<string | null>(null);
  const suppressWorkspaceClickRef = useRef(false);
  const requestedWorkspaceThreadsRef = useRef<Set<string>>(new Set());

  const clearWorkspaceLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const finishWorkspaceDrag = useCallback(() => {
    clearWorkspaceLongPress();
    dragPathRef.current = null;
    setDraggingWorkspace(null);
  }, []);

  const beginWorkspacePress = (event: PointerEvent<HTMLButtonElement>, path: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    clearWorkspaceLongPress();
    suppressWorkspaceClickRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      dragPathRef.current = path;
      setDraggingWorkspace(path);
      suppressWorkspaceClickRef.current = true;
    }, 450);
  };

  const moveWorkspaceDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const sourcePath = dragPathRef.current;
    if (!sourcePath) {
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-workspace-path]");
    const targetPath = target?.getAttribute("data-workspace-path");
    if (targetPath && !sameWorkspacePath(sourcePath, targetPath)) {
      props.onWorkspaceReorder(sourcePath, targetPath);
    }
  };

  const handleWorkspaceClick = (path: string, collapsed: boolean) => {
    if (suppressWorkspaceClickRef.current) {
      suppressWorkspaceClickRef.current = false;
      return;
    }
    props.onToggleWorkspaceGroup(path);
    props.onViewChange("threads");
    if (collapsed || !props.activeWorkspace || !sameWorkspacePath(path, props.activeWorkspace)) {
      requestedWorkspaceThreadsRef.current.add(workspaceKey(path));
      props.onLoadWorkspaceThreads(path);
    }
  };

  const openProjectMenu = (path: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setThreadMenu(null);
    setProjectMenu({ path, x: event.clientX, y: event.clientY });
  };

  const openThreadMenu = (thread: ThreadSummary, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectMenu(null);
    setThreadMenu({ thread, x: event.clientX, y: event.clientY });
  };

  const selectThread = (thread: ThreadSummary, workspace: string) => {
    setThreadMenu(null);
    props.onSelectThread(thread.id, workspace);
  };

  useEffect(() => () => clearWorkspaceLongPress(), []);

  useEffect(() => {
    const close = () => {
      setThreadMenu(null);
      setProjectMenu(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    for (const group of workspaceGroups) {
      const key = workspaceKey(group.path);
      if (!key || props.collapsedWorkspaces.has(group.path) || requestedWorkspaceThreadsRef.current.has(key)) {
        continue;
      }
      requestedWorkspaceThreadsRef.current.add(key);
      props.onLoadWorkspaceThreads(group.path);
    }
  }, [props.collapsedWorkspaces, props.onLoadWorkspaceThreads, workspaceGroups]);

  return (
    <aside className="left-rail">
      <div className="left-actions">
        <button
          className="new-thread-button"
          type="button"
          onClick={newThreadDisabled ? props.onWorkspaceChoose : props.onNewThread}
        >
          <Plus size={16} />
          {newThreadDisabled ? "选择项目" : "新会话"}
        </button>
        <button className="secondary-action-button" type="button" onClick={props.onWorkspaceChoose}>
          <FolderTree size={15} />
          添加项目
        </button>
      </div>

      <nav className="nav-grid" aria-label="主导航">
        <NavButton
          active={props.currentView === "threads"}
          badge={visibleThreadCount}
          icon={<Bot size={16} />}
          label="项目"
          onClick={() => props.onViewChange("threads")}
        />
        <NavButton
          active={props.currentView === "tasks"}
          badge={activeTaskCount || props.tasks.length}
          icon={<ListChecks size={16} />}
          label="任务"
          onClick={() => props.onViewChange("tasks")}
        />
        <NavButton
          active={props.currentView === "automations"}
          badge={activeAutomationCount || props.automations.length}
          icon={<Activity size={16} />}
          label="自动化"
          onClick={() => props.onViewChange("automations")}
        />
        <NavButton active={props.currentView === "settings"} icon={<Settings size={16} />} label="设置" onClick={() => props.onViewChange("settings")} />
      </nav>

      <section className="rail-section">
        <div className="section-title">
          <FolderTree size={15} />
          <span>当前项目</span>
          <em>{activeWorkspaceLabel}</em>
        </div>
      </section>

      <section className="rail-section grow">
        <div className="section-title">
          <Bot size={15} />
          <span>项目</span>
        </div>
        <div className="thread-list" aria-label="按项目分组的会话">
          {workspaceGroups.map((group) => {
            const collapsed = props.collapsedWorkspaces.has(group.path);
            const pinned = [...props.pinnedWorkspaces].some((path) => sameWorkspacePath(path, group.path));
            return (
              <div className={`thread-workspace-group ${group.active ? "active" : ""}`} key={group.path}>
                <div
                  className="thread-workspace-row-wrap"
                  data-workspace-path={group.path}
                  onContextMenu={(event) => openProjectMenu(group.path, event)}
                >
                  <button
                    aria-expanded={!collapsed}
                    className={`thread-workspace-row ${sameWorkspacePath(draggingWorkspace, group.path) ? "dragging" : ""}`}
                    data-workspace-path={group.path}
                    title={group.path}
                    type="button"
                    onClick={() => handleWorkspaceClick(group.path, collapsed)}
                    onPointerCancel={finishWorkspaceDrag}
                    onPointerDown={(event) => beginWorkspacePress(event, group.path)}
                    onPointerLeave={clearWorkspaceLongPress}
                    onPointerMove={moveWorkspaceDrag}
                    onPointerUp={finishWorkspaceDrag}
                  >
                    <ChevronRight className="workspace-chevron" size={13} />
                    <span>{group.name}</span>
                    <em>{group.active ? "当前" : group.shortPath}</em>
                    <b>{group.threads.length}</b>
                  </button>
                  <button
                    className="project-row-menu"
                    type="button"
                    aria-label={`打开 ${group.name} 的项目菜单`}
                    aria-expanded={projectMenu?.path === group.path}
                    title="项目操作"
                    onClick={(event) => openProjectMenu(group.path, event)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
                {!collapsed ? (
                  <div className="thread-group-list">
                    {group.threads.map((thread) => (
                      <div
                        data-thread-row
                        className={`thread-row ${thread.id === props.activeThreadId ? "active" : ""}`}
                        key={thread.id}
                        onContextMenu={(event) => openThreadMenu(thread, event)}
                      >
                        <button
                          className="thread-row-main"
                          title={`${thread.title || "未命名会话"} · ${threadPreviewText(thread)}`}
                          type="button"
                          onClick={() => selectThread(thread, group.path)}
                        >
                          <span className="thread-title">{thread.title || "未命名会话"}</span>
                          <span className="thread-meta">
                            <StatusIcon status={thread.latest_turn_status ?? "ready"} />
                            <span>{formatDate(thread.updated_at)}</span>
                          </span>
                        </button>
                        <button
                          className="thread-row-menu"
                          type="button"
                          aria-label={`打开 ${thread.title || "未命名会话"} 的会话菜单`}
                          title="会话操作"
                          onClick={(event) => openThreadMenu(thread, event)}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    ))}
                    {!group.threads.length ? <EmptyMini text="暂无会话" /> : null}
                  </div>
                ) : null}
                {projectMenu?.path === group.path ? (
                  <ProjectContextMenu
                    onMakeActive={() => props.onSwitchWorkspace(group.path)}
                    onRemoveProject={() => props.onRemoveWorkspace(group.path)}
                    onRenameProject={() => props.onRenameWorkspace(group.path)}
                    onTogglePinnedProject={() => props.onTogglePinnedWorkspace(group.path)}
                    pinnedProject={pinned}
                    style={{ left: projectMenu.x, top: projectMenu.y }}
                  />
                ) : null}
              </div>
            );
          })}
          {!workspaceGroups.length ? <EmptyMini text="先添加项目" /> : null}
        </div>
      </section>

      {threadMenu ? (
        <ThreadContextMenu
          onArchiveThread={() => props.onArchiveThread(threadMenu.thread.id)}
          onDeleteThread={() => props.onDeleteThread(threadMenu.thread.id)}
          onRemoveThread={() => props.onRemoveThread(threadMenu.thread.id)}
          style={{ left: threadMenu.x, top: threadMenu.y }}
        />
      ) : null}

      <div className="rail-footer">
        <span>{props.tasks.length} 个任务</span>
        <span>{props.automations.length} 个自动化</span>
      </div>
    </aside>
  );
}

function TopBar(props: {
  activeWorkspace: string | null;
  busy: boolean;
  config: EffectiveConfig | null;
  error: string | null;
  runtime: RuntimeStatus | null;
  workspaceAliases: WorkspaceAliases;
}) {
  const runtimeReady = Boolean(props.runtime?.ready);
  if (runtimeReady && !props.busy && !props.error) {
    return null;
  }
  return (
    <header className="top-bar">
      <div className="top-bar-status">
        <span className={`status-dot ${runtimeReady ? "online" : "offline"}`} />
        <strong>{runtimeReady ? "运行时就绪" : "运行时启动中"}</strong>
        <span className="top-subtitle">{workspaceName(props.activeWorkspace ?? props.config?.workspace, props.workspaceAliases)}</span>
      </div>
      <div className="top-actions">
        {props.busy ? (
          <StatusPill tone="blue">
            <Loader2 className="spin" size={14} />
            处理中
          </StatusPill>
        ) : null}
        {props.error ? <StatusPill tone="red">{props.error}</StatusPill> : null}
      </div>
    </header>
  );
}

type PickerOption = {
  value: string;
  label: string;
  description?: string;
  shortLabel?: string;
};

function OptionPicker({
  className,
  label,
  onChange,
  options,
  value
}: {
  className?: string;
  label: string;
  onChange(value: string): void;
  options: PickerOption[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? { label: value || "未选择", value };
  return (
    <div
      className={`select-menu ${open ? "open" : ""} ${className ?? ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="select-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.shortLabel ?? selected.label}</span>
        <ChevronRight className="select-arrow" size={13} />
      </button>
      {open ? (
        <div className="select-popover" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="select-option"
              key={option.value}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.description ? <em>{option.description}</em> : null}
              {option.value === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToggleSetting({
  checked,
  description,
  id,
  label,
  onChange
}: {
  checked: boolean;
  description?: string;
  id?: string;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`toggle-row ${checked ? "on" : ""}`}
      data-setting-row
      id={id}
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-track" aria-hidden="true">
        <span />
      </span>
      <span className="toggle-copy">
        <strong>{label}</strong>
        {description ? <em>{description}</em> : null}
      </span>
    </button>
  );
}

function IconOptionPicker({
  icon,
  label,
  onChange,
  options,
  value
}: {
  icon: ReactNode;
  label: string;
  onChange(value: string): void;
  options: PickerOption[];
  value: string;
}) {
  return (
    <div className="icon-option" data-composer-control title={label}>
      <span className="icon-option-mark" aria-hidden="true">
        {icon}
      </span>
      <OptionPicker className="icon-option-picker" label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

function ApprovalComposer({
  approval,
  onApproval,
  onInterrupt
}: {
  approval: Approval;
  onApproval(id: string, decision: "allow" | "deny", remember?: boolean): void;
  onInterrupt(): void;
}) {
  return (
    <div className="composer approval-composer" role="alert" aria-live="polite">
      <div className="approval-composer-main">
        <ShieldCheck size={18} />
        <div>
          <strong>{approval.tool || "工具调用"} 请求确认</strong>
          <span>{approval.command || approval.reason || "该操作需要你确认后继续。"}</span>
          {approval.cwd ? <em>{shortPath(approval.cwd)}</em> : null}
        </div>
      </div>
      <div className="composer-actions approval-composer-actions">
        <button type="button" onClick={() => onApproval(approval.approvalId, "allow")}>
          <Check size={15} />
          允许一次
        </button>
        <button type="button" onClick={() => onApproval(approval.approvalId, "allow", true)}>
          <ShieldCheck size={15} />
          以后都运行
        </button>
        <button type="button" onClick={() => onApproval(approval.approvalId, "deny")}>
          <X size={15} />
          拒绝
        </button>
        <button className="composer-send danger" type="button" aria-label="中断当前 turn" onClick={onInterrupt}>
          <Square size={16} />
        </button>
      </div>
    </div>
  );
}

function ThreadWorkspace(props: {
  activeWorkspace: string | null;
  automations: AutomationRecord[];
  apiKeyMissing: boolean;
  busy: boolean;
  config: EffectiveConfig | null;
  createTask(event: FormEvent): void;
  filePreview: WorkspaceFile | null;
  modelOptions: Array<{ id: string }>;
  mode: string;
  onArchiveThread(threadId: string): void;
  onApproval(id: string, decision: "allow" | "deny", remember?: boolean): void;
  onAutomationAction(id: string, action: "pause" | "resume" | "run"): Promise<void>;
  onCancelTask(id: string): Promise<void>;
  onClearTasks(filter: "terminal" | "smoke"): void;
  onCloseFile(): void;
  onCreateWorktree(): void;
  onDeleteTask(id: string): void;
  onDeleteThread(threadId: string): void;
  onInterrupt(): void;
  onOpenFile(path: string): void;
  onOpenSettings(): void;
  onOpenTaskThread(threadId: string): void;
  onRemoveThread(threadId: string): void;
  onRemoveWorkspace?: () => void;
  onRenameWorkspace(): void;
  onTogglePinnedWorkspace(): void;
  onWorkspaceOpen(target: WorkspaceOpenTarget): void;
  onWorkspaceChoose(): void;
  onSendPrompt(event: FormEvent): void;
  pendingApproval: Approval | null;
  pinnedWorkspace: boolean;
  prompt: string;
  searchResult: WorkspaceSearch | null;
  selectedThread: ThreadSummary | null;
  selectedModel: string;
  selectedReasoningEffort: string;
  setMode(value: string): void;
  setSelectedModel(value: string): void;
  setSelectedReasoningEffort(value: string): void;
  setPrompt(value: string): void;
  setTaskPrompt(value: string): void;
  taskPrompt: string;
  tasks: TasksResponse | null;
  threadDetail: ThreadDetail | null;
  usage: UsageResponse | null;
  view: View;
}) {
  const allTaskItems = props.tasks?.tasks ?? [];
  const visibleTaskItems = visibleTaskList(allTaskItems);
  const taskCounts = countTaskList(visibleTaskItems);
  const smokeTaskCount = allTaskItems.filter((task) => isSmokeTask(task) && task.status !== "running").length;
  const terminalTaskCount = visibleTaskItems.filter((task) => TERMINAL_TASK_STATUSES.has(task.status)).length;
  const activeAutomations = props.automations.filter((automation) => automation.status === "active").length;
  const pausedAutomations = props.automations.filter((automation) => automation.status !== "active").length;
  const hasThreadItems = Boolean(props.threadDetail?.items.length);
  const liveTurn = props.threadDetail?.turns.find((turn) => LIVE_TURN_STATUSES.has(turn.status)) ?? null;
  const latestStatus = props.selectedThread?.latest_turn_status ?? (hasThreadItems ? "ready" : "new");
  const workspaceReady = Boolean(props.activeWorkspace);
  const turnActive = props.busy || Boolean(liveTurn) || LIVE_TURN_STATUSES.has(latestStatus);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const followTimelineRef = useRef(true);
  const timelineScrollFrameRef = useRef<number | null>(null);
  useEffect(() => {
    if (!turnActive) {
      setNowMs(Date.now());
      return undefined;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [turnActive]);
  useEffect(() => {
    const close = () => {
      setWorkspaceMenu(null);
      setWorkspaceMenuOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  const modelOptions = props.modelOptions.length
    ? props.modelOptions.map((model) => ({ label: model.id, shortLabel: compactModelLabel(model.id), value: model.id }))
    : [
        {
          label: props.selectedModel || props.config?.default_model || "deepseek-v4-pro",
          shortLabel: compactModelLabel(props.selectedModel || props.config?.default_model || "deepseek-v4-pro"),
          value: props.selectedModel || props.config?.default_model || "deepseek-v4-pro"
        }
      ];
  const reasoningOptions = [
    { label: "关闭", shortLabel: "关", value: "off" },
    { label: "低", shortLabel: "低", value: "low" },
    { label: "中", shortLabel: "中", value: "medium" },
    { label: "高", shortLabel: "高", value: "high" },
    { label: "最大", shortLabel: "最大", value: "max" }
  ];
  const modeOptions = [
    { label: "Agent", shortLabel: "Agent", value: "agent", description: "工具调用前按策略审批" },
    { label: "Plan", shortLabel: "Plan", value: "plan", description: "只读规划" },
    { label: "YOLO", shortLabel: "YOLO", value: "yolo", description: "尽量自动执行" }
  ];
  const activeTimelineTurnId = liveTurn?.id ?? props.selectedThread?.latest_turn_id ?? props.threadDetail?.turns.at(-1)?.id ?? null;
  const activeTurn = props.threadDetail?.turns.find((turn) => turn.id === activeTimelineTurnId) ?? props.threadDetail?.turns.at(-1) ?? null;
  const activeTurnLabel = turnStatusLine(activeTurn, nowMs);
  const contextLabel = contextStatusLabel(props.threadDetail, props.usage);
  const contextMeter = contextMeterInfo(props.threadDetail, props.usage, contextLabel);
  const timelineEntries = useMemo(
    () =>
      buildTurnTimeline({
        activeTurnId: activeTimelineTurnId,
        items: props.threadDetail?.items ?? [],
        turnActive,
        turns: props.threadDetail?.turns ?? []
      }),
    [activeTimelineTurnId, props.threadDetail?.items, props.threadDetail?.turns, turnActive]
  );
  const updateTimelineFollowState = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    const distanceToBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    followTimelineRef.current = distanceToBottom <= 56;
  };
  useEffect(() => {
    followTimelineRef.current = true;
  }, [props.selectedThread?.id]);
  useEffect(() => {
    if (!followTimelineRef.current) {
      return undefined;
    }
    if (timelineScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineScrollFrameRef.current);
    }
    timelineScrollFrameRef.current = window.requestAnimationFrame(() => {
      const timeline = timelineRef.current;
      if (!timeline) {
        timelineScrollFrameRef.current = null;
        return;
      }
      timeline.scrollTo({
        top: timeline.scrollHeight,
        behavior: turnActive ? "smooth" : "auto"
      });
      timelineScrollFrameRef.current = null;
    });
    return undefined;
  }, [activeTurnLabel, props.threadDetail?.latest_seq, props.selectedThread?.id, timelineEntries, turnActive]);
  useEffect(
    () => () => {
      if (timelineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineScrollFrameRef.current);
      }
    },
    []
  );
  const insertComposerNewline = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${props.prompt.slice(0, start)}\n${props.prompt.slice(end)}`;
    props.setPrompt(next);
    window.requestAnimationFrame(() => {
      target.selectionStart = start + 1;
      target.selectionEnd = start + 1;
    });
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = composerKeyIntent({
      ctrlKey: event.ctrlKey,
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
      metaKey: event.metaKey
    });
    if (intent === "ignore") {
      return;
    }
    event.preventDefault();
    if (intent === "newline") {
      insertComposerNewline(event.currentTarget);
      return;
    }
    event.currentTarget.form?.requestSubmit();
  };

  if (props.view === "tasks") {
    return (
      <div className="content-grid single">
        <Panel
          title="后台任务"
          icon={<ListChecks size={18} />}
          action={
            <div className="panel-action-group">
              <button type="button" disabled={!terminalTaskCount} onClick={() => props.onClearTasks("terminal")}>
                <Trash2 size={14} />
                清理已结束
              </button>
              {smokeTaskCount ? (
                <button type="button" onClick={() => props.onClearTasks("smoke")}>
                  <Trash2 size={14} />
                  清理测试残留
                </button>
              ) : null}
              <StatusBadge status={taskCounts.running ? "running" : "ready"} label={`${taskCounts.running}`} />
            </div>
          }
        >
          <SummaryStrip
            items={[
              { label: "排队", value: taskCounts.queued, tone: "gray" },
              { label: "运行", value: taskCounts.running, tone: "amber" },
              { label: "完成", value: taskCounts.completed, tone: "green" },
              { label: "失败", value: taskCounts.failed, tone: "red" },
              { label: "取消", value: taskCounts.canceled, tone: "gray" }
            ]}
          />
          <form className="inline-form" onSubmit={props.createTask}>
            <input value={props.taskPrompt} onChange={(event) => props.setTaskPrompt(event.target.value)} placeholder="一次性后台目标" />
            <button type="submit" disabled={props.busy || !props.taskPrompt.trim()}>
              <Play size={15} />
              创建
            </button>
          </form>
          <div className="record-list operations-list">
            {visibleTaskItems.map((task) => (
              <div className="record-row operation-row" data-operation-row key={task.id}>
                <div>
                  <strong>{task.prompt_summary}</strong>
                  <span>
                    {task.model} · {task.mode} · {formatDate(task.created_at)}
                    {task.duration_ms ? ` · ${formatDuration(task.duration_ms)}` : ""}
                  </span>
                  {task.error ? <em className="task-error">{task.error}</em> : null}
                </div>
                <div className="row-actions">
                  {task.thread_id ? (
                    <button type="button" onClick={() => props.onOpenTaskThread(task.thread_id!)}>
                      <Bot size={14} />
                      打开结果
                    </button>
                  ) : null}
                  <StatusBadge status={task.status} />
                  {task.status === "queued" || task.status === "running" ? (
                    <button type="button" onClick={() => void props.onCancelTask(task.id)}>
                      <Square size={14} />
                      取消
                    </button>
                  ) : null}
                  {TERMINAL_TASK_STATUSES.has(task.status) ? (
                    <button type="button" onClick={() => props.onDeleteTask(task.id)}>
                      <Trash2 size={14} />
                      移除
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {!visibleTaskItems.length ? <EmptyState compact title="暂无后台任务" body="可以把耗时的一次性目标放到这里执行。" /> : null}
          </div>
        </Panel>
      </div>
    );
  }

  if (props.view === "automations") {
    return (
      <div className="content-grid single">
        <Panel title="自动化" icon={<Activity size={18} />} action={<StatusBadge status={activeAutomations ? "active" : "ready"} label={`${activeAutomations}`} />}>
          <SummaryStrip
            items={[
              { label: "启用", value: activeAutomations, tone: "green" },
              { label: "暂停", value: pausedAutomations, tone: "amber" },
              { label: "总数", value: props.automations.length, tone: "blue" }
            ]}
          />
          <div className="record-list operations-list">
            {props.automations.map((automation) => (
              <div className="record-row operation-row" data-operation-row key={automation.id}>
                <div>
                  <strong>{automation.name}</strong>
                  <span>{automation.rrule} · 下次 {formatDate(automation.next_run_at)}</span>
                </div>
                <div className="row-actions">
                  <StatusBadge status={automation.status} />
                  <button type="button" onClick={() => void props.onAutomationAction(automation.id, "run")}>
                    <Play size={14} />
                    运行
                  </button>
                  {automation.status === "active" ? (
                    <button type="button" onClick={() => void props.onAutomationAction(automation.id, "pause")}>
                      <CirclePause size={14} />
                      暂停
                    </button>
                  ) : (
                    <button type="button" onClick={() => void props.onAutomationAction(automation.id, "resume")}>
                      <CirclePlay size={14} />
                      恢复
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!props.automations.length ? <EmptyState compact title="暂无自动化" body="已配置的本地定时任务会显示在这里。" /> : null}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="content-grid conversation">
      <section
        className={`thread-pane ${props.filePreview || props.searchResult ? "has-inspector" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setWorkspaceMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ConversationToolbar
          menuOpen={workspaceMenuOpen}
          onInterrupt={props.onInterrupt}
          onProjectMenu={(event) => {
            event.stopPropagation();
            setWorkspaceMenu((current) => (current ? null : { x: event.clientX, y: event.clientY }));
          }}
          onWorkspaceOpen={props.onWorkspaceOpen}
          onWorkspaceMenuToggle={(event) => {
            event.stopPropagation();
            setWorkspaceMenuOpen((current) => !current);
          }}
          turnActive={turnActive}
          workspaceReady={workspaceReady}
        />
        {workspaceMenu ? (
          <WorkspaceContextMenu
            onCreateWorktree={props.onCreateWorktree}
            onRemoveWorkspace={props.onRemoveWorkspace ?? (() => undefined)}
            onRenameWorkspace={props.onRenameWorkspace}
            onTogglePinnedWorkspace={props.onTogglePinnedWorkspace}
            onWorkspaceOpen={props.onWorkspaceOpen}
            pinnedWorkspace={props.pinnedWorkspace}
            style={{ left: workspaceMenu.x, top: workspaceMenu.y }}
          />
        ) : null}

        {props.filePreview || props.searchResult ? (
          <div className="thread-inspector">
            {props.filePreview ? (
              <Panel
                title={props.filePreview.path}
                icon={<FileText size={17} />}
                action={
                  <button className="icon-button" type="button" aria-label="关闭文件预览" onClick={props.onCloseFile} title="关闭">
                    <X size={15} />
                  </button>
                }
              >
                <div className="file-meta">
                  <span>
                    已读取 {formatBytes(props.filePreview.bytes_read)} / {formatBytes(props.filePreview.size)}
                  </span>
                  {props.filePreview.truncated ? <StatusPill tone="amber">已截断</StatusPill> : <StatusPill tone="green">完整</StatusPill>}
                </div>
                <pre className="file-preview">{props.filePreview.content}</pre>
              </Panel>
            ) : null}
            {props.searchResult ? (
              <Panel
                title="搜索结果"
                icon={<Search size={17} />}
                action={<StatusPill tone={props.searchResult.matches.length ? "blue" : "gray"}>{props.searchResult.matches.length} matches</StatusPill>}
              >
                <div className="mini-list">
                  {props.searchResult.matches.map((match) => (
                    <button
                      className="mini-row result-row"
                      key={`${match.path}:${match.line}`}
                      type="button"
                      onClick={() => props.onOpenFile(match.path)}
                    >
                      <strong>{match.path}:{match.line}</strong>
                      <span>{match.snippet}</span>
                    </button>
                  ))}
                  {!props.searchResult.matches.length ? <EmptyMini text="没有匹配" /> : null}
                </div>
              </Panel>
            ) : null}
          </div>
        ) : null}

        <div className={`timeline ${hasThreadItems ? "" : "empty"}`} ref={timelineRef} onScroll={updateTimelineFollowState}>
          {timelineEntries.map((entry) =>
            entry.type === "processed" ? (
              <ProcessedHistoryGroup items={entry.items} key={entry.id} processedAt={entry.processedAt} />
            ) : (
              <TurnItem collapseWhenDone={false} item={entry.item} key={entry.item.id} turnActive={turnActive} />
            )
          )}
          {!workspaceReady ? (
            <WorkspaceSetupState onChooseWorkspace={props.onWorkspaceChoose} />
          ) : null}
          {workspaceReady && !props.threadDetail?.items.length && props.apiKeyMissing ? (
            <SetupState onOpenSettings={props.onOpenSettings} />
          ) : null}
          {workspaceReady && !props.threadDetail?.items.length && !props.apiKeyMissing ? <EmptyState title="你打算构建什么" /> : null}
        </div>

        {activeTurnLabel ? (
          <div className="notice" role="status" aria-live="polite">
            <Loader2 className={turnActive ? "spin" : ""} size={16} />
            <span>{activeTurnLabel}</span>
          </div>
        ) : null}

        {props.pendingApproval ? (
          <ApprovalComposer approval={props.pendingApproval} onApproval={props.onApproval} onInterrupt={props.onInterrupt} />
        ) : (
          <form className={`composer ${workspaceReady ? "" : "disabled"}`} onSubmit={props.onSendPrompt}>
            <textarea
              aria-label="消息输入"
              disabled={!workspaceReady || turnActive}
              value={props.prompt}
              onChange={(event) => props.setPrompt(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={workspaceReady ? "输入任务、问题或修改请求" : "先选择项目"}
              rows={3}
            />
            <div className="composer-actions">
              <div className="composer-control-strip" aria-label="会话参数">
                <IconOptionPicker
                  icon={<Bot size={14} />}
                  label="模型"
                  options={modelOptions}
                  value={props.selectedModel || modelOptions[0]?.value || ""}
                  onChange={props.setSelectedModel}
                />
                <IconOptionPicker
                  icon={<Activity size={14} />}
                  label="思考程度"
                  options={reasoningOptions}
                  value={props.selectedReasoningEffort || props.config?.reasoning_effort || "medium"}
                  onChange={props.setSelectedReasoningEffort}
                />
                <IconOptionPicker
                  icon={<ShieldCheck size={14} />}
                  label="权限"
                  options={modeOptions}
                  value={props.mode}
                  onChange={props.setMode}
                />
              </div>
              <ContextMeter info={contextMeter} />
              {turnActive ? (
                <button className="composer-send danger" type="button" aria-label="中断当前 turn" onClick={props.onInterrupt}>
                  <Square size={16} />
                </button>
              ) : (
                <button className="composer-send" type="submit" aria-label="发送" disabled={!workspaceReady || !props.prompt.trim()}>
                  <Send size={16} />
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

type ContextMeterInfo = {
  label: string;
  detail: string;
  percent: number;
  tone: "empty" | "low" | "mid" | "high";
  remainingLabel: string;
  totalLabel: string;
  usedLabel: string;
  markedLabel: string;
};

function ContextMeter({ info }: { info: ContextMeterInfo }) {
  const ringStyle = { "--context-progress": `${Math.round(info.percent * 3.6)}deg` } as CSSProperties;
  return (
    <button className={`context-meter context-meter-${info.tone}`} type="button" aria-label={info.detail}>
      <span className="context-meter-ring" style={ringStyle}>
        <span className="context-meter-core" />
        <span className="context-meter-needle" />
      </span>
      <span className="context-meter-detail" role="tooltip">
        <span>
          <strong>已用</strong>
          <em>{info.usedLabel}</em>
        </span>
        <span>
          <strong>标记</strong>
          <em>{info.markedLabel}</em>
        </span>
        <span>
          <strong>剩余</strong>
          <em>{info.remainingLabel}</em>
        </span>
        <span>
          <strong>共</strong>
          <em>{info.totalLabel}</em>
        </span>
      </span>
    </button>
  );
}

function contextMeterInfo(
  detail: ThreadDetail | null | undefined,
  usage: UsageResponse | null | undefined,
  fallbackLabel: string
): ContextMeterInfo {
  const precise = detail?.context ?? usage?.context ?? null;
  const used = precise?.used_tokens ?? null;
  const windowTokens = precise?.window_tokens ?? null;
  const percent =
    typeof precise?.percent_used === "number"
      ? precise.percent_used
      : used !== null && windowTokens
        ? Math.round((used / windowTokens) * 100)
        : null;
  const estimated = used ?? estimateContextTokens(detail);
  const compacted = Boolean(
    precise?.compacted_at ||
      precise?.last_compaction_at ||
      /compact|compress|summar/i.test(precise?.compression_status ?? "") ||
      detail?.turns.some((turn) => /compact/i.test(turn.input_summary))
  );
  const label = `${compacted ? "已压缩" : "上下文"}: ${used === null && estimated > 0 ? "约 " : ""}${formatContextTokenCount(estimated)} tok`;
  const safePercent = clampPercent(percent ?? (windowTokens && estimated > 0 ? Math.round((estimated / windowTokens) * 100) : 0));
  const totalTokens = windowTokens ?? 1_000_000;
  const remainingTokens = Math.max(0, precise?.remaining_tokens ?? totalTokens - estimated);
  const usedLabel = used !== null ? `${formatContextTokenDetail(used)} tok` : "待同步";
  const markedLabel = `${used === null && estimated > 0 ? "约 " : ""}${formatContextTokenDetail(estimated)} tok`;
  const remainingLabel = `${formatContextTokenDetail(remainingTokens)} tok`;
  const totalLabel = `${formatContextTokenDetail(totalTokens)} tok`;
  const detailText =
    used !== null && windowTokens
      ? `${compacted ? "已压缩" : "上下文"} · 已用 ${formatContextTokenCount(used)} token，共 ${formatContextTokenCount(windowTokens)} · ${safePercent}%`
      : fallbackLabel;
  return {
    label,
    detail: `${detailText} · 已用 ${usedLabel} · 标记 ${markedLabel} · 剩余 ${remainingLabel} · 共 ${totalLabel}`,
    percent: safePercent,
    tone: contextMeterTone(safePercent, estimated),
    remainingLabel,
    totalLabel,
    usedLabel,
    markedLabel
  };
}

function contextMeterTone(percent: number, estimated: number): ContextMeterInfo["tone"] {
  if (estimated <= 0) {
    return "empty";
  }
  if (percent >= 85) {
    return "high";
  }
  if (percent >= 55) {
    return "mid";
  }
  return "low";
}

function estimateContextTokens(detail: ThreadDetail | null | undefined) {
  if (!detail) {
    return 0;
  }
  const chars = detail.items.reduce((count, item) => count + (item.summary?.length ?? 0) + (item.detail?.length ?? 0), 0);
  return Math.ceil(chars / 4);
}

function formatContextTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(Math.max(0, Math.round(value)));
}

function formatContextTokenDetail(value: number) {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.max(0, Math.round(value)));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function RightRail(props: {
  activeWorkspace: string | null;
  compact: boolean;
  expandedWorkspaceDirs: ReadonlySet<string>;
  onCollapse(): void;
  onDirectoryToggle(path: string): void;
  onExpand(): void;
  onFileOpen(path: string): void;
  onPathOpen(path: string, target: WorkspacePathOpenTarget): void;
  onSearch(event: FormEvent): void;
  searchQuery: string;
  setSearchQuery(value: string): void;
  tree: WorkspaceTree | null;
}) {
  const [directoryMenu, setDirectoryMenu] = useState<{ path: string; name: string; x: number; y: number } | null>(null);
  const visibleTreeEntries = useMemo(
    () => visibleWorkspaceEntries(props.tree?.entries ?? [], props.expandedWorkspaceDirs),
    [props.expandedWorkspaceDirs, props.tree?.entries]
  );
  useEffect(() => {
    const close = () => setDirectoryMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  if (props.compact) {
    return (
      <aside className="right-rail compact" aria-label="项目目录">
        <button
          aria-controls="rail-panel-workspace"
          aria-label="展开项目目录"
          className="rail-compact-button"
          id="rail-tab-workspace"
          type="button"
          onClick={props.onExpand}
        >
          <FolderTree size={18} />
        </button>
      </aside>
    );
  }
  return (
    <aside className="right-rail">
      <button className="rail-collapse-button" type="button" onClick={props.onCollapse}>
        <ChevronRight size={15} />
        收起
      </button>
      <Panel title="项目目录" icon={<FolderTree size={17} />}>
        <form className="search-box workspace-search" onSubmit={props.onSearch}>
          <Search size={15} />
          <input
            aria-label="搜索项目"
            disabled={!props.activeWorkspace}
            value={props.searchQuery}
            onChange={(event) => props.setSearchQuery(event.target.value)}
            placeholder="搜索文件内容"
          />
        </form>
        <div className="tree-list workspace-tree-list" aria-label="项目文件">
          {visibleTreeEntries.map((entry) => (
            <button
              aria-expanded={entry.is_dir ? entry.expanded : undefined}
              className={`tree-row ${entry.is_dir ? "dir" : "file"} ${entry.expanded ? "expanded" : ""}`}
              key={entry.path}
              style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
              title={entry.path}
              type="button"
              onClick={() => (entry.is_dir ? props.onDirectoryToggle(entry.path) : props.onFileOpen(entry.path))}
              onContextMenu={(event) => {
                if (!entry.is_dir) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setDirectoryMenu({ path: entry.path, name: entry.name, x: event.clientX, y: event.clientY });
              }}
              onDoubleClick={(event) => {
                if (entry.is_dir) {
                  return;
                }
                event.preventDefault();
                props.onPathOpen(entry.path, "file");
              }}
            >
              <span className="tree-twist">{entry.is_dir && entry.hasChildren ? <ChevronRight size={13} /> : null}</span>
              {entry.is_dir ? <FolderTree size={14} /> : <FileText size={14} />}
              <span>{entry.name}</span>
            </button>
          ))}
          {!props.activeWorkspace ? <EmptyMini text="选择或添加项目后显示文件" /> : null}
          {props.activeWorkspace && !props.tree?.entries.length ? <EmptyMini text="暂无项目索引" /> : null}
        </div>
      </Panel>
      {directoryMenu ? (
        <div
          className="context-menu directory-context-menu"
          role="menu"
          style={{ left: directoryMenu.x, top: directoryMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            title={directoryMenu.path}
            onClick={() => {
              props.onPathOpen(directoryMenu.path, "folder");
              setDirectoryMenu(null);
            }}
          >
            <FolderOpen size={15} />
            在资源管理器打开
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function SettingsView(props: {
  config: EffectiveConfig | null;
  logs: RuntimeLogEntry[];
  mcp: McpServersResponse | null;
  modelOptions: Array<{ id: string }>;
  onPatch(patch: ConfigPatch): Promise<void>;
  onRestart(): void;
  onSkillToggle(name: string, enabled: boolean): Promise<void>;
  runtime: RuntimeStatus | null;
  selectedModel: string;
  skills: SkillsResponse | null;
  usage: UsageResponse | null;
}) {
  const [section, setSection] = useState<"model" | "runtime" | "extensions" | "logs">("model");
  const [provider, setProvider] = useState(props.config?.provider ?? "deepseek");
  const [model, setModel] = useState(props.selectedModel || "deepseek-v4-pro");
  const [approvalPolicy, setApprovalPolicy] = useState(props.config?.approval_policy ?? "suggest");
  const [sandboxMode, setSandboxMode] = useState(props.config?.sandbox_mode ?? "workspace-write");
  const [reasoningEffort, setReasoningEffort] = useState(props.config?.reasoning_effort ?? "medium");
  const [allowShell, setAllowShell] = useState(props.config?.allow_shell ?? true);
  const [yolo, setYolo] = useState(props.config?.yolo ?? false);

  useEffect(() => {
    if (!props.config) {
      return;
    }
    setProvider(props.config.provider);
    setModel(props.config.default_model);
    setApprovalPolicy(props.config.approval_policy);
    setSandboxMode(props.config.sandbox_mode);
    setReasoningEffort(props.config.reasoning_effort);
    setAllowShell(props.config.allow_shell);
    setYolo(props.config.yolo);
  }, [props.config]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void props.onPatch({
      provider,
      default_text_model: model,
      reasoning_effort: reasoningEffort,
      approval_policy: approvalPolicy,
      sandbox_mode: sandboxMode,
      allow_shell: allowShell,
      yolo
    });
  };
  const toggleYolo = (enabled: boolean) => {
    setYolo(enabled);
    if (enabled) {
      setAllowShell(true);
    }
  };
  const apiKeySource = props.config?.api_key_source ?? "unknown";
  const apiKeyMissing = apiKeySource === "missing" || apiKeySource === "none";
  const settingsModelOptions = [
    ...new Map(
      [
        ...(model ? [{ label: model, value: model }] : [{ label: "deepseek-v4-pro", value: "deepseek-v4-pro" }]),
        ...props.modelOptions.map((option) => ({ label: option.id, value: option.id }))
      ].map((option) => [option.value, option])
    ).values()
  ];
  const approvalOptions = [
    { label: "按需审批", value: "on-request", description: "工具执行前询问" },
    { label: "不可信时询问", value: "untrusted", description: "风险较高时询问" },
    { label: "建议模式", value: "suggest", description: "需要时询问" },
    { label: "自动", value: "auto", description: "低风险自动通过" },
    { label: "从不", value: "never", description: "不主动审批" }
  ];
  const sandboxOptions = [
    { label: "项目", value: "workspace-write", description: "只写当前项目" },
    { label: "只读", value: "read-only", description: "只读" },
    { label: "完全访问", value: "danger-full-access", description: "完全访问" }
  ];
  const reasoningOptions = [
    { label: "自动", value: "auto" },
    { label: "关闭", value: "off" },
    { label: "低", value: "low" },
    { label: "中", value: "medium" },
    { label: "高", value: "high" },
    { label: "最大", value: "max" }
  ];
  const mcpServers = props.mcp?.servers ?? [];
  const skillItems = props.skills?.skills ?? [];
  const totals = props.usage?.totals;
  const connectedMcp = mcpServers.filter((server) => server.connected).length;
  const enabledSkills = skillItems.filter((skill) => skill.enabled).length;

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="设置目录">
        <button className={section === "model" ? "active" : ""} type="button" onClick={() => setSection("model")}>
          <Settings size={16} />
          <span>模型与权限</span>
        </button>
        <button className={section === "runtime" ? "active" : ""} type="button" onClick={() => setSection("runtime")}>
          <Gauge size={16} />
          <span>运行</span>
        </button>
        <button className={section === "extensions" ? "active" : ""} type="button" onClick={() => setSection("extensions")}>
          <PlugZap size={16} />
          <span>扩展</span>
        </button>
        <button className={section === "logs" ? "active" : ""} type="button" onClick={() => setSection("logs")}>
          <Terminal size={16} />
          <span>日志</span>
        </button>
      </nav>

      <div className={`settings-layout ${section === "model" || section === "logs" ? "single-panel" : ""}`}>
        {section === "model" ? (
          <Panel title="模型与权限" icon={<Settings size={18} />}>
            <form className="settings-form" aria-label="模型与权限设置" onSubmit={submit}>
              <div className={`settings-alert ${apiKeyMissing ? "warn" : "ok"}`} role={apiKeyMissing ? "alert" : "status"} aria-live="polite">
                <KeyRound size={18} />
                <div>
                  <strong>{apiKeyMissing ? "未配置密钥来源" : `密钥来源：${keySourceText(apiKeySource)}`}</strong>
                  <span>可使用 DEEPSEEK_API_KEY 环境变量或本地配置；此页只显示来源，不显示真实密钥。</span>
                </div>
              </div>
              <Field id="settings-api-key-source" label="API key 来源">
                <div
                  className="readonly-field"
                  id="settings-api-key-source"
                  role="status"
                  aria-labelledby="settings-api-key-source-label"
                  aria-live="polite"
                >
                  <KeyRound size={15} />
                  {keySourceText(apiKeySource)}
                </div>
              </Field>
              <Field id="settings-provider" label="服务商">
                <input id="settings-provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
              </Field>
              <Field id="settings-model" label="模型">
                <OptionPicker label="模型" options={settingsModelOptions} value={model} onChange={setModel} />
              </Field>
              <Field id="settings-approval" label="审批">
                <OptionPicker label="审批" options={approvalOptions} value={approvalPolicy} onChange={setApprovalPolicy} />
              </Field>
              <Field id="settings-sandbox" label="沙箱">
                <OptionPicker label="沙箱" options={sandboxOptions} value={sandboxMode} onChange={setSandboxMode} />
              </Field>
              <Field id="settings-reasoning" label="思考">
                <OptionPicker label="思考" options={reasoningOptions} value={reasoningEffort} onChange={setReasoningEffort} />
              </Field>
              <ToggleSetting checked={allowShell} id="settings-allow-shell" label="允许 shell" description="允许运行命令工具" onChange={setAllowShell} />
              <ToggleSetting checked={yolo} id="settings-yolo" label="YOLO 模式" description="跳过常规确认，并同步启用 shell" onChange={toggleYolo} />
              <div className="form-actions">
                <button type="submit">
                  <Check size={15} />
                  保存
                </button>
              </div>
            </form>
          </Panel>
        ) : null}

        {section === "runtime" ? (
          <>
            <Panel title="运行概览" icon={<Gauge size={18} />} action={<StatusPill tone={props.runtime?.ready ? "green" : "amber"}>{props.runtime?.ready ? "就绪" : "启动中"}</StatusPill>}>
              <div className="metric-grid">
                <Metric label="端口" value={props.runtime?.port ? String(props.runtime.port) : "n/a"} />
                <Metric label="PID" value={props.runtime?.pid ? String(props.runtime.pid) : "n/a"} />
                <Metric label="模型" value={props.config?.default_model ?? "n/a"} />
                <Metric label="密钥" value={keySourceText(props.config?.api_key_source)} />
                <Metric label="输入" value={formatNumber(totals?.input_tokens)} />
                <Metric label="输出" value={formatNumber(totals?.output_tokens)} />
                <Metric label="成本" value={`$${(totals?.cost_usd ?? 0).toFixed(4)}`} />
                <Metric label="上下文" value={contextStatusLabel(null, props.usage)} />
              </div>
              <div className="form-actions inline-settings-actions">
                <button type="button" onClick={props.onRestart}>
                  <RefreshCw size={15} />
                  重启运行时
                </button>
              </div>
            </Panel>
            <Panel title="路径与服务" icon={<Terminal size={18} />}>
              <Metric label="项目" value={props.config?.workspace ?? "n/a"} />
              <Metric label="Base URL" value={props.config?.base_url ?? "n/a"} />
              <Metric label="配置" value={props.config?.config_path ?? "n/a"} />
              <Metric label="MCP config" value={props.config?.mcp_config_path ?? "n/a"} />
              <Metric label="技能目录" value={props.config?.skills_dir ?? "n/a"} />
            </Panel>
          </>
        ) : null}

        {section === "extensions" ? (
          <>
            <Panel title="MCP 状态" icon={<PlugZap size={18} />} action={<StatusPill tone={connectedMcp ? "green" : "gray"}>{connectedMcp}/{mcpServers.length}</StatusPill>}>
              <div className="record-list compact">
                {mcpServers.map((server) => (
                  <div className="record-row" key={server.name}>
                    <div>
                      <strong>{server.name}</strong>
                      <span>{server.command || server.url || "未设置启动方式"}</span>
                    </div>
                    <StatusPill tone={server.connected ? "green" : server.enabled ? "amber" : "gray"}>
                      {server.connected ? "已连接" : server.enabled ? "已启用" : "已禁用"}
                    </StatusPill>
                  </div>
                ))}
                {!mcpServers.length ? <EmptyMini text="暂无 MCP 服务" /> : null}
              </div>
            </Panel>
            <Panel title="技能" icon={<ToggleRight size={18} />} action={<StatusPill tone={enabledSkills ? "green" : "gray"}>{enabledSkills}/{skillItems.length}</StatusPill>}>
              <div className="skill-list compact-list">
                {skillItems.map((skill) => (
                  <button
                    className="skill-row"
                    key={skill.name}
                    type="button"
                    onClick={() => void props.onSkillToggle(skill.name, !skill.enabled)}
                  >
                    {skill.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                    <span>{skill.name}</span>
                  </button>
                ))}
                {!skillItems.length ? <EmptyMini text="未发现技能" /> : null}
              </div>
            </Panel>
          </>
        ) : null}

        {section === "logs" ? (
          <Panel title="运行日志" icon={<Activity size={18} />}>
            <div className="log-list tall">
              {props.logs.map((entry) => (
                <div className={`log-row ${entry.level}`} key={`${entry.ts}:${entry.message}`}>
                  <span>{new Date(entry.ts).toLocaleTimeString("zh-CN")}</span>
                  <strong>{entry.message}</strong>
                </div>
              ))}
              {!props.logs.length ? <EmptyMini text="暂无日志" /> : null}
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

const workspaceOpenOptions: Array<{ icon: ReactNode; label: string; target: WorkspaceOpenTarget }> = [
  { icon: <Code2 size={15} />, label: "VS Code", target: "vscode" },
  { icon: <Code2 size={15} />, label: "Visual Studio", target: "visual-studio" },
  { icon: <FolderOpen size={15} />, label: "资源管理器", target: "file-explorer" },
  { icon: <Terminal size={15} />, label: "终端", target: "terminal" }
];

function WorkspaceOpenMenu({
  onWorkspaceOpen
}: {
  onWorkspaceOpen(target: WorkspaceOpenTarget): void;
}) {
  return (
    <div className="workspace-open-menu" role="menu" aria-label="打开项目">
      {workspaceOpenOptions.map((option) => (
        <button key={option.target} type="button" role="menuitem" onClick={() => onWorkspaceOpen(option.target)}>
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function ConversationToolbar({
  menuOpen,
  onInterrupt,
  onProjectMenu,
  onWorkspaceMenuToggle,
  onWorkspaceOpen,
  turnActive,
  workspaceReady
}: {
  menuOpen: boolean;
  onInterrupt(): void;
  onProjectMenu(event: MouseEvent<HTMLButtonElement>): void;
  onWorkspaceMenuToggle(event: MouseEvent<HTMLButtonElement>): void;
  onWorkspaceOpen(target: WorkspaceOpenTarget): void;
  turnActive: boolean;
  workspaceReady: boolean;
}) {
  return (
    <div className="conversation-toolbar" onContextMenu={(event) => event.stopPropagation()}>
      {turnActive ? (
        <button className="toolbar-button" type="button" onClick={onInterrupt}>
          <Square size={15} />
          终止 turn
        </button>
      ) : null}
      <div className="toolbar-menu-wrap">
        <button
          className="icon-button"
          type="button"
          aria-label="打开项目"
          aria-expanded={menuOpen}
          disabled={!workspaceReady}
          onClick={onWorkspaceMenuToggle}
        >
          <FolderOpen size={16} />
          <ChevronRight size={12} />
        </button>
        {menuOpen ? <WorkspaceOpenMenu onWorkspaceOpen={onWorkspaceOpen} /> : null}
      </div>
      <button className="icon-button" type="button" aria-label="更多项目操作" disabled={!workspaceReady} onClick={onProjectMenu}>
        <MoreHorizontal size={17} />
      </button>
    </div>
  );
}

function ThreadContextMenu({
  onArchiveThread,
  onDeleteThread,
  onRemoveThread,
  style
}: {
  onArchiveThread(): void;
  onDeleteThread(): void;
  onRemoveThread(): void;
  style: { left: number; top: number };
}) {
  return (
    <div className="context-menu thread-context-menu" role="menu" style={style} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" role="menuitem" onClick={onArchiveThread}>
        <Archive size={15} />
        归档会话
      </button>
      <button type="button" role="menuitem" onClick={onRemoveThread}>
        <X size={15} />
        移除会话
      </button>
      <button className="danger" type="button" role="menuitem" onClick={onDeleteThread}>
        <Trash2 size={15} />
        删除会话
      </button>
    </div>
  );
}

function ProjectContextMenu({
  onMakeActive,
  onRemoveProject,
  onRenameProject,
  onTogglePinnedProject,
  pinnedProject,
  style
}: {
  onMakeActive(): void;
  onRemoveProject(): void;
  onRenameProject(): void;
  onTogglePinnedProject(): void;
  pinnedProject: boolean;
  style: { left: number; top: number };
}) {
  return (
    <div className="context-menu project-context-menu" role="menu" style={style} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" role="menuitem" onClick={onMakeActive}>
        <Check size={15} />
        设为当前项目
      </button>
      <button type="button" role="menuitem" onClick={onTogglePinnedProject}>
        <Pin size={15} />
        {pinnedProject ? "取消置顶项目" : "置顶项目"}
      </button>
      <button type="button" role="menuitem" onClick={onRenameProject}>
        <Edit3 size={15} />
        重命名项目
      </button>
      <button type="button" role="menuitem" onClick={onRemoveProject}>
        <X size={15} />
        移除项目
      </button>
    </div>
  );
}

function WorkspaceContextMenu({
  onCreateWorktree,
  onRemoveWorkspace,
  onRenameWorkspace,
  onTogglePinnedWorkspace,
  onWorkspaceOpen,
  pinnedWorkspace,
  style
}: {
  onCreateWorktree(): void;
  onRemoveWorkspace(): void;
  onRenameWorkspace(): void;
  onTogglePinnedWorkspace(): void;
  onWorkspaceOpen(target: WorkspaceOpenTarget): void;
  pinnedWorkspace: boolean;
  style: { left: number; top: number };
}) {
  return (
    <div className="context-menu workspace-context-menu" role="menu" style={style} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" role="menuitem" onClick={onTogglePinnedWorkspace}>
        <Pin size={15} />
        {pinnedWorkspace ? "取消置顶项目" : "置顶项目"}
      </button>
      <div className="menu-submenu">
        <button type="button" role="menuitem" onClick={() => onWorkspaceOpen("file-explorer")}>
        <FolderOpen size={15} />
        在资源管理器中打开
          <ChevronRight size={13} />
        </button>
        <WorkspaceOpenMenu onWorkspaceOpen={onWorkspaceOpen} />
      </div>
      <button type="button" role="menuitem" onClick={onCreateWorktree}>
        <FolderTree size={15} />
        创建永久工作树
      </button>
      <button type="button" role="menuitem" onClick={onRenameWorkspace}>
        <Edit3 size={15} />
        重命名项目
      </button>
      <button type="button" role="menuitem" onClick={onRemoveWorkspace}>
        <X size={15} />
        移除项目
      </button>
    </div>
  );
}

function ProcessedHistoryGroup({ items, processedAt }: { items: TurnItemRecord[]; processedAt?: string | null }) {
  return (
    <details className="processed-history" data-processed-history>
      <summary>
        <Check size={15} />
        <strong>已处理</strong>
        <span>{processedAt ? formatDate(processedAt) : "刚刚"}</span>
        <ChevronRight className="processed-chevron" size={14} />
      </summary>
      <div className="processed-history-list">
        {items.map((item) => (
          <TurnItem collapseWhenDone={false} item={item} key={item.id} turnActive={false} />
        ))}
      </div>
    </details>
  );
}

function TurnItem({
  collapseWhenDone,
  item,
  turnActive
}: {
  collapseWhenDone: boolean;
  item: TurnItemRecord;
  turnActive: boolean;
}) {
  const tone = itemTone(item.kind, item.status);
  const content = item.detail || item.summary;
  const displayTitle = turnItemTitle(item);
  const displaySummary = turnItemSummary(item);
  if (item.kind === "user_message" || item.kind === "agent_message") {
    const isUser = item.kind === "user_message";
    if (collapseWhenDone) {
      return (
        <details className={`turn-item detail-item chat-collapsed ${tone}`}>
          <summary>
            <span className="turn-icon">{isUser ? <User size={16} /> : <Bot size={16} />}</span>
            <strong>{isUser ? "上文提问" : "中间回复"}</strong>
            <StatusIcon status={item.status} />
          </summary>
          <MarkdownContent content={content} />
        </details>
      );
    }
    return (
      <article className={`turn-item chat ${isUser ? "user" : "assistant"}`}>
        <div className="turn-icon">{isUser ? <User size={16} /> : <Bot size={16} />}</div>
        <div className="turn-body">
          <div className="turn-head">
            <strong>{isUser ? "你" : "DeepSeek"}</strong>
            <StatusIcon status={item.status} />
          </div>
          <MarkdownContent content={content} />
        </div>
      </article>
    );
  }
  if (item.kind === "agent_reasoning") {
    const open = turnActive || item.status === "in_progress";
    return (
      <details className={`turn-item detail-item ${tone}`} open={open}>
        <summary>
          <span className="turn-icon">
            <Activity size={16} />
          </span>
          <strong>{displayTitle}</strong>
          {displaySummary && displaySummary !== content ? <span>{displaySummary}</span> : null}
          <StatusIcon status={item.status} />
        </summary>
        <MarkdownContent content={content} />
      </details>
    );
  }
  const open = item.status === "in_progress" || (!collapseWhenDone && turnActive);
  return (
    <details className={`turn-item detail-item ${tone}`} open={open}>
      <summary>
        <span className="turn-icon">
          {item.kind.includes("command") || item.kind.includes("tool") ? <Terminal size={16} /> : <Activity size={16} />}
        </span>
        <strong>{displayTitle}</strong>
        {displaySummary ? <span>{displaySummary}</span> : null}
        <StatusIcon status={item.status} />
      </summary>
      <MarkdownContent content={item.detail || item.summary} />
    </details>
  );
}

function StatusIcon({ status }: { status?: string | null }) {
  const value = status ?? "unknown";
  if (value === "failed" || value === "error") {
    return (
      <span className="status-icon red" title={statusText(value)} aria-label={statusText(value)}>
        <X size={13} />
      </span>
    );
  }
  if (value === "in_progress" || value === "running" || value === "queued") {
    return (
      <span className="status-icon amber" title={statusText(value)} aria-label={statusText(value)}>
        <Loader2 className="spin" size={13} />
      </span>
    );
  }
  if (value === "completed" || value === "ready") {
    return (
      <span className="status-icon green" title={statusText(value)} aria-label={statusText(value)}>
        <Check size={13} />
      </span>
    );
  }
  return (
    <span className="status-icon gray" title={statusText(value)} aria-label={statusText(value)}>
      <Activity size={13} />
    </span>
  );
}

function statusBadgeTone(value?: string | null): "green" | "amber" | "red" | "blue" | "gray" {
  if (value === "failed" || value === "error" || value === "denied") {
    return "red";
  }
  if (value === "running" || value === "queued" || value === "in_progress" || value === "paused") {
    return "amber";
  }
  if (value === "completed" || value === "ready" || value === "active" || value === "allowed") {
    return "green";
  }
  return "gray";
}

function statusLabel(value?: string | null) {
  switch (value) {
    case "active":
      return "启用";
    case "allowed":
      return "已允许";
    case "canceled":
      return "取消";
    case "completed":
      return "完成";
    case "denied":
      return "已拒绝";
    case "disabled":
      return "停用";
    case "failed":
    case "error":
      return "失败";
    case "in_progress":
    case "running":
      return "运行";
    case "paused":
      return "暂停";
    case "queued":
      return "排队";
    case "ready":
      return "就绪";
    default:
      return statusText(value);
  }
}

function StatusBadge({ label, status }: { label?: string; status?: string | null }) {
  const text = label ?? statusLabel(status);
  return (
    <span className={`status-badge ${statusBadgeTone(status)}`} title={statusLabel(status)} data-status-badge={status ?? "unknown"}>
      <StatusIcon status={status} />
      <span>{text}</span>
    </span>
  );
}

function NavButton({
  active,
  badge,
  icon,
  label,
  onClick
}: {
  active: boolean;
  badge?: number;
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <span className="nav-label">{label}</span>
      {typeof badge === "number" ? <span className="nav-badge">{badge}</span> : null}
    </button>
  );
}

function Panel({ action, children, icon, title }: { action?: ReactNode; children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          {icon}
          <strong>{title}</strong>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ children, id, label }: { children: ReactNode; id?: string; label: string }) {
  const labelId = id ? `${id}-label` : undefined;
  return (
    <div className="field" data-setting-row>
      <span id={labelId}>{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ children, tone }: { children: ReactNode; tone: "green" | "amber" | "red" | "blue" | "gray" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function SummaryStrip({
  items
}: {
  items: Array<{ label: string; value: number | string; tone: "green" | "amber" | "red" | "blue" | "gray" }>;
}) {
  return (
    <div className="summary-strip" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div className={`summary-cell ${item.tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <div className="empty-mini">{text}</div>;
}

function SetupState({ onOpenSettings }: { onOpenSettings(): void }) {
  return (
    <div className="setup-state">
      <div className="setup-icon">
        <KeyRound size={22} />
      </div>
      <div>
        <strong>配置密钥后开始会话</strong>
        <span>当前仍可浏览项目、查看运行状态和调整设置；发送消息前需要配置密钥来源。</span>
      </div>
      <button type="button" onClick={onOpenSettings}>
        <Settings size={15} />
        打开设置
      </button>
    </div>
  );
}

function WorkspaceSetupState({ onChooseWorkspace }: { onChooseWorkspace(): void }) {
  return (
    <div className="setup-state">
      <div className="setup-icon">
        <FolderTree size={22} />
      </div>
      <div>
        <strong>选择项目后开始</strong>
        <span>会话会按项目分组保存。左侧添加或设为当前项目后，再创建新会话。</span>
      </div>
      <button type="button" onClick={onChooseWorkspace}>
        <Plus size={15} />
        添加项目
      </button>
    </div>
  );
}

function EmptyState({ body, compact, title }: { body?: string; compact?: boolean; title: string }) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}
