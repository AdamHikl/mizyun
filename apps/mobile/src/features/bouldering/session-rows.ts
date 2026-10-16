import type {
  BoulderFinishResponse,
  BoulderAscentRecord,
} from "@mizyun/contracts";
import type { BoulderResult, HoldColour } from "@mizyun/core";
import {
  commandOperationId,
  type BoulderPendingCommand,
} from "./pending-ascents";

export type BoulderRowPending = "create" | "update" | "delete" | null;

/** One displayed boulder: a server row, possibly overlaid by a waiting command. */
export interface BoulderRow {
  readonly key: string;
  readonly grade: string;
  readonly result: BoulderResult;
  readonly attempts: number | null;
  readonly holdColour: HoldColour | null;
  readonly note: string | null;
  readonly photoAssetId: string | null;
  readonly pending: BoulderRowPending;
  /** Null for a boulder that exists only on this device so far. */
  readonly ascent: BoulderAscentRecord | null;
}

/**
 * Overlays this session's waiting commands on the server rows, in log order.
 * A row with a waiting command is read-only until it syncs, so edits never
 * race on a stale revision.
 */
export const mergeBoulderRows = (
  sessionId: string,
  ascents: readonly BoulderAscentRecord[],
  commands: readonly BoulderPendingCommand[],
): BoulderRow[] => {
  const mine = commands.filter((c) => c.sessionId === sessionId);
  const rows: BoulderRow[] = [...ascents]
    .sort((a, b) => a.sequence - b.sequence)
    .map((ascent) => {
      const waiting = [...mine]
        .reverse()
        .find((c) => c.kind !== "create" && c.ascentId === ascent.id);
      if (waiting?.kind === "update")
        return {
          key: ascent.id,
          grade: waiting.body.grade,
          result: waiting.body.result,
          attempts: waiting.body.attempts,
          holdColour: waiting.body.holdColour,
          note: waiting.body.note,
          photoAssetId: waiting.body.photoAssetId,
          pending: "update",
          ascent,
        };
      return {
        key: ascent.id,
        grade: ascent.grade,
        result: ascent.result,
        attempts: ascent.attempts,
        holdColour: ascent.holdColour,
        note: ascent.note,
        photoAssetId: ascent.photoAssetId,
        pending: waiting?.kind === "delete" ? "delete" : null,
        ascent,
      };
    });
  for (const command of mine) {
    if (command.kind !== "create") continue;
    rows.push({
      key: `pending:${commandOperationId(command)}`,
      grade: command.body.grade,
      result: command.body.result,
      attempts: command.body.attempts,
      holdColour: command.body.holdColour,
      note: command.body.note,
      photoAssetId: null,
      pending: "create",
      ascent: null,
    });
  }
  return rows;
};

/** Finish responses carry achievements; keep the latest one per account for the summary screen. */
const finishCache = new Map<string, BoulderFinishResponse>();

export const rememberFinish = (
  userId: string,
  response: BoulderFinishResponse,
): void => {
  for (const key of finishCache.keys())
    if (!key.startsWith(`${userId}:`)) finishCache.delete(key);
  finishCache.set(`${userId}:${response.session.id}`, response);
};

export const recallFinish = (
  userId: string,
  sessionId: string,
): BoulderFinishResponse | null =>
  finishCache.get(`${userId}:${sessionId}`) ?? null;
