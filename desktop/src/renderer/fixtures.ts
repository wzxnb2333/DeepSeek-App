import type { Approval, AutomationRecord, TasksResponse, ThreadDetail, ThreadSummary } from "./types";

export function fixtureApprovals(name: string | null): Approval[] {
  if (name !== "approval" && name !== "activity") {
    return [];
  }
  return [
    {
      approvalId: "approval-preview-1",
      callId: "call-preview-1",
      turnId: "turn-preview",
      tool: "shell",
      command: "npm --prefix desktop run make:win",
      cwd: "E:\\AI_collection\\deepseek-tui",
      reason: "Command needs approval before running a packaging task.",
      permissions: ["package:win32-x64", "filesystem:workspace"],
      createdAt: "2026-05-15T01:20:00Z",
      status: "pending"
    }
  ];
}

export function fixtureThreads(name: string | null): ThreadSummary[] {
  if (name !== "conversation") {
    return [];
  }
  return [
    {
      id: "thr-visual",
      title: "界面修缮测试",
      preview: "现在会话正文会直接显示在中间区域。",
      model: "deepseek-v4-pro",
      workspace: "E:\\AI_collection\\deepseek-tui",
      mode: "agent",
      archived: false,
      updated_at: "2026-05-15T12:01:00Z",
      latest_turn_id: "turn-visual",
      latest_turn_status: "completed"
    }
  ];
}

export function fixtureThreadDetail(name: string | null): ThreadDetail | null {
  if (name !== "conversation") {
    return null;
  }
  return {
    thread: {
      id: "thr-visual",
      title: "界面修缮测试",
      model: "deepseek-v4-pro",
      workspace: "E:\\AI_collection\\deepseek-tui",
      mode: "agent",
      allow_shell: false,
      trust_mode: false,
      auto_approve: false,
      latest_turn_id: "turn-visual",
      archived: false,
      created_at: "2026-05-15T12:00:00Z",
      updated_at: "2026-05-15T12:01:00Z"
    },
    turns: [
      {
        id: "turn-visual",
        thread_id: "thr-visual",
        status: "completed",
        input_summary: "为什么之前看不到对话？",
        created_at: "2026-05-15T12:00:00Z",
        started_at: "2026-05-15T12:00:00Z",
        ended_at: "2026-05-15T12:01:00Z",
        duration_ms: 60000
      }
    ],
    items: [
      {
        id: "item-visual-user",
        turn_id: "turn-visual",
        kind: "user_message",
        status: "completed",
        summary: "为什么之前看不到对话？",
        detail: "为什么之前看不到对话？",
        started_at: "2026-05-15T12:00:00Z",
        ended_at: "2026-05-15T12:00:00Z"
      },
      {
        id: "item-visual-reasoning",
        turn_id: "turn-visual",
        kind: "agent_reasoning",
        status: "completed",
        summary: "检查前端刷新路径。",
        detail: "发送 turn 后只刷新了摘要，详情没有重新拉取；流式事件也没有合并到消息区。",
        started_at: "2026-05-15T12:00:05Z",
        ended_at: "2026-05-15T12:00:10Z"
      },
      {
        id: "item-visual-assistant",
        turn_id: "turn-visual",
        kind: "agent_message",
        status: "completed",
        summary: "现在会话正文会直接显示在中间区域，事件流不会逐字铺满侧栏。",
        detail: "现在会话正文会直接显示在中间区域，事件流不会逐字铺满侧栏。新会话入口也固定在左侧首屏。",
        started_at: "2026-05-15T12:00:10Z",
        ended_at: "2026-05-15T12:01:00Z"
      },
      {
        id: "item-visual-markdown",
        turn_id: "turn-visual",
        kind: "agent_message",
        status: "completed",
        summary: "Markdown rendering smoke",
        detail: [
          "现在会话正文支持 Markdown。",
          "",
          "## 文件与代码",
          "- **读取/搜索文件**：结果会收进正文，不再铺满事件流。",
          "- `Enter` 发送消息，`Ctrl+Enter` 插入换行。",
          "",
          "| 区域 | 状态 | 结果 |",
          "| --- | --- | --- |",
          "| 会话正文 | 已修复 | 中间区域直接显示 |",
          "| 审批 | 已收敛 | 输入栏位置接管确认 |",
          "",
          "```ts",
          "const sendable = prompt.trim().length > 0;",
          "```",
          "",
          "> 工具、审批和运行日志保留在侧栏。"
        ].join("\n"),
        started_at: "2026-05-15T12:01:00Z",
        ended_at: "2026-05-15T12:01:05Z"
      }
    ],
    events: []
  };
}

const activityTasks: TasksResponse = {
  counts: {
    queued: 1,
    running: 1,
    completed: 2,
    failed: 1,
    canceled: 0
  },
  tasks: [
    {
      id: "task-fixture-running",
      status: "running",
      prompt_summary: "整理工作区变更并生成发布前检查清单",
      model: "deepseek-v4-pro",
      mode: "agent",
      created_at: "2026-05-15T01:34:00Z",
      started_at: "2026-05-15T01:35:00Z"
    },
    {
      id: "task-fixture-queued",
      status: "queued",
      prompt_summary: "扫描最近日志并汇总 runtime 异常",
      model: "deepseek-v4-flash",
      mode: "agent",
      created_at: "2026-05-15T01:38:00Z"
    },
    {
      id: "task-fixture-failed",
      status: "failed",
      prompt_summary: "运行 Windows installer smoke",
      model: "deepseek-v4-pro",
      mode: "agent",
      created_at: "2026-05-15T01:20:00Z",
      ended_at: "2026-05-15T01:27:00Z",
      error: "Missing Windows SDK headers"
    }
  ]
};

const activityAutomations: AutomationRecord[] = [
  {
    id: "automation-fixture-daily",
    name: "每日工作区健康检查",
    prompt: "检查运行日志、任务队列和最近失败项。",
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=30",
    cwds: ["E:\\AI_collection\\deepseek-tui"],
    status: "active",
    created_at: "2026-05-14T10:00:00Z",
    updated_at: "2026-05-15T01:00:00Z",
    next_run_at: "2026-05-15T09:30:00Z",
    last_run_at: "2026-05-14T09:30:00Z"
  },
  {
    id: "automation-fixture-paused",
    name: "打包产物巡检",
    prompt: "确认 installer、zip 和截图产物都存在。",
    rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=18",
    cwds: ["E:\\AI_collection\\deepseek-tui"],
    status: "paused",
    created_at: "2026-05-14T12:00:00Z",
    updated_at: "2026-05-15T01:10:00Z",
    next_run_at: null,
    last_run_at: "2026-05-14T18:00:00Z"
  }
];

export function fixtureTasks(name: string | null): TasksResponse | null {
  return name === "activity" ? activityTasks : null;
}

export function fixtureAutomations(name: string | null): AutomationRecord[] {
  return name === "activity" ? activityAutomations : [];
}

export function mergeFixtureTasks(name: string | null, actual: TasksResponse): TasksResponse {
  return name === "activity" && actual.tasks.length === 0 ? activityTasks : actual;
}

export function mergeFixtureAutomations(name: string | null, actual: AutomationRecord[]): AutomationRecord[] {
  return name === "activity" && actual.length === 0 ? activityAutomations : actual;
}

export function cancelFixtureTask(actual: TasksResponse | null, id: string): TasksResponse | null {
  if (!actual) {
    return actual;
  }
  const tasks = actual.tasks.map((task) =>
    task.id === id && (task.status === "queued" || task.status === "running")
      ? { ...task, status: "canceled", ended_at: new Date().toISOString() }
      : task
  );
  return {
    tasks,
    counts: countTasks(tasks)
  };
}

export function applyFixtureAutomationAction(
  actual: AutomationRecord[],
  id: string,
  action: "pause" | "resume" | "run"
): AutomationRecord[] {
  const now = new Date().toISOString();
  return actual.map((automation) => {
    if (automation.id !== id) {
      return automation;
    }
    if (action === "pause") {
      return { ...automation, status: "paused", updated_at: now, next_run_at: null };
    }
    if (action === "resume") {
      return { ...automation, status: "active", updated_at: now, next_run_at: now };
    }
    return { ...automation, updated_at: now, last_run_at: now };
  });
}

function countTasks(tasks: TasksResponse["tasks"]): TasksResponse["counts"] {
  return tasks.reduce(
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
