import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(repoRoot, "desktop");
const timeoutMs = 30000;
const sourceWorkspace = path.join(repoRoot, "outputs", "desktop-ui", "sample-workspace");
const workspace = mkdtempSync(path.join(os.tmpdir(), "deepseek-runtime-smoke-"));
const smokeHome = mkdtempSync(path.join(os.tmpdir(), "deepseek-runtime-smoke-home-"));
cpSync(sourceWorkspace, workspace, { recursive: true });
const fakeProvider = await startFakeProvider();
writeSmokeConfig(fakeProvider.baseUrl);

const cliArg = process.argv.slice(2);
const explicitBinary = getArgValue(cliArg, "--binary") || process.env.DEEPSEEK_RUNTIME_SMOKE_BINARY || "";
const reportPath =
  getArgValue(cliArg, "--report") ||
  process.env.DEEPSEEK_RUNTIME_SMOKE_REPORT ||
  path.join(repoRoot, "outputs", "desktop-ui", "runtime-smoke.json");
const binary = resolveBinary(explicitBinary);

if (!binary) {
  throw new Error("Runtime binary not found. Run package:win or pass --binary <path>.");
}

const child = spawn(
  binary,
  ["--workspace", workspace, "serve", "--http", "--host", "127.0.0.1", "--port", "0", "--startup-json"],
  {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: smokeHome,
      USERPROFILE: smokeHome,
      DEEPSEEK_CONFIG_PATH: path.join(smokeHome, ".deepseek", "config.toml"),
      DEEPSEEK_TASKS_DIR: path.join(smokeHome, ".deepseek", "tasks"),
      DEEPSEEK_RUNTIME_DIR: path.join(smokeHome, ".deepseek", "runtime")
    },
    windowsHide: true
  }
);
const childPid = child.pid;

let stdout = "";
let stderr = "";
let resolved = false;
let readyPayload = null;

const startup = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error(`Timed out waiting for runtime startup after ${timeoutMs}ms`));
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);
    child.stdout.off("data", onStdout);
    child.stderr.off("data", onStderr);
    child.off("error", onError);
    child.off("exit", onExit);
  };

  const settle = (value, error) => {
    if (resolved) {
      return;
    }
    resolved = true;
    cleanup();
    if (error) {
      reject(error);
      return;
    }
    resolve(value);
  };

  const onStdout = (chunk) => {
    stdout += chunk.toString("utf8");
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || "";
    for (const line of lines) {
      const payload = parseStartupLine(line);
      if (payload) {
        readyPayload = payload;
        settle(payload, null);
        return;
      }
    }
  };

  const onStderr = (chunk) => {
    stderr += chunk.toString("utf8");
  };

  const onError = (error) => {
    settle(null, error);
  };

  const onExit = (code, signal) => {
    settle(
      null,
      new Error(`Runtime exited before ready: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderr.trim()}`)
    );
  };

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.on("error", onError);
  child.on("exit", onExit);
});

const authHeader = readyPayload?.auth_token ? { authorization: `Bearer ${readyPayload.auth_token}` } : {};
const baseUrl = readyPayload.base_url;
const health = await requestJson(new URL("/health", baseUrl));
const runtimeInfo = await requestJson(new URL("/v1/runtime/info", baseUrl));
if (readyPayload.auth_required) {
  const unauthenticated = await requestRaw(new URL("/v1/models", baseUrl));
  assert(unauthenticated.status === 401, "token guard rejects unauthenticated v1 requests");
}

const [config, models, tree, readme, search, tasks, automations, skills, mcpServers, mcpTools, usage] = await Promise.all([
  requestJson(new URL("/v1/config/effective", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/models", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/workspace/tree", baseUrl), { headers: authHeader }),
  requestJson(new URL(`/v1/workspace/file?path=${encodeURIComponent("README.md")}&max_bytes=1024`, baseUrl), {
    headers: authHeader
  }),
  requestJson(new URL(`/v1/workspace/search?q=${encodeURIComponent("workspace")}&limit=10`, baseUrl), {
    headers: authHeader
  }),
  requestJson(new URL("/v1/tasks", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/automations", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/skills", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/apps/mcp/servers", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/apps/mcp/tools", baseUrl), { headers: authHeader }),
  requestJson(new URL("/v1/usage", baseUrl), { headers: authHeader })
]);

assert(health && typeof health === "object", "health endpoint returns an object");
assert(runtimeInfo.port === readyPayload.port, "runtime info port matches startup payload");
assert(runtimeInfo.bind_host === readyPayload.bind_host, "runtime info bind host matches startup payload");
assert(runtimeInfo.auth_required === readyPayload.auth_required, "runtime info auth flag matches startup payload");
assert(config.workspace, "config.effective.workspace");
assert(path.normalize(config.workspace) === path.normalize(workspace), "workspace path matches smoke workspace");
const patchedConfig = await requestJson(new URL("/v1/config", baseUrl), {
  method: "PATCH",
  headers: authHeader,
  body: {
    provider: config.provider,
    default_text_model: config.default_model,
    reasoning_effort: config.reasoning_effort,
    approval_policy: config.approval_policy,
    sandbox_mode: config.sandbox_mode,
    allow_shell: config.allow_shell,
    yolo: config.yolo
  }
});
assert(patchedConfig.config_present, "config patch creates a smoke config file");
assert(patchedConfig.provider === config.provider, "config patch preserves provider");
assert(patchedConfig.default_model === config.default_model, "config patch round-trips default model");
const permissiveConfig = await requestJson(new URL("/v1/config", baseUrl), {
  method: "PATCH",
  headers: authHeader,
  body: {
    allow_shell: true,
    yolo: true
  }
});
assert(permissiveConfig.allow_shell === true, "config patch enables allow_shell");
assert(permissiveConfig.yolo === true, "config patch enables yolo");
assert(Array.isArray(models.models) && models.models.length > 0, "models list is populated");
assert(Array.isArray(tree.entries) && tree.entries.length > 0, "workspace tree has entries");
assert(
  typeof readme.content === "string" && readme.content.includes("Local UI smoke workspace."),
  "workspace file can be read"
);
assert(Array.isArray(search.matches) && search.matches.length > 0, "workspace search returns matches");
assert(Array.isArray(tasks.tasks) && tasks.counts && typeof tasks.counts.running === "number", "tasks list shape");
assert(Array.isArray(automations), "automations list shape");
assert(Array.isArray(skills.skills), "skills list shape");
assert(Array.isArray(mcpServers.servers), "mcp servers list shape");
assert(Array.isArray(mcpTools.tools), "mcp tools list shape");
assert(usage.totals && typeof usage.totals.turns === "number", "usage totals shape");

try {
  const createdTask = await requestJson(new URL("/v1/tasks", baseUrl), {
    method: "POST",
    headers: authHeader,
    body: {
      prompt: "Runtime smoke task to cancel",
      model: config.default_model,
      workspace,
      mode: "agent",
      allow_shell: false,
      trust_mode: false,
      auto_approve: false
    }
  });
  assert(typeof createdTask.id === "string" && createdTask.id.length > 0, "task create returns id");

  const fetchedTask = await requestJson(new URL(`/v1/tasks/${encodeURIComponent(createdTask.id)}`, baseUrl), {
    headers: authHeader
  });
  assert(fetchedTask.id === createdTask.id, "task detail returns the created task");

  const canceledTask = await requestJson(new URL(`/v1/tasks/${encodeURIComponent(createdTask.id)}/cancel`, baseUrl), {
    method: "POST",
    headers: authHeader
  });
  assert(
    canceledTask.id === createdTask.id && ["canceled", "running", "failed"].includes(canceledTask.status),
    "task cancel accepts the created task"
  );

  const createdAutomation = await requestJson(new URL("/v1/automations", baseUrl), {
    method: "POST",
    headers: authHeader,
    body: {
      name: "Runtime smoke automation",
      prompt: "Check runtime smoke state.",
      rrule: "FREQ=HOURLY;INTERVAL=24",
      cwds: [workspace],
      status: "paused"
    }
  });
  assert(
    typeof createdAutomation.id === "string" && createdAutomation.status === "paused",
    "automation create returns paused record"
  );

  const automationRuns = await requestJson(
    new URL(`/v1/automations/${encodeURIComponent(createdAutomation.id)}/runs?limit=5`, baseUrl),
    {
      headers: authHeader
    }
  );
  assert(Array.isArray(automationRuns), "automation runs endpoint returns an array");

  const resumedAutomation = await requestJson(
    new URL(`/v1/automations/${encodeURIComponent(createdAutomation.id)}/resume`, baseUrl),
    {
      method: "POST",
      headers: authHeader
    }
  );
  assert(resumedAutomation.id === createdAutomation.id && resumedAutomation.status === "active", "automation resume");

  const pausedAutomation = await requestJson(
    new URL(`/v1/automations/${encodeURIComponent(createdAutomation.id)}/pause`, baseUrl),
    {
      method: "POST",
      headers: authHeader
    }
  );
  assert(pausedAutomation.id === createdAutomation.id && pausedAutomation.status === "paused", "automation pause");

  const deletedAutomation = await requestJson(new URL(`/v1/automations/${encodeURIComponent(createdAutomation.id)}`, baseUrl), {
    method: "DELETE",
    headers: authHeader
  });
  assert(deletedAutomation.id === createdAutomation.id, "automation delete returns deleted record");

  const badApproval = await requestRaw(new URL("/v1/approvals/smoke_missing_approval", baseUrl), {
    method: "POST",
    headers: authHeader,
    body: { decision: "maybe" }
  });
  assert(badApproval.status === 400, "approval endpoint rejects unknown decisions");

  const missingApproval = await requestRaw(new URL("/v1/approvals/smoke_missing_approval", baseUrl), {
    method: "POST",
    headers: authHeader,
    body: { decision: "allow" }
  });
  assert(missingApproval.status === 404, "approval endpoint reports missing pending approval");

  const thread = await requestJson(new URL("/v1/threads", baseUrl), {
    method: "POST",
    headers: authHeader,
    body: {
      model: config.default_model,
      mode: "agent",
      allow_shell: config.allow_shell
    }
  });

  assert(typeof thread.id === "string" && thread.id.length > 0, "thread id is returned");

  const threadDetail = await requestJson(new URL(`/v1/threads/${encodeURIComponent(thread.id)}`, baseUrl), {
    headers: authHeader
  });

  assert(threadDetail.thread?.id === thread.id, "thread detail round-trips the thread id");

  const patchedThread = await requestJson(new URL(`/v1/threads/${encodeURIComponent(thread.id)}`, baseUrl), {
    method: "PATCH",
    headers: authHeader,
    body: { title: "Runtime smoke thread" }
  });
  assert(patchedThread.id === thread.id && patchedThread.title === "Runtime smoke thread", "thread patch round-trips");

  const threadList = await requestJson(new URL("/v1/threads?include_archived=true&limit=10", baseUrl), {
    headers: authHeader
  });
  assert(Array.isArray(threadList) && threadList.some((item) => item.id === thread.id), "thread list includes created thread");

  const threadSummary = await requestJson(new URL("/v1/threads/summary?include_archived=true&limit=10", baseUrl), {
    headers: authHeader
  });
  assert(
    Array.isArray(threadSummary) && threadSummary.some((item) => item.id === thread.id),
    "thread summary includes created thread"
  );

  const firstEvent = await readFirstSseFrame(
    new URL(`/v1/threads/${encodeURIComponent(thread.id)}/events?since_seq=0`, baseUrl),
    authHeader
  );
  assert(firstEvent.includes("thread.started"), "thread events stream includes thread.started");

  const streamFrames = await postSseFrames(new URL("/v1/stream", baseUrl), {
    headers: authHeader,
    body: {
      prompt: "Runtime smoke streamed prompt",
      model: "smoke-model",
      workspace,
      mode: "agent",
      allow_shell: false,
      trust_mode: false,
      auto_approve: false
    }
  });
  assert(
    streamFrames.some((frame) => frame.event === "message.delta" && frame.data?.content?.includes("Mock provider reply")),
    "stream endpoint emits mock provider message delta"
  );
  assert(streamFrames.some((frame) => frame.event === "turn.completed"), "stream endpoint emits turn.completed");
  assert(streamFrames.some((frame) => frame.event === "done"), "stream endpoint emits done");
  assert(
    fakeProvider.requests.some(
      (request) =>
        request.method === "POST" &&
        request.path === "/v1/chat/completions" &&
        request.body?.stream === true &&
        request.body?.model === "smoke-model" &&
        JSON.stringify(request.body).includes("Runtime smoke streamed prompt")
    ),
    "fake provider received streamed chat completion request"
  );

  const approvalDenyFlow = await runApprovalFlow({
    prompt: "Runtime smoke approval prompt deny path",
    decision: "deny"
  });
  assert(approvalDenyFlow.required, "stream endpoint emits approval.required for denied shell tool call");
  assert(approvalDenyFlow.decisionDelivered, "deny approval decision is delivered to runtime turn");
  assert(approvalDenyFlow.turnCompleted, "deny approval stream emits turn.completed");
  assert(approvalDenyFlow.done, "deny approval stream emits done");

  const approvalAllowFlow = await runApprovalFlow({
    prompt: "Runtime smoke approval prompt allow path",
    decision: "allow"
  });
  assert(approvalAllowFlow.required, "stream endpoint emits approval.required for allowed shell tool call");
  assert(approvalAllowFlow.decisionDelivered, "allow approval decision is delivered to runtime turn");
  assert(approvalAllowFlow.messageDelta, "allow approval stream resumes after approved shell tool");
  assert(approvalAllowFlow.turnCompleted, "allow approval stream emits turn.completed");
  assert(approvalAllowFlow.done, "allow approval stream emits done");

  emitReport({
    ok: true,
    binary,
    baseUrl,
    workspace,
    smokeHome,
    reportPath,
    fakeProvider: {
      baseUrl: fakeProvider.baseUrl,
      requests: fakeProvider.requests.length
    },
    streamFlow: {
      messageDelta: streamFrames.some((frame) => frame.event === "message.delta"),
      turnCompleted: streamFrames.some((frame) => frame.event === "turn.completed"),
      done: streamFrames.some((frame) => frame.event === "done")
    },
    approvalFlow: {
      required: approvalDenyFlow.required,
      toolName: "exec_shell",
      decision: "deny",
      decisionDelivered: approvalDenyFlow.decisionDelivered,
      turnCompleted: approvalDenyFlow.turnCompleted,
      done: approvalDenyFlow.done
    },
    approvalAllowFlow: {
      required: approvalAllowFlow.required,
      toolName: "exec_shell",
      decision: "allow",
      decisionDelivered: approvalAllowFlow.decisionDelivered,
      messageDelta: approvalAllowFlow.messageDelta,
      turnCompleted: approvalAllowFlow.turnCompleted,
      done: approvalAllowFlow.done
    },
    readyPayload: redactStartupPayload(readyPayload),
    checkedEndpoints: [
      "/health",
      "/v1/runtime/info",
      "/v1/config/effective",
      "/v1/config",
      "/v1/models",
      "/v1/workspace/tree",
      "/v1/workspace/file",
      "/v1/workspace/search",
      "/v1/tasks",
      "/v1/tasks/{id}",
      "/v1/tasks/{id}/cancel",
      "/v1/automations",
      "/v1/automations/{id}/pause",
      "/v1/automations/{id}/resume",
      "/v1/automations/{id}/runs",
      "/v1/automations/{id}",
      "/v1/approvals/{approval_id}",
      "/v1/skills",
      "/v1/apps/mcp/servers",
      "/v1/apps/mcp/tools",
      "/v1/usage",
      "/v1/stream",
      "/v1/threads",
      "/v1/threads/summary",
      "/v1/threads/{id}",
      "/v1/threads/{id}/events"
    ]
  });
} finally {
  await shutdown();
  await closeServer(fakeProvider.server);
  await removeWorkspaceWithRetry(workspace);
  await removeWorkspaceWithRetry(smokeHome);
}

if (childPid) {
  assert(child.exitCode !== null || child.signalCode !== null, "runtime child exits during shutdown");
  assert(!isProcessRunning(childPid), "runtime child process is gone after shutdown");
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return "";
  }
  return args[index + 1] || "";
}

function emitReport(report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, text, "utf8");
  }
  console.log(text.trimEnd());
}

function resolveBinary(explicit) {
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const candidates = [
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "resources", "bin", "deepseek-tui.exe"),
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "resources", "bin", "deepseek.exe"),
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "bin", "deepseek-tui.exe"),
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "bin", "deepseek.exe"),
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "deepseek-tui.exe"),
    path.join(desktopRoot, "out", "DeepSeek App-win32-x64", "deepseek.exe"),
    path.join(repoRoot, "target", "release", "deepseek.exe"),
    path.join(repoRoot, "target", "release", "deepseek-tui.exe")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function parseStartupLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.status === "ready" &&
      typeof parsed.base_url === "string" &&
      typeof parsed.port === "number"
    ) {
      return parsed;
    }
  } catch {
    // Ignore human-readable runtime output.
  }
  return null;
}

function redactStartupPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  return {
    ...payload,
    auth_token: payload.auth_token ? "<redacted>" : null
  };
}

async function requestJson(url, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    body: hasBody ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url.pathname} failed: ${response.status} ${text}`);
  }
  return text.trim() ? JSON.parse(text) : {};
}

async function requestRaw(url, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    body: hasBody ? JSON.stringify(options.body) : undefined
  });
  return {
    status: response.status,
    text: await response.text()
  };
}

async function readFirstSseFrame(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`${url.pathname} SSE failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        return buffer.slice(0, boundary);
      }
    }
    throw new Error(`${url.pathname} SSE ended before first frame`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function postSseFrames(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const frames = [];
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      },
      body: JSON.stringify(options.body || {}),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`${url.pathname} SSE failed: ${response.status} ${await response.text()}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!raw.trim()) {
          continue;
        }
        const frame = parseSseFrame(raw);
        frames.push(frame);
        if (typeof options.onFrame === "function") {
          await options.onFrame(frame, frames);
        }
        if (frame.event === "done") {
          controller.abort();
          return frames;
        }
      }
    }
    return frames;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function runApprovalFlow({ prompt, decision }) {
  let approvalId = "";
  let decisionDelivered = false;
  const frames = await postSseFrames(new URL("/v1/stream", baseUrl), {
    headers: authHeader,
    body: {
      prompt,
      model: "smoke-model",
      workspace,
      mode: "agent",
      allow_shell: true,
      trust_mode: false,
      auto_approve: false
    },
    onFrame: async (frame) => {
      if (frame.event !== "approval.required" || approvalId) {
        return;
      }
      approvalId = frame.data?.approval_id || frame.data?.approvalId || frame.data?.id || "";
      assert(approvalId, "approval.required includes an approval id");
      assert(frame.data?.tool_name === "exec_shell", "approval.required identifies exec_shell");
      const result = await requestJson(new URL(`/v1/approvals/${encodeURIComponent(approvalId)}`, baseUrl), {
        method: "POST",
        headers: authHeader,
        body: { decision }
      });
      decisionDelivered = result.delivered === true;
    }
  });

  return {
    approvalId,
    required: Boolean(approvalId),
    decision,
    decisionDelivered,
    messageDelta: frames.some((frame) => frame.event === "message.delta"),
    turnCompleted: frames.some((frame) => frame.event === "turn.completed"),
    done: frames.some((frame) => frame.event === "done")
  };
}

function parseSseFrame(raw) {
  let event = "message";
  let dataText = "";
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataText += line.slice("data:".length).trimStart();
    }
  }
  let data = null;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }
  return { event, data, raw };
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Runtime smoke assertion failed: ${label}`);
  }
}

function writeSmokeConfig(providerBaseUrl) {
  const configPath = path.join(smokeHome, ".deepseek", "config.toml");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `provider = "openai"
default_text_model = "smoke-model"
reasoning_effort = "off"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
allow_shell = false
yolo = false

[providers.openai]
api_key = "smoke-provider-key"
base_url = "${providerBaseUrl}/v1"
model = "smoke-model"
`,
    "utf8"
  );
}

async function startFakeProvider() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, {
        object: "list",
        data: [{ id: "smoke-model", object: "model", created: 0, owned_by: "smoke" }]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readRequestJson(request);
      requests.push({
        method: request.method,
        path: url.pathname,
        body
      });

      if (body?.stream) {
        const serializedBody = JSON.stringify(body);
        const hasToolResult = Array.isArray(body.messages) && body.messages.some((message) => message?.role === "tool");
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        if (serializedBody.includes("Runtime smoke approval prompt") && !hasToolResult) {
          writeProviderSse(response, {
            id: "chatcmpl-smoke-tool",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model || "smoke-model",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_smoke_approval",
                      type: "function",
                      function: {
                        name: "exec_shell",
                        arguments: JSON.stringify({ command: "echo smoke approval" })
                      }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          });
          writeProviderSse(response, {
            id: "chatcmpl-smoke-tool",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model || "smoke-model",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
          });
          response.write("data: [DONE]\n\n");
          response.end();
          return;
        }

        writeProviderSse(response, {
          id: "chatcmpl-smoke",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model || "smoke-model",
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        });
        writeProviderSse(response, {
          id: "chatcmpl-smoke",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model || "smoke-model",
          choices: [{ index: 0, delta: { content: "Mock provider reply." }, finish_reason: null }]
        });
        writeProviderSse(response, {
          id: "chatcmpl-smoke",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model || "smoke-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
        });
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      sendJson(response, {
        id: "chatcmpl-smoke",
        object: "chat.completion",
        created: 0,
        model: body?.model || "smoke-model",
        choices: [{ index: 0, message: { role: "assistant", content: "Mock provider reply." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object", "fake provider listens on a TCP port");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests
  };
}

function writeProviderSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(response, payload) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function shutdown() {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function removeWorkspaceWithRetry(target) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 12) {
        throw error;
      }
      await delay(500);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
