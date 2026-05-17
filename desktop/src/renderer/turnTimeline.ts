import type { TurnItemRecord, TurnRecord } from "./types";

export type TurnTimelineEntry =
  | {
      type: "item";
      item: TurnItemRecord;
    }
  | {
      type: "processed";
      id: string;
      items: TurnItemRecord[];
      processedAt: string | null;
    };

const LIVE_TURN_STATUSES = new Set(["queued", "running", "in_progress"]);

function isLiveTurn(turn?: TurnRecord | null) {
  return Boolean(turn?.status && LIVE_TURN_STATUSES.has(turn.status));
}

function finalAssistantIndex(items: TurnItemRecord[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "agent_message") {
      return index;
    }
  }
  return -1;
}

function processedTime(turn: TurnRecord | undefined, finalItem: TurnItemRecord, processItems: TurnItemRecord[]) {
  return (
    finalItem.ended_at ??
    finalItem.started_at ??
    turn?.ended_at ??
    processItems.at(-1)?.ended_at ??
    processItems.at(-1)?.started_at ??
    turn?.started_at ??
    turn?.created_at ??
    null
  );
}

export function buildTurnTimeline({
  activeTurnId,
  items,
  turnActive,
  turns
}: {
  activeTurnId?: string | null;
  items: TurnItemRecord[];
  turnActive: boolean;
  turns: TurnRecord[];
}): TurnTimelineEntry[] {
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const itemBuckets = new Map<string, TurnItemRecord[]>();
  const orderedTurnIds: string[] = [];

  for (const turn of turns) {
    orderedTurnIds.push(turn.id);
    itemBuckets.set(turn.id, []);
  }

  for (const item of items) {
    if (!itemBuckets.has(item.turn_id)) {
      orderedTurnIds.push(item.turn_id);
      itemBuckets.set(item.turn_id, []);
    }
    itemBuckets.get(item.turn_id)?.push(item);
  }

  const entries: TurnTimelineEntry[] = [];
  for (const turnId of orderedTurnIds) {
    const turn = turnsById.get(turnId);
    const turnItems = itemBuckets.get(turnId) ?? [];
    if (!turnItems.length) {
      continue;
    }

    const isActiveTurn = isLiveTurn(turn) || (turnActive && activeTurnId === turnId);
    const finalIndex = finalAssistantIndex(turnItems);
    if (isActiveTurn || finalIndex < 0) {
      entries.push(...turnItems.map((item) => ({ type: "item" as const, item })));
      continue;
    }

    const finalItem = turnItems[finalIndex];
    if (!finalItem) {
      entries.push(...turnItems.map((item) => ({ type: "item" as const, item })));
      continue;
    }
    const userItems = turnItems.filter((item) => item.kind === "user_message");
    const processItems = turnItems.filter((item, index) => index !== finalIndex && item.kind !== "user_message");
    entries.push(...userItems.map((item) => ({ type: "item" as const, item })));
    if (processItems.length) {
      entries.push({
        type: "processed",
        id: `processed:${turnId}`,
        items: processItems,
        processedAt: processedTime(turn, finalItem, processItems)
      });
    }
    entries.push({ type: "item", item: finalItem });
  }

  return entries;
}
