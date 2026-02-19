// api/admin/finalize-game.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import { scoreTeamForGameWithAutosub, type TeamData, type PlayerLite, type PlayerEventInput } from "../../lib/scoring";

// ✅ import directly from TS module
import { players } from "../../server/src/data"; // <- make sure data.ts exports `players`

const USERS = ["admin", "joona", "olli", "otto"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const gameId = Number(req.body?.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) return res.status(400).json({ error: "Invalid gameId" });

    const eventsKey = `${PREFIX}:game:${gameId}:events`;
    const eventsById = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) playersById.set(p.id, { id: p.id, position: p.position });

    const results: Array<{ username: string; points: number; subsUsed: number[] }> = [];
    const teamStartingCounts: number[] = [];

    for (const username of USERS) {
      const teamKey = `${PREFIX}:team:${username}`;
      const team = (await redis.get<TeamData>(teamKey)) ?? null;

      const startingXIIds = team?.startingXIIds ?? [];
      const benchIds = team?.benchIds ?? [];

      // ✅ debug: how many starting ids exist in playersById
      teamStartingCounts.push(startingXIIds.filter((id) => playersById.has(id)).length);
      const rawStarting = team?.startingXIIds ?? [];
const probeRaw = rawStarting[0];
const probeNum = startingXIIds[0];

console.log("TEAM_PROBE", {
  username,
  rawFirst: probeRaw,
  rawType: typeof probeRaw,
  numFirst: probeNum,
  hasRaw: playersById.has(probeRaw as any),
  hasNum: playersById.has(probeNum),
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
        playersByIdSize: playersById.size,
        eventsCount: Object.keys(eventsById).length,
        teamStartingCounts,
      },
    });
    
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
