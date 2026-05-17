import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import started from "electron-squirrel-startup";
import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  RuntimeEventMessage,
  RuntimeLogEntry,
  RuntimeRequest,
  RuntimeResponse,
  RuntimeStatus,
  SubscribeRequest,
  WorkspaceOpenResult,
  WorkspacePathOpenTarget,
  WorkspaceOpenTarget,
  WorkspaceState
} from "./shared";
import { parseStartupPayloadLine } from "./runtimeStartup";
import { resolveSidecarBinaryPath, resolveWorkspacePath } from "./runtimePaths";

if (started) {
  app.quit();
}

type Subscription = {
  abort: AbortController;
  channelId: string;
};

type UiSmokeDumpPayload = {
  capturedAt: string;
  location: string;
  title: string;
  text: string;
  normalizedText: string;
  textLength: number;
  tabs: Array<{
    id: string;
    text: string;
    selected: boolean;
    controls: string;
    visible: boolean;
  }>;
  panels: Array<{
    id: string;
    labelledBy: string;
    text: string;
    visible: boolean;
  }>;
  controls: Array<{
    tag: string;
    type: string;
    text: string;
    ariaLabel: string;
    visible: boolean;
  }>;
  switches: Array<{
    id: string;
    text: string;
    checked: boolean;
    visible: boolean;
  }>;
  leakSignals: {
    hasOpenAiStyleKey: boolean;
    hasDeepseekToken: boolean;
    hasRuntimeTokenShape: boolean;
  };
  layout: {
    viewport: { width: number; height: number };
    document: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
    horizontalOverflow: boolean;
    roots: Array<{
      selector: string;
      x: number;
      y: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
    }>;
    rootOverlaps: Array<{ a: string; b: string; area: number }>;
    textOverflows: Array<{
      selector: string;
      text: string;
      clientWidth: number;
      scrollWidth: number;
      clientHeight: number;
      scrollHeight: number;
    }>;
    statusFooter?: {
      width: number;
      height: number;
      itemCount: number;
      scrollWidth: number;
      clientWidth: number;
    } | null;
    topBar?: { selector: string; x: number; y: number; width: number; height: number; right: number; bottom: number } | null;
    mainSurface?: { selector: string; x: number; y: number; width: number; height: number; right: number; bottom: number } | null;
    threadPane?: { selector: string; x: number; y: number; width: number; height: number; right: number; bottom: number } | null;
    timeline?: { selector: string; x: number; y: number; width: number; height: number; right: number; bottom: number } | null;
    settingsLayout?: {
      className: string;
      width: number;
      panelCount: number;
      panelWidths: number[];
    } | null;
    threadRows?: {
      count: number;
      maxHeight: number;
      minHeight: number;
    };
    composerControls?: {
      count: number;
      maxWidth: number;
      stripHeight: number;
    };
    operationRows?: {
      count: number;
      maxHeight: number;
    };
    settingRows?: {
      count: number;
      maxHeight: number;
    };
    turnItems?: {
      chatArticles: number;
      detailItems: number;
      openDetails: number;
      collapsedChatDetails: number;
    };
    processedHistory?: {
      count: number;
      openCount: number;
    };
    menus?: {
      contextMenus: number;
      workspaceMenus: number;
    };
    statusBadges?: number;
    markdown?: { headings: number; lists: number; codeBlocks: number; blockquotes: number; tables: number } | null;
    composer?: {
      className: string;
      x: number;
      y: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
      clientHeight: number;
      scrollHeight: number;
    } | null;
  };
};

let mainWindow: BrowserWindow | null = null;
let sidecar: ChildProcessWithoutNullStreams | null = null;
let runtimeToken = randomBytes(32).toString("hex");
let intentionalStop = false;
let restartAttempts = 0;
let uiSmokeDumpInterval: ReturnType<typeof setInterval> | null = null;
let uiSmokeDumpFailureLogged = false;
let uiSmokeClickPerformed = false;
let uiSmokeClickReadyAt = 0;
let activeWorkspace: string | null = null;
let recentWorkspaces: string[] = [];
let runtimeGeneration = 0;
let runtimeStatus: RuntimeStatus = {
  running: false,
  baseUrl: null,
  port: null,
  pid: null,
  authRequired: false,
  ready: false,
  workspace: null,
  lastError: null
};
let startupPromise: Promise<RuntimeStatus> | null = null;
const subscriptions = new Map<string, Subscription>();
const RECENT_WORKSPACE_LIMIT = 8;

function log(level: RuntimeLogEntry["level"], message: string) {
  const entry: RuntimeLogEntry = { ts: Date.now(), level, message };
  mainWindow?.webContents.send("runtime:log", entry);
  try {
    const logPath = path.join(app.getPath("userData"), "runtime.log");
    fs.appendFileSync(logPath, `${new Date(entry.ts).toISOString()} [${level}] ${message}\n`, "utf8");
  } catch {
    // Best-effort diagnostics only; never break the app because logging failed.
  }
  if (level === "error") {
    console.error(message);
  } else {
    console.log(message);
  }
}

function normalizeWorkspacePath(value: string) {
  return path.resolve(value.trim());
}

function workspaceStorePath() {
  const smokeHome = resolveSmokeHome();
  return smokeHome
    ? path.join(smokeHome, ".deepseek-app", "workspaces.json")
    : path.join(app.getPath("userData"), "workspaces.json");
}

function readRecentWorkspaces() {
  try {
    const raw = fs.readFileSync(workspaceStorePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => normalizeWorkspacePath(item))
      .filter((item, index, items) => fs.existsSync(item) && fs.statSync(item).isDirectory() && items.indexOf(item) === index)
      .slice(0, RECENT_WORKSPACE_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentWorkspaces() {
  const storePath = workspaceStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(recentWorkspaces, null, 2)}\n`, "utf8");
}

function rememberWorkspace(workspace: string) {
  const normalized = normalizeWorkspacePath(workspace);
  if (recentWorkspaces.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    return;
  }
  recentWorkspaces = [...recentWorkspaces.slice(0, RECENT_WORKSPACE_LIMIT - 1), normalized];
  writeRecentWorkspaces();
}

function workspaceState(): WorkspaceState {
  return {
    active: activeWorkspace,
    recent: recentWorkspaces
  };
}

function initializeWorkspaceState() {
  recentWorkspaces = readRecentWorkspaces();
  activeWorkspace = resolveWorkspace();
  if (activeWorkspace) {
    rememberWorkspace(activeWorkspace);
  }
}

function resolveWorkspace() {
  const workspace = resolveWorkspacePath({
    configuredWorkspace: process.env.DEEPSEEK_DESKTOP_WORKSPACE,
    cwd: process.cwd(),
    documentsPath: app.getPath("documents"),
    installRoots: [path.dirname(process.execPath), process.resourcesPath, app.getAppPath()],
    isPackaged: app.isPackaged,
    recentWorkspace: activeWorkspace ?? recentWorkspaces[0] ?? null
  });
  return workspace ? workspace : null;
}

function resolveSmokeHome() {
  const value = process.env.DEEPSEEK_DESKTOP_SMOKE_HOME?.trim();
  return value ? path.resolve(value) : null;
}

function sidecarEnvironment() {
  const env: NodeJS.ProcessEnv = { ...process.env, DEEPSEEK_RUNTIME_TOKEN: runtimeToken };
  const smokeHome = resolveSmokeHome();
  if (!smokeHome) {
    return env;
  }
  env.HOME = smokeHome;
  env.USERPROFILE = smokeHome;
  env.DEEPSEEK_CONFIG_PATH = path.join(smokeHome, ".deepseek", "config.toml");
  env.DEEPSEEK_TASKS_DIR = path.join(smokeHome, ".deepseek", "tasks");
  env.DEEPSEEK_RUNTIME_DIR = path.join(smokeHome, ".deepseek", "runtime");
  return env;
}

function resetRuntimeStatus(error: string | null = null) {
  runtimeStatus = {
    running: false,
    baseUrl: null,
    port: null,
    pid: null,
    authRequired: false,
    ready: false,
    workspace: activeWorkspace,
    lastError: error
  };
}

function stopRuntime() {
  intentionalStop = true;
  runtimeGeneration += 1;
  for (const subscription of subscriptions.values()) {
    subscription.abort.abort();
  }
  subscriptions.clear();
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
  }
  sidecar = null;
  startupPromise = null;
  resetRuntimeStatus();
}

async function startRuntime(): Promise<RuntimeStatus> {
  if (runtimeStatus.ready) {
    return runtimeStatus;
  }
  if (startupPromise) {
    return startupPromise;
  }
  startupPromise = new Promise((resolve) => {
    intentionalStop = false;
    const generation = runtimeGeneration + 1;
    runtimeGeneration = generation;
    const binary = resolveSidecarBinaryPath({
      cwd: process.cwd(),
      envBinary: process.env.DEEPSEEK_DESKTOP_BINARY,
      existsSync: (candidate) => fs.existsSync(candidate),
      isPackaged: app.isPackaged,
      moduleDir: __dirname,
      platform: process.platform,
      resourcesPath: process.resourcesPath
    });
    if (!binary || !fs.existsSync(binary)) {
      resetRuntimeStatus(`runtime binary not found: ${binary}`);
      log("error", runtimeStatus.lastError || "runtime binary not found");
      resolve(runtimeStatus);
      return;
    }

    runtimeToken = randomBytes(32).toString("hex");
    const workspace = resolveWorkspace();
    activeWorkspace = workspace;
    if (!workspace) {
      resetRuntimeStatus("workspace not selected");
      log("warn", runtimeStatus.lastError || "workspace not selected");
      resolve(runtimeStatus);
      return;
    }
    rememberWorkspace(workspace);
    const args = [
      "--workspace",
      workspace,
      "serve",
      "--http",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--startup-json"
    ];
    log("info", `starting runtime: ${binary} ${args.map((arg) => (arg === runtimeToken ? "<token>" : arg)).join(" ")}`);
    sidecar = spawn(binary, args, {
      cwd: workspace,
      env: sidecarEnvironment(),
      windowsHide: true
    });
    runtimeStatus = {
      ...runtimeStatus,
      running: true,
      pid: sidecar.pid ?? null,
      workspace,
      lastError: null
    };

    let stdoutBuffer = "";
    let resolved = false;
    const settle = (status: RuntimeStatus) => {
      if (!resolved) {
        resolved = true;
        resolve(status);
      }
    };

    sidecar.stdout.on("data", (chunk: Buffer) => {
      if (generation !== runtimeGeneration) {
        return;
      }
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const payload = parseStartupPayloadLine(line);
        if (payload) {
          runtimeStatus = {
            running: true,
            baseUrl: payload.base_url,
            port: payload.port,
            pid: sidecar?.pid ?? null,
            authRequired: payload.auth_required,
            ready: true,
            workspace,
            lastError: null
          };
          if (payload.auth_token) {
            runtimeToken = payload.auth_token;
          }
          log("info", `runtime ready on ${payload.base_url}`);
          restartAttempts = 0;
          settle(runtimeStatus);
          continue;
        }
        log("info", line);
      }
    });

    sidecar.stderr.on("data", (chunk: Buffer) => {
      if (generation !== runtimeGeneration) {
        return;
      }
      log("warn", chunk.toString("utf8").trim());
    });

    sidecar.on("error", (error) => {
      if (generation !== runtimeGeneration) {
        return;
      }
      resetRuntimeStatus(error.message);
      log("error", `runtime failed: ${error.message}`);
      settle(runtimeStatus);
    });

    sidecar.on("exit", (code, signal) => {
      if (generation !== runtimeGeneration) {
        return;
      }
      const message = `runtime exited code=${code ?? "null"} signal=${signal ?? "null"}`;
      resetRuntimeStatus(message);
      log(code === 0 ? "info" : "error", message);
      settle(runtimeStatus);
      sidecar = null;
      startupPromise = null;
      if (!intentionalStop && mainWindow && code !== 0 && restartAttempts < 3) {
        restartAttempts += 1;
        const delay = 800 * restartAttempts;
        log("warn", `runtime restart scheduled in ${delay}ms`);
        setTimeout(() => {
          if (!intentionalStop && mainWindow) {
            void startRuntime();
          }
        }, delay);
      }
    });
  });

  return startupPromise;
}

async function requestRuntime<T = unknown>(request: RuntimeRequest): Promise<RuntimeResponse<T>> {
  if (!request.path.startsWith("/") || request.path.startsWith("//")) {
    return {
      ok: false,
      status: 400,
      data: { error: { message: "runtime request path must be local" } } as T
    };
  }
  await startRuntime();
  if (!runtimeStatus.baseUrl) {
    return {
      ok: false,
      status: 503,
      data: { error: { message: runtimeStatus.lastError || "runtime unavailable" } } as T
    };
  }
  const url = new URL(request.path, runtimeStatus.baseUrl);
  const response = await fetch(url, {
    method: request.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtimeToken}`
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });
  const text = await response.text();
  let data: unknown = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data: data as T
  };
}

async function subscribeThreadEvents(request: SubscribeRequest) {
  await startRuntime();
  if (!runtimeStatus.baseUrl) {
    throw new Error(runtimeStatus.lastError || "runtime unavailable");
  }
  subscriptions.get(request.channelId)?.abort.abort();
  const abort = new AbortController();
  subscriptions.set(request.channelId, { abort, channelId: request.channelId });
  const since = request.sinceSeq ?? 0;
  const url = new URL(`/v1/threads/${encodeURIComponent(request.threadId)}/events`, runtimeStatus.baseUrl);
  url.searchParams.set("since_seq", String(since));

  void fetch(url, {
    headers: { authorization: `Bearer ${runtimeToken}` },
    signal: abort.signal
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error(`event stream failed: HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const event = parseSseFrame(request.channelId, frame);
          if (event) {
            mainWindow?.webContents.send("runtime:event", event);
          }
        }
      }
    })
    .catch((error: Error) => {
      if (!abort.signal.aborted) {
        log("warn", error.message);
      }
    });
}

async function switchWorkspace(workspacePath: string): Promise<WorkspaceState> {
  const workspace = normalizeWorkspacePath(workspacePath);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`workspace is not a directory: ${workspace}`);
  }
  if (activeWorkspace?.toLowerCase() === workspace.toLowerCase()) {
    rememberWorkspace(workspace);
    return workspaceState();
  }
  stopRuntime();
  activeWorkspace = workspace;
  resetRuntimeStatus();
  rememberWorkspace(workspace);
  await startRuntime();
  return workspaceState();
}

async function forgetWorkspace(workspacePath: string): Promise<WorkspaceState> {
  const workspace = normalizeWorkspacePath(workspacePath);
  recentWorkspaces = recentWorkspaces.filter((item) => item.toLowerCase() !== workspace.toLowerCase());
  writeRecentWorkspaces();
  if (activeWorkspace?.toLowerCase() !== workspace.toLowerCase()) {
    return workspaceState();
  }
  stopRuntime();
  activeWorkspace = recentWorkspaces[0] ?? null;
  resetRuntimeStatus();
  if (activeWorkspace) {
    await startRuntime();
  }
  return workspaceState();
}

async function chooseWorkspaceDirectory(): Promise<WorkspaceState> {
  const options: OpenDialogOptions = {
    buttonLabel: "Select workspace",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return workspaceState();
  }
  return switchWorkspace(result.filePaths[0]);
}

function psQuoted(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function fileUri(value: string) {
  return `file:///${value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:")}`;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function workspaceMissingResult(): WorkspaceOpenResult {
  return { ok: false, message: "No workspace selected" };
}

function isInsidePath(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspaceChild(workspacePath: string): WorkspaceOpenResult & { path?: string } {
  const workspace = activeWorkspace;
  if (!workspace || !fs.existsSync(workspace)) {
    return workspaceMissingResult();
  }
  const value = workspacePath.trim();
  if (!value || value.includes("\0")) {
    return { ok: false, message: "路径无效" };
  }
  const resolved = path.resolve(workspace, value);
  const workspaceRealPath = fs.realpathSync(workspace);
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: `路径不存在: ${value}` };
  }
  const targetRealPath = fs.realpathSync(resolved);
  if (!isInsidePath(workspaceRealPath, targetRealPath)) {
    return { ok: false, message: "路径不在当前项目内" };
  }
  return { ok: true, path: targetRealPath };
}

function spawnDetached(command: string, args: string[], cwd = activeWorkspace ?? undefined): Promise<WorkspaceOpenResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: WorkspaceOpenResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
    } catch (error) {
      settle({ ok: false, message: readableError(error) });
      return;
    }
    child.once("error", (error) => settle({ ok: false, message: readableError(error) }));
    child.unref();
    setTimeout(() => settle({ ok: true }), 300);
  });
}

function openWindowsPowerShell(workspace: string) {
  const command = `Set-Location -LiteralPath ${psQuoted(workspace)}`;
  return spawnDetached(
    "cmd.exe",
    ["/d", "/s", "/c", "start", "\"\"", "powershell.exe", "-NoExit", "-Command", command],
    workspace
  );
}

function openDefaultTerminal(workspace: string) {
  if (process.platform === "win32") {
    return openWindowsPowerShell(workspace);
  }
  const shellPath = process.env.SHELL || "sh";
  return spawnDetached(shellPath, [], workspace);
}

function visualStudioPath() {
  const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!fs.existsSync(vswhere)) {
    return null;
  }
  const result = spawnSync(vswhere, ["-latest", "-products", "*", "-property", "productPath"], { encoding: "utf8" });
  const productPath = result.stdout.trim().split(/\r?\n/)[0];
  return productPath && fs.existsSync(productPath) ? productPath : null;
}

async function openWorkspace(target: WorkspaceOpenTarget): Promise<WorkspaceOpenResult> {
  const workspace = activeWorkspace;
  if (!workspace || !fs.existsSync(workspace)) {
    return workspaceMissingResult();
  }
  if (!["file-explorer", "terminal", "vscode", "visual-studio"].includes(target)) {
    return { ok: false, message: "未知打开方式" };
  }
  try {
    if (target === "file-explorer") {
      const result = await shell.openPath(workspace);
      return result ? { ok: false, message: result } : { ok: true };
    }
    if (target === "terminal") {
      return openDefaultTerminal(workspace);
    }
    if (target === "vscode") {
      await shell.openExternal(`vscode://file/${workspace.replace(/\\/g, "/")}`);
      return { ok: true };
    }
    if (target === "visual-studio") {
      const devenv = visualStudioPath();
      if (devenv) {
        return spawnDetached(devenv, [workspace], workspace);
      }
      await shell.openExternal(`vs://open?url=${encodeURIComponent(fileUri(workspace))}`);
      return { ok: true };
    }
    return { ok: false, message: "未知打开方式" };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

async function openWorkspacePath(workspacePath: string, target: WorkspacePathOpenTarget): Promise<WorkspaceOpenResult> {
  if (!["file", "folder"].includes(target)) {
    return { ok: false, message: "未知打开方式" };
  }
  try {
    const resolved = resolveWorkspaceChild(workspacePath);
    if (!resolved.ok || !resolved.path) {
      return { ok: false, message: resolved.message };
    }
    const stat = fs.statSync(resolved.path);
    if (target === "file") {
      if (!stat.isFile()) {
        return { ok: false, message: "目标不是文件" };
      }
      const result = await shell.openPath(resolved.path);
      return result ? { ok: false, message: result } : { ok: true };
    }
    if (!stat.isDirectory()) {
      return { ok: false, message: "目标不是文件夹" };
    }
    const result = await shell.openPath(resolved.path);
    return result ? { ok: false, message: result } : { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}
async function createPermanentWorktree(): Promise<WorkspaceState> {
  const workspace = activeWorkspace;
  if (!workspace || !fs.existsSync(workspace)) {
    throw new Error("No workspace selected");
  }
  const root = spawnSync("git.exe", ["-C", workspace, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (root.status !== 0) {
    throw new Error("褰撳墠宸ヤ綔鍖轰笉鏄?Git 浠撳簱");
  }
  const options: OpenDialogOptions = {
    buttonLabel: "閫夋嫨淇濆瓨浣嶇疆",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return workspaceState();
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const target = path.join(result.filePaths[0], `${path.basename(workspace)}-worktree-${stamp}`);
  const branch = `worktree-${stamp}`;
  const created = spawnSync("git.exe", ["-C", workspace, "worktree", "add", target, "-b", branch], { encoding: "utf8" });
  if (created.status !== 0) {
    throw new Error((created.stderr || created.stdout || "Failed to create worktree").trim());
  }
  return switchWorkspace(target);
}

function parseSseFrame(channelId: string, frame: string): RuntimeEventMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) {
    return null;
  }
  const raw = data.join("\n");
  try {
    return { channelId, event, data: JSON.parse(raw) };
  } catch {
    return { channelId, event, data: raw };
  }
}

function uiSmokeDumpPath() {
  const value = process.env.DEEPSEEK_DESKTOP_UI_SMOKE_DUMP?.trim();
  return value ? path.resolve(value) : null;
}

function uiSmokeScreenshotPath() {
  const value = process.env.DEEPSEEK_DESKTOP_UI_SMOKE_SCREENSHOT?.trim();
  return value ? path.resolve(value) : null;
}

function stopUiSmokeDump() {
  if (uiSmokeDumpInterval) {
    clearInterval(uiSmokeDumpInterval);
    uiSmokeDumpInterval = null;
  }
}

function startUiSmokeDump(window: BrowserWindow) {
  const dumpPath = uiSmokeDumpPath();
  const screenshotPath = uiSmokeScreenshotPath();
  if (!dumpPath && !screenshotPath) {
    return;
  }
  stopUiSmokeDump();
  uiSmokeDumpFailureLogged = false;
  uiSmokeClickPerformed = false;
  uiSmokeClickReadyAt = Date.now() + 2500;

  const writeDump = async () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    try {
      await runUiSmokeClick(window);
      const payload = (await window.webContents.executeJavaScript(
        `(() => {
          const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const isVisible = (element) => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
          const rectFor = (element, selector) => {
            const rect = element.getBoundingClientRect();
            return {
              selector,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom)
            };
          };
          const rootSelectors = [".left-rail", ".main-surface", ".right-rail"];
          const topBar = document.querySelector(".top-bar");
          const statusFooter = document.querySelector(".global-status-bar");
          const composer = document.querySelector(".composer");
          const mainSurface = document.querySelector(".main-surface");
          const threadPane = document.querySelector(".thread-pane");
          const timeline = document.querySelector(".timeline");
          const settingsLayout = document.querySelector(".settings-layout");
          const threadRows = Array.from(document.querySelectorAll("[data-thread-row]")).filter(isVisible);
          const operationRows = Array.from(document.querySelectorAll("[data-operation-row]")).filter(isVisible);
          const settingRows = Array.from(document.querySelectorAll("[data-setting-row]")).filter(isVisible);
          const composerControls = Array.from(document.querySelectorAll("[data-composer-control]")).filter(isVisible);
          const composerControlStrip = document.querySelector(".composer-control-strip");
          const turnDetailItems = Array.from(document.querySelectorAll(".timeline .turn-item.detail-item")).filter(isVisible);
          const topLevelTurnChatArticles = Array.from(document.querySelectorAll(".timeline > .turn-item.chat")).filter(isVisible);
          const processedHistory = Array.from(document.querySelectorAll("[data-processed-history]")).filter(isVisible);
          const roots = rootSelectors
            .map((selector) => {
              const element = document.querySelector(selector);
              return element && isVisible(element) ? rectFor(element, selector) : null;
            })
            .filter(Boolean);
          const rightRail = document.querySelector(".right-rail");
          const rootOverlaps = [];
          for (let i = 0; i < roots.length; i += 1) {
            for (let j = i + 1; j < roots.length; j += 1) {
              const a = roots[i];
              const b = roots[j];
              const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
              const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
              const area = width * height;
              if (area > 1) {
                rootOverlaps.push({ a: a.selector, b: b.selector, area });
              }
            }
          }
          const textOverflows = Array.from(document.querySelectorAll("button, input, select, textarea, .status-pill, .status-badge, .footer-item, .metric, .nav-button"))
            .filter((element) => isVisible(element) && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
            .slice(0, 20)
            .map((element) => ({
              selector: element.id ? "#" + element.id : element.className ? "." + String(element.className).trim().replace(/\\s+/g, ".") : element.tagName.toLowerCase(),
              text: compact(element.textContent || element.getAttribute("value") || element.getAttribute("placeholder") || element.getAttribute("aria-label")).slice(0, 120),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight
            }));
          const text = document.body?.innerText || "";
          return {
            capturedAt: new Date().toISOString(),
            location: window.location.href,
            title: document.title,
            text,
            normalizedText: compact(text),
            textLength: text.length,
            tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => ({
              id: tab.id || "",
              text: compact(tab.textContent),
              selected: tab.getAttribute("aria-selected") === "true",
              controls: tab.getAttribute("aria-controls") || "",
              visible: isVisible(tab)
            })),
            panels: Array.from(document.querySelectorAll('[role="tabpanel"]')).map((panel) => ({
              id: panel.id || "",
              labelledBy: panel.getAttribute("aria-labelledby") || "",
              text: compact(panel.textContent).slice(0, 700),
              visible: isVisible(panel)
            })),
            controls: Array.from(document.querySelectorAll('button, input, select, textarea')).map((control) => ({
              tag: control.tagName.toLowerCase(),
              type: control.getAttribute("type") || "",
              text: compact(control.textContent || control.getAttribute("value") || control.getAttribute("placeholder")),
              ariaLabel: control.getAttribute("aria-label") || "",
              visible: isVisible(control)
            })),
            switches: Array.from(document.querySelectorAll('[role="switch"]')).map((control) => ({
              id: control.id || "",
              text: compact(control.textContent),
              checked: control.getAttribute("aria-checked") === "true",
              visible: isVisible(control)
            })),
            leakSignals: {
              hasOpenAiStyleKey: /sk-[A-Za-z0-9_-]{8,}/.test(text),
              hasDeepseekToken: /dst_[A-Za-z0-9_-]{8,}/.test(text),
              hasRuntimeTokenShape: /\\b[a-f0-9]{64}\\b/i.test(text)
            },
            layout: {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              document: {
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                scrollHeight: document.documentElement.scrollHeight,
                clientHeight: document.documentElement.clientHeight
              },
              horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
              roots,
              rightRail: rightRail
                ? {
                    className: String(rightRail.className || ""),
                    width: Math.round(rightRail.getBoundingClientRect().width),
                    clientHeight: rightRail.clientHeight,
                    scrollHeight: rightRail.scrollHeight
                  }
                : null,
              statusFooter: statusFooter && isVisible(statusFooter)
                ? {
                    width: Math.round(statusFooter.getBoundingClientRect().width),
                    height: Math.round(statusFooter.getBoundingClientRect().height),
                    itemCount: statusFooter.querySelectorAll("[data-footer-item]").length,
                    scrollWidth: statusFooter.scrollWidth,
                    clientWidth: statusFooter.clientWidth
                  }
                : null,
              topBar: topBar && isVisible(topBar) ? rectFor(topBar, ".top-bar") : null,
              mainSurface: mainSurface && isVisible(mainSurface) ? rectFor(mainSurface, ".main-surface") : null,
              threadPane: threadPane && isVisible(threadPane) ? rectFor(threadPane, ".thread-pane") : null,
              timeline: timeline && isVisible(timeline) ? rectFor(timeline, ".timeline") : null,
              settingsLayout: settingsLayout && isVisible(settingsLayout)
                ? {
                    className: String(settingsLayout.className || ""),
                    width: Math.round(settingsLayout.getBoundingClientRect().width),
                    panelCount: Array.from(settingsLayout.querySelectorAll(":scope > .panel")).filter(isVisible).length,
                    panelWidths: Array.from(settingsLayout.querySelectorAll(":scope > .panel"))
                      .filter(isVisible)
                      .map((panel) => Math.round(panel.getBoundingClientRect().width))
                  }
                : null,
              threadRows: {
                count: threadRows.length,
                maxHeight: threadRows.length ? Math.max(...threadRows.map((row) => Math.round(row.getBoundingClientRect().height))) : 0,
                minHeight: threadRows.length ? Math.min(...threadRows.map((row) => Math.round(row.getBoundingClientRect().height))) : 0
              },
              composerControls: {
                count: composerControls.length,
                maxWidth: composerControls.length ? Math.max(...composerControls.map((control) => Math.round(control.getBoundingClientRect().width))) : 0,
                stripHeight: composerControlStrip && isVisible(composerControlStrip) ? Math.round(composerControlStrip.getBoundingClientRect().height) : 0
              },
              operationRows: {
                count: operationRows.length,
                maxHeight: operationRows.length ? Math.max(...operationRows.map((row) => Math.round(row.getBoundingClientRect().height))) : 0
              },
              settingRows: {
                count: settingRows.length,
                maxHeight: settingRows.length ? Math.max(...settingRows.map((row) => Math.round(row.getBoundingClientRect().height))) : 0
              },
              turnItems: {
                chatArticles: topLevelTurnChatArticles.length,
                detailItems: turnDetailItems.length,
                openDetails: turnDetailItems.filter((item) => item instanceof HTMLDetailsElement && item.open).length,
                collapsedChatDetails: turnDetailItems.filter((item) => item.classList.contains("chat-collapsed")).length
              },
              processedHistory: {
                count: processedHistory.length,
                openCount: processedHistory.filter((item) => item instanceof HTMLDetailsElement && item.open).length
              },
              menus: {
                contextMenus: Array.from(document.querySelectorAll(".conversation-menu")).filter(isVisible).length,
                workspaceMenus: Array.from(document.querySelectorAll(".workspace-open-menu")).filter(isVisible).length
              },
              statusBadges: document.querySelectorAll("[data-status-badge]").length,
              markdown: {
                headings: document.querySelectorAll(".markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4").length,
                lists: document.querySelectorAll(".markdown-content ul, .markdown-content ol").length,
                codeBlocks: document.querySelectorAll(".markdown-content pre code").length,
                blockquotes: document.querySelectorAll(".markdown-content blockquote").length,
                tables: document.querySelectorAll(".markdown-content table").length
              },
              composer: composer
                ? {
                    className: String(composer.className || ""),
                    x: Math.round(composer.getBoundingClientRect().x),
                    y: Math.round(composer.getBoundingClientRect().y),
                    width: Math.round(composer.getBoundingClientRect().width),
                    height: Math.round(composer.getBoundingClientRect().height),
                    right: Math.round(composer.getBoundingClientRect().right),
                    bottom: Math.round(composer.getBoundingClientRect().bottom),
                    clientHeight: composer.clientHeight,
                    scrollHeight: composer.scrollHeight
                  }
                : null,
              rootOverlaps,
              textOverflows
            }
          };
        })()`,
        true
      )) as UiSmokeDumpPayload;
      const output = {
        ...payload,
        fixture: uiFixtureName(),
        initialView: uiInitialView(),
        runtime: {
          ready: runtimeStatus.ready,
          port: runtimeStatus.port,
          pid: runtimeStatus.pid,
          workspace: runtimeStatus.workspace,
          lastError: runtimeStatus.lastError
        },
        smokeClick: {
          requested: uiSmokeClickName(),
          performed: uiSmokeClickPerformed
        }
      };
      if (dumpPath) {
        fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
        fs.writeFileSync(dumpPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      }
      if (screenshotPath) {
        const image = await window.webContents.capturePage();
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, image.toPNG());
      }
    } catch (error) {
      if (!uiSmokeDumpFailureLogged) {
        uiSmokeDumpFailureLogged = true;
        log("warn", `ui smoke dump failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  window.webContents.once("did-finish-load", () => {
    void writeDump();
  });
  uiSmokeDumpInterval = setInterval(() => {
    void writeDump();
  }, 500);
  window.once("closed", stopUiSmokeDump);
}

async function runUiSmokeClick(window: BrowserWindow) {
  const click = uiSmokeClickName();
  if (!click || uiSmokeClickPerformed) {
    return;
  }
  if (Date.now() < uiSmokeClickReadyAt) {
    return;
  }
  const clicked = (await window.webContents.executeJavaScript(
    `(() => {
      const clickName = ${JSON.stringify(click)};
      const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const clickElement = (element) => {
        if (!element) {
          return false;
        }
        element.click();
        return true;
      };
      const buttonByText = (text) => Array.from(document.querySelectorAll("button")).find((button) => compact(button.textContent).includes(text));
      const buttonByLabel = (text) => Array.from(document.querySelectorAll("button")).find((button) => compact(button.getAttribute("aria-label")).includes(text));
      switch (clickName) {
        case "approval-allow":
          return clickElement(buttonByText("鍏佽涓€娆?));
        case "approval-deny":
          return clickElement(buttonByText("鎷掔粷"));
        case "task-cancel":
          return clickElement(buttonByText("鍙栨秷"));
        case "automation-pause":
          return clickElement(buttonByText("鏆傚仠"));
        case "automation-resume":
          return clickElement(buttonByText("鎭㈠"));
        case "rail-extensions":
          return clickElement(document.getElementById("rail-tab-extensions"));
        case "rail-logs":
          return clickElement(document.getElementById("rail-tab-logs"));
        case "settings-runtime":
          return clickElement(buttonByText("杩愯"));
        case "settings-extensions":
          return clickElement(buttonByText("鎵╁睍"));
        case "settings-logs":
          return clickElement(buttonByText("鏃ュ織"));
        case "settings-yolo":
          return clickElement(document.getElementById("settings-yolo"));
        case "right-collapse":
          return clickElement(buttonByText("鏀惰捣"));
        case "new-thread":
          return clickElement(buttonByText("鏂颁細璇?));
        case "conversation-menu":
          return clickElement(buttonByLabel("鏇村浼氳瘽鎿嶄綔"));
        case "workspace-open-menu":
          return clickElement(buttonByLabel("鎵撳紑宸ヤ綔鍖?));
        case "processed-history":
          return clickElement(document.querySelector("[data-processed-history] > summary"));
        default:
          return false;
      }
    })()`,
    true
  )) as boolean;
  if (clicked) {
    uiSmokeClickPerformed = true;
  }
}

async function createWindow() {
  if (!activeWorkspace && recentWorkspaces.length === 0) {
    initializeWorkspaceState();
  }
  const uiFixture = uiFixtureName();
  const initialView = uiInitialView();
  const rendererQuery: Record<string, string> = {};
  if (uiFixture) {
    rendererQuery.fixture = uiFixture;
  }
  if (initialView) {
    rendererQuery.view = initialView;
  }
  const workspaceAlias = uiWorkspaceAlias();
  if (workspaceAlias) {
    rendererQuery.workspace_alias = workspaceAlias;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: "DeepSeek App",
    backgroundColor: "#0b1118",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(1);
  });
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  startUiSmokeDump(mainWindow);
  const runtimeStartup = startRuntime();

  if (process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(rendererQuery)) {
      url.searchParams.set(key, value);
    }
    await mainWindow.loadURL(url.toString());
  } else {
    const rendererName = process.env.MAIN_WINDOW_VITE_NAME || "main_window";
    await mainWindow.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`), {
      query: Object.keys(rendererQuery).length > 0 ? rendererQuery : undefined
    });
  }

  void runtimeStartup;
}

function uiFixtureName() {
  const name = process.env.DEEPSEEK_DESKTOP_UI_FIXTURE?.trim().toLowerCase();
  return name === "approval" || name === "activity" || name === "conversation" ? name : null;
}

function uiInitialView() {
  const name = process.env.DEEPSEEK_DESKTOP_UI_VIEW?.trim().toLowerCase();
  return name === "threads" || name === "tasks" || name === "automations" || name === "settings" ? name : null;
}

function uiWorkspaceAlias() {
  const value = process.env.DEEPSEEK_DESKTOP_UI_WORKSPACE_ALIAS?.trim();
  return value || null;
}

function uiSmokeClickName() {
  const name = process.env.DEEPSEEK_DESKTOP_UI_CLICK?.trim().toLowerCase();
  return name === "approval-allow" ||
    name === "approval-deny" ||
    name === "task-cancel" ||
    name === "automation-pause" ||
    name === "automation-resume" ||
    name === "rail-extensions" ||
    name === "rail-logs" ||
    name === "settings-runtime" ||
    name === "settings-extensions" ||
    name === "settings-logs" ||
    name === "settings-yolo" ||
    name === "right-collapse" ||
    name === "new-thread" ||
    name === "conversation-menu" ||
    name === "workspace-open-menu" ||
    name === "processed-history"
    ? name
    : null;
}

ipcMain.handle("runtime:status", () => runtimeStatus);
ipcMain.handle("runtime:restart", async () => {
  stopRuntime();
  return startRuntime();
});
ipcMain.handle("workspace:current", () => workspaceState());
ipcMain.handle("workspace:chooseDirectory", () => chooseWorkspaceDirectory());
ipcMain.handle("workspace:switch", (_event, workspacePath: string) => switchWorkspace(workspacePath));
ipcMain.handle("workspace:forget", (_event, workspacePath: string) => forgetWorkspace(workspacePath));
ipcMain.handle("workspace:open", (_event, target: WorkspaceOpenTarget) => openWorkspace(target));
ipcMain.handle("workspace:openPath", (_event, workspacePath: string, target: WorkspacePathOpenTarget) =>
  openWorkspacePath(workspacePath, target)
);
ipcMain.handle("workspace:createWorktree", () => createPermanentWorktree());
ipcMain.handle("runtime:request", (_event, request: RuntimeRequest) => requestRuntime(request));
ipcMain.handle("runtime:subscribe", (_event, request: SubscribeRequest) => subscribeThreadEvents(request));
ipcMain.handle("runtime:unsubscribe", (_event, channelId: string) => {
  subscriptions.get(channelId)?.abort.abort();
  subscriptions.delete(channelId);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopRuntime();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", stopRuntime);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
