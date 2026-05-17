import { describe, expect, it } from "vitest";
import {
  approvalFromEvent,
  contextStatusLabel,
  eventLabel,
  fileChangeSummary,
  formatElapsed,
  shouldShowApprovalComposer,
  turnStatusLine
} from "./state";
import type { Approval, EffectiveConfig, ThreadDetail, TurnItemRecord, TurnRecord } from "./types";

describe("runtime event mapping", () => {
  it("extracts approval requests without leaking unrelated events", () => {
    expect(approvalFromEvent("item.delta", {})).toBeNull();
    expect(
      approvalFromEvent("approval.required", {
        payload: {
          approval_id: "approval_1",
          command: "cargo test",
          reason: "needs shell"
        }
      })
    ).toEqual({
      approvalId: "approval_1",
      callId: undefined,
      turnId: undefined,
      tool: undefined,
      command: "cargo test",
      cwd: undefined,
      reason: "needs shell",
      permissions: undefined,
      createdAt: undefined,
      status: "pending"
    });
  });

  it("renders compact labels for common event frames", () => {
    expect(eventLabel("turn.completed", {})).toBe("turn completed");
    expect(eventLabel("item.delta", { payload: { delta: "hello", kind: "agent_message" } })).toBe("回复流式更新");
  });

  it("accepts direct approval payloads from stream frames", () => {
    expect(
      approvalFromEvent("approval.required", {
        approvalId: "approval_direct",
        turn_id: "turn_1",
        command: "npm test"
      })
    ).toEqual({
      approvalId: "approval_direct",
      callId: undefined,
      turnId: "turn_1",
      tool: undefined,
      command: "npm test",
      reason: undefined,
      cwd: undefined,
      permissions: undefined,
      createdAt: undefined,
      status: "pending"
    });
  });

  it("normalizes runtime tool approval events", () => {
    expect(
      approvalFromEvent("approval.required", {
        timestamp: "2026-05-15T09:00:00Z",
        turn_id: "turn_runtime",
        payload: {
          id: "tool_1",
          approval_id: "tool_1",
          tool_name: "shell",
          description: "Approval requested by policy mode.",
          input: {
            command: "npm test",
            cwd: "E:\\repo"
          }
        }
      })
    ).toEqual({
      approvalId: "tool_1",
      callId: undefined,
      turnId: "turn_runtime",
      tool: "shell",
      command: "npm test",
      cwd: "E:\\repo",
      reason: "Approval requested by policy mode.",
      permissions: undefined,
      createdAt: "2026-05-15T09:00:00Z",
      status: "pending"
    });
  });

  it("normalizes nested exec approval request metadata", () => {
    expect(
      approvalFromEvent("approval.required", {
        payload: {
          request: {
            call_id: "call_1",
            approval_id: "approval_nested",
            turn_id: "turn_nested",
            command: "cargo test --workspace",
            cwd: "E:\\repo",
            reason: "Command needs elevated policy.",
            network_approval_context: { host: "api.example.test", protocol: "https" },
            proposed_execpolicy_amendment: ["cargo test"]
          }
        }
      })
    ).toEqual({
      approvalId: "approval_nested",
      callId: "call_1",
      turnId: "turn_nested",
      tool: undefined,
      command: "cargo test --workspace",
      cwd: "E:\\repo",
      reason: "Command needs elevated policy.",
      permissions: ["cargo test", "network:api.example.test"],
      createdAt: undefined,
      status: "pending"
    });
  });
});

describe("turn progress helpers", () => {
  it("keeps running elapsed time live even when duration is zero", () => {
    const runningTurn: TurnRecord = {
      id: "turn_live",
      thread_id: "thread_1",
      status: "running",
      input_summary: "run",
      created_at: "2026-05-17T00:00:00Z",
      started_at: "2026-05-17T00:00:10Z",
      duration_ms: 0
    };
    expect(turnStatusLine(runningTurn, Date.parse("2026-05-17T00:01:15Z"))).toContain("1m 5s");
  });

  it("formats elapsed time while a turn is running and after it ends", () => {
    expect(formatElapsed(65_000)).toBe("1m 5s");
    const runningTurn: TurnRecord = {
      id: "turn_1",
      thread_id: "thread_1",
      status: "running",
      input_summary: "run",
      created_at: "2026-05-17T00:00:00Z",
      started_at: "2026-05-17T00:00:10Z"
    };
    expect(turnStatusLine(runningTurn, Date.parse("2026-05-17T00:01:15Z"))).toBe("处理中 1m 5s · 持续接收进度");
    expect(turnStatusLine({ ...runningTurn, status: "completed", duration_ms: 42_000 })).toBe("耗时 42s");
  });

  it("summarizes file changes with file name and line counts", () => {
    const item: TurnItemRecord = {
      id: "item_1",
      turn_id: "turn_1",
      kind: "file_change",
      status: "completed",
      summary: "updated file",
      metadata: {
        path: "desktop/src/renderer/App.tsx",
        additions: 12,
        deletions: 3
      }
    };
    expect(fileChangeSummary(item)).toBe("desktop/src/renderer/App.tsx +12 -3");
  });

  it("uses precise context status when present and estimates otherwise", () => {
    expect(
      contextStatusLabel(null, {
        context: {
          used_tokens: 25000,
          window_tokens: 100000,
          compression_status: "active"
        }
      })
    ).toBe("上下文 · 25k tok · 25%");

    const detail = {
      thread: {
        id: "thread_1",
        model: "model",
        workspace: "E:\\repo",
        mode: "agent",
        allow_shell: false,
        trust_mode: false,
        auto_approve: false,
        archived: false,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z"
      },
      turns: [],
      events: [],
      items: [
        {
          id: "item_1",
          turn_id: "turn_1",
          kind: "agent_message",
          status: "completed",
          summary: "abcd",
          detail: "abcd"
        }
      ]
    } satisfies ThreadDetail;
    expect(contextStatusLabel(detail, null)).toBe("上下文 · 约 2 tok");
  });

  it("does not show approval composer when frontend is already in auto mode", () => {
    const approval: Approval = { approvalId: "approval_1", status: "pending" };
    const config = {
      config_present: true,
      workspace: "E:\\repo",
      provider: "local",
      default_model: "model",
      base_url: "http://127.0.0.1",
      api_key_source: "env",
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
      allow_shell: true,
      yolo: true,
      reasoning_effort: "medium",
      mcp_config_path: "",
      skills_dir: ""
    } satisfies EffectiveConfig;
    expect(shouldShowApprovalComposer({ approval, config, mode: "yolo" })).toBe(false);
    expect(shouldShowApprovalComposer({ approval, config, mode: "agent" })).toBe(true);
    expect(shouldShowApprovalComposer({ approval, config: { ...config, yolo: false }, mode: "agent" })).toBe(true);
    expect(shouldShowApprovalComposer({ approval, config: { ...config, yolo: false, approval_policy: "suggest" }, mode: "agent" })).toBe(true);
  });
});
