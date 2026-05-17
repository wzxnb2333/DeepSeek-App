import { describe, expect, it } from "vitest";
import { buildTurnTimeline } from "./turnTimeline";
import type { TurnItemRecord, TurnRecord } from "./types";

function turn(id: string, status = "completed"): TurnRecord {
  return {
    id,
    thread_id: "thread_1",
    status,
    input_summary: id,
    created_at: "2026-05-16T10:00:00Z",
    started_at: "2026-05-16T10:00:01Z",
    ended_at: status === "completed" ? "2026-05-16T10:00:10Z" : null
  };
}

function item(id: string, turnId: string, kind: string): TurnItemRecord {
  return {
    id,
    turn_id: turnId,
    kind,
    status: "completed",
    summary: id,
    detail: id,
    started_at: "2026-05-16T10:00:02Z",
    ended_at: "2026-05-16T10:00:09Z"
  };
}

describe("turn timeline grouping", () => {
  it("folds each completed reply process independently", () => {
    const timeline = buildTurnTimeline({
      activeTurnId: null,
      turnActive: false,
      turns: [turn("turn_1"), turn("turn_2")],
      items: [
        item("user_1", "turn_1", "user_message"),
        item("reasoning_1", "turn_1", "agent_reasoning"),
        item("tool_1", "turn_1", "tool_call"),
        item("answer_1", "turn_1", "agent_message"),
        item("user_2", "turn_2", "user_message"),
        item("reasoning_2", "turn_2", "agent_reasoning"),
        item("answer_2", "turn_2", "agent_message")
      ]
    });

    expect(timeline.map((entry) => (entry.type === "item" ? entry.item.id : entry.id))).toEqual([
      "user_1",
      "processed:turn_1",
      "answer_1",
      "user_2",
      "processed:turn_2",
      "answer_2"
    ]);
    expect(timeline.filter((entry) => entry.type === "processed")).toHaveLength(2);
    expect(timeline[1]).toMatchObject({
      type: "processed",
      items: [{ id: "reasoning_1" }, { id: "tool_1" }]
    });
  });

  it("keeps the active reply process expanded", () => {
    const timeline = buildTurnTimeline({
      activeTurnId: "turn_2",
      turnActive: true,
      turns: [turn("turn_1"), turn("turn_2", "running")],
      items: [
        item("user_1", "turn_1", "user_message"),
        item("reasoning_1", "turn_1", "agent_reasoning"),
        item("answer_1", "turn_1", "agent_message"),
        item("user_2", "turn_2", "user_message"),
        item("reasoning_2", "turn_2", "agent_reasoning")
      ]
    });

    expect(timeline.map((entry) => (entry.type === "item" ? entry.item.id : entry.id))).toEqual([
      "user_1",
      "processed:turn_1",
      "answer_1",
      "user_2",
      "reasoning_2"
    ]);
  });

  it("treats earlier assistant messages in the same reply as process history", () => {
    const timeline = buildTurnTimeline({
      activeTurnId: null,
      turnActive: false,
      turns: [turn("turn_1")],
      items: [
        item("user_1", "turn_1", "user_message"),
        item("draft_answer", "turn_1", "agent_message"),
        item("final_answer", "turn_1", "agent_message")
      ]
    });

    expect(timeline.map((entry) => (entry.type === "item" ? entry.item.id : entry.id))).toEqual([
      "user_1",
      "processed:turn_1",
      "final_answer"
    ]);
    expect(timeline[1]).toMatchObject({
      type: "processed",
      items: [{ id: "draft_answer" }]
    });
  });
});
