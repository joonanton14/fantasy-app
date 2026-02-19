// api/admin/finalize-game.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import {
  scoreTeamForGameWithAutosub,
  type TeamData,
  type PlayerLite,
  type PlayerEventInput,
} from "../../lib/scoring";

// ✅ import directly from TS module
import { players } from "../../server/src/data";

const USERS = ["admin", "joona", "olli", "otto"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
const sessionTeamKey = `${PREFIX}:team:${session.username}`;
const sessionTeam = await redis.get(sessionTeamKey);

    const gameId = Number(req.body?.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0)
      return res.status(400).json({ error: "Invalid gameId" });

    const eventsKey = `${PREFIX}:game:${gameId}:events`;
    const eventsById =
      (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

    // Build playersById map
    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    // 🔎 debug: player id range
    const playerIds = players
      .map((p) => Number(p.id))
      .filter((n) => Number.isFinite(n));
    const playersMinId = playerIds.length ? Math.min(...playerIds) : null;
    const playersMaxId = playerIds.length ? Math.max(...playerIds) : null;

    const results: Array<{ username: string; points: number; subsUsed: number[] }> = [];
    const teamStartingCounts: number[] = [];

    // 🔎 debug per user
    const perUserDebug: Array<{
      username: string;
      teamKey: string;
      teamExists: boolean;
      startingLenRaw: number;
      startingFirstRaw: unknown;
      startingFirstType: string;
      startingFirstNum: number | null;
      playersHasFirst: boolean;
      benchLen: number;
    }> = [];

    for (const username of USERS) {
      const teamKey = `${PREFIX}:team:${username}`;
      const team = (await redis.get<TeamData>(teamKey)) ?? null;

      const startingXIIds = team?.startingXIIds ?? [];
      const benchIds = team?.benchIds ?? [];

      // ✅ existing debug: how many starting ids exist in playersById
      teamStartingCounts.push(
        startingXIIds.filter((id) => playersById.has(id)).length
      );

      // 🔎 new debug: is team loaded and do ids match playersById?
      const rawStarting: any[] = (team as any)?.startingXIIds ?? [];
      const firstRaw = rawStarting[0];
      const firstNum = Number(firstRaw);
      const firstNumOk = Number.isFinite(firstNum);

      perUserDebug.push({
        username,
        teamKey,
        teamExists: !!team,
        startingLenRaw: rawStarting.length,
        startingFirstRaw: firstRaw,
        startingFirstType: typeof firstRaw,
        startingFirstNum: firstNumOk ? firstNum : null,
        playersHasFirst: firstNumOk ? playersById.has(firstNum) : false,
        benchLen: Array.isArray(benchIds) ? benchIds.length : 0,
      });

      const { total, subsUsed } = scoreTeamForGameWithAutosub({
        team: { startingXIIds, benchIds },
        playersById,
        eventsById,
      });

      results.push({ username, points: total, subsUsed });
      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:points`, total);
      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:subs`, subsUsed);
    }

    await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));

    return res.status(200).json({
      ok: true,
      gameId,
      results,
      debug: {
        prefix: PREFIX,
        eventsKey,
        playersByIdSize: playersById.size,
        playersMinId,
        playersMaxId,
        eventsCount: Object.keys(eventsById).length,
        teamStartingCounts,
        perUserDebug,
      },
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
