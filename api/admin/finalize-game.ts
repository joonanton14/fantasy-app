import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import {
  calcPoints,
  type PlayerLite,
  type PlayerEventInput,
} from "../../lib/scoring";
import { players } from "../../server/src/data";

function toIntArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const singleGameId = Number(req.body?.gameId);
    const gameIdsFromBody = toIntArray(req.body?.gameIds);

    const gameIds =
      gameIdsFromBody.length > 0
        ? gameIdsFromBody
        : Number.isInteger(singleGameId) && singleGameId > 0
          ? [singleGameId]
          : [];

    if (gameIds.length === 0) {
      return res.status(400).json({ error: "Provide gameId or gameIds[]" });
    }

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    const results: Array<{
      gameId: number;
      savedPlayers: number;
      missingPlayers: number[];
    }> = [];

    for (const gameId of gameIds) {
      const eventsKey = `${PREFIX}:game:${gameId}:events`;
      const pointsKey = `${PREFIX}:game:${gameId}:points`;

      const eventsById = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};
      const pointsById: Record<string, number> = {};
      const missingPlayers: number[] = [];

      for (const [pid, ev] of Object.entries(eventsById)) {
        const id = Number(pid);
        if (!Number.isInteger(id) || id <= 0) continue;

        const player = playersById.get(id);
        if (!player) {
          missingPlayers.push(id);
          continue;
        }

        pointsById[String(id)] = calcPoints(player.position, ev);
      }

      await redis.set(pointsKey, pointsById);
      await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));

      results.push({
        gameId,
        savedPlayers: Object.keys(pointsById).length,
        missingPlayers,
      });
    }

    return res.status(200).json({
      ok: true,
      mode: gameIds.length === 1 ? "single" : "multi",
      gameIds,
      results,
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}