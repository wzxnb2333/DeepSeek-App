import { describe, expect, it } from "vitest";
import {
  applyFixtureAutomationAction,
  cancelFixtureTask,
  fixtureAutomations,
  fixtureThreadDetail,
  fixtureThreads,
  fixtureTasks,
  mergeFixtureAutomations,
  mergeFixtureTasks
} from "./fixtures";
import type { AutomationRecord, TasksResponse } from "./types";

describe("ui fixtures", () => {
  it("provides populated task and automation states for activity screenshots", () => {
    expect(fixtureTasks("activity")?.tasks.length).toBeGreaterThan(0);
    expect(fixtureAutomations("activity").length).toBeGreaterThan(0);
  });

  it("provides conversation state for message rendering screenshots", () => {
    expect(fixtureThreads("conversation")).toHaveLength(1);
    const detail = fixtureThreadDetail("conversation");
    expect(detail?.items.some((item) => item.kind === "user_message")).toBe(true);
    expect(detail?.items.some((item) => item.kind === "agent_message")).toBe(true);
    expect(detail?.items.some((item) => item.detail?.includes("## 文件与代码"))).toBe(true);
  });

  it("does not replace real task or automation records", () => {
    const tasks: TasksResponse = {
      counts: {
        queued: 0,
        running: 1,
        completed: 0,
        failed: 0,
        canceled: 0
      },
      tasks: [
        {
          id: "real-task",
          status: "running",
          prompt_summary: "real task",
          model: "deepseek-v4-pro",
          mode: "agent",
          created_at: "2026-05-15T02:00:00Z"
        }
      ]
    };
    const automations: AutomationRecord[] = [
      {
        id: "real-automation",
        name: "real automation",
        prompt: "run real work",
        rrule: "FREQ=DAILY",
        cwds: ["E:\\repo"],
        status: "active",
        created_at: "2026-05-15T02:00:00Z",
        updated_at: "2026-05-15T02:00:00Z"
      }
    ];

    expect(mergeFixtureTasks("activity", tasks).tasks[0]?.id).toBe("real-task");
    expect(mergeFixtureAutomations("activity", automations)[0]?.id).toBe("real-automation");
  });

  it("updates fixture task and automation interactions locally", () => {
    const tasks = fixtureTasks("activity");
    const canceled = cancelFixtureTask(tasks, "task-fixture-running");
    expect(canceled?.tasks.find((task) => task.id === "task-fixture-running")?.status).toBe("canceled");
    expect(canceled?.counts.running).toBe(0);
    expect(canceled?.counts.canceled).toBe(1);

    const paused = applyFixtureAutomationAction(fixtureAutomations("activity"), "automation-fixture-daily", "pause");
    expect(paused.find((automation) => automation.id === "automation-fixture-daily")?.status).toBe("paused");

    const resumed = applyFixtureAutomationAction(paused, "automation-fixture-daily", "resume");
    expect(resumed.find((automation) => automation.id === "automation-fixture-daily")?.status).toBe("active");
  });
});
