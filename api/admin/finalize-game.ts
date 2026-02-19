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

import { players } from "../../server/src/data";

type ScanReply = [string, string[]];

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

async function scanAllTeamKeys(): Promise<string[]> {
  const match = `${PREFIX}:team:*`;
  let cursor = "0";
  const keysAll: string[] = [];

  while (true) {
    const reply = (await (redis as any).scan(cursor, { match, count: 200 })) as ScanReply;
    const nextCursor: string = reply[0];
    const keys: string[] = reply[1] ?? [];
    keysAll.push(...keys);
    cursor = nextCursor;
    if (cursor === "0") break;
  }

  // de-dupe just in case
  return Array.from(new Set(keysAll));
}

function coerceTeamFromHash(obj: any): TeamData | null {
  if (!obj || typeof obj !== "object") return null;

  const startingRaw = (obj.startingXIIds ?? obj.startingXI ?? obj.starting ?? null) as any;
  const benchRaw = (obj.benchIds ?? obj.bench ?? null) as any;

  // Upstash hgetall often returns strings -> convert to numbers
  const toNumArray = (v: any): number[] => {
    if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (typeof v === "string") {
      // might be JSON stringified array
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
      } catch {}
      // might be comma-separated
      return v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  };

  const startingXIIds = toNumArray(startingRaw);
  const benchIds = toNumArray(benchRaw);

  return { startingXIIds, benchIds };
}

async function loadTeam(teamKey: string): Promise<{ team: TeamData | null; redisType: string | null }> {
  // First try GET (string/json)
  const fromGet = (await redis.get<TeamData>(teamKey)) ?? null;
  if (fromGet && Array.isArray((fromGet as any).startingXIIds)) {
    return { team: fromGet, redisType: "string/json(get)" };
  }

  // If GET failed, check redis type + try HGETALL
  let t: string | null = null;
  try {
    t = (await (redis as any).type(teamKey)) as string; // "hash", "string", ...
  } catch {
    t = null;
  }

  try {
    const h = (await (redis as any).hgetall(teamKey)) as any;
    const coerced = coerceTeamFromHash(h);
    if (coerced) return { team: coerced, redisType: t ?? "hash(hgetall)" };
  } catch {
    // ignore
  }

  return { team: null, redisType: t };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const gameId = Number(req.body?.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "Invalid gameId" });
    }

    const eventsKey = `${PREFIX}:game:${gameId}:events`;
    const eventsById = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) playersById.set(p.id, { id: p.id, position: p.position });

    const teamKeys = await scanAllTeamKeys();

    const results: Array<{ username: string; points: number; subsUsed: number[] }> = [];
    const perUserDebug: Array<any> = [];

    for (const teamKey of teamKeys) {
      const usernamePart = String(teamKey).split(":").pop() ?? "";
      const username = normalizeUsername(usernamePart);

      const { team, redisType } = await loadTeam(teamKey);

      const startingXIIds = team?.startingXIIds ?? [];
      const benchIds = team?.benchIds ?? [];

      const startingMatches = startingXIIds.filter((id) => playersById.has(id)).length;

      const { total, subsUsed } = scoreTeamForGameWithAutosub({
        team: { startingXIIds, benchIds },
        playersById,
        eventsById,
      });

      results.push({ username, points: total, subsUsed });

      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:points`, total);
      await redis.set(`${PREFIX}:user:${username}:game:${gameId}:subs`, subsUsed);

      perUserDebug.push({
        username,
        teamKey,
        redisType,
        teamExists: !!team,
        startingLen: startingXIIds.length,
        benchLen: benchIds.length,
        startingFirst: startingXIIds[0] ?? null,
        startingMatches,
      });
    }

    await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));

    return res.status(200).json({
      ok: true,
      gameId,
      results,
      debug: {
        prefix: PREFIX,
        eventsKey,
        eventsCount: Object.keys(eventsById).length,
        playersByIdSize: playersById.size,
        discoveredTeamKeysCount: teamKeys.length,
        discoveredTeamKeys: teamKeys.slice(0, 50),
        perUserDebug,
      },
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}
